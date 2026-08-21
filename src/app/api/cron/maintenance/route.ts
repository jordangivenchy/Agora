import { NextResponse } from "next/server";
import { EgressClient } from "livekit-server-sdk";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";

/* Daily housekeeping (see vercel.json):
     1. sweep ghost seats — participants whose tab died without stamping
        left_at (also runs opportunistically from /api/livekit)
     2. self-host OAuth avatars — copy Google-hosted profile photos into our
        avatars bucket so lh3.googleusercontent.com rate limits can't blank
        avatars during bursts
     3. stop any egress still running against an ended room (belt-and-braces
        behind the close-stage stop_all — a leaked egress bills minutes)
     4. prune expired 2FA challenges/gates and day-old attempt audit rows

   Auth: same CRON_SECRET bearer scheme as refresh-traits. */

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasAdminCredentials()) {
    return NextResponse.json({ error: "storage_not_configured" }, { status: 503 });
  }

  const admin = createAdminClient();
  const report: Record<string, unknown> = {};

  // 1. Ghost seats
  try {
    const { data, error } = await admin.rpc("sweep_ghost_seats");
    report.sweptSeats = error ? `error: ${error.message}` : (data ?? 0);
  } catch (e) {
    report.sweptSeats = `error: ${e instanceof Error ? e.message : "unknown"}`;
  }

  // 2. Self-host Google avatars (a few per run keeps it gentle)
  try {
    const { data: users } = await admin
      .from("users")
      .select("id, avatar_url")
      .like("avatar_url", "%googleusercontent.com%")
      .limit(10);
    let copied = 0;
    for (const u of users ?? []) {
      try {
        const res = await fetch(u.avatar_url as string);
        if (!res.ok) continue;
        const blob = await res.blob();
        const path = `${u.id}/oauth.jpg`;
        const { error: upErr } = await admin.storage
          .from("avatars")
          .upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
        if (upErr) continue;
        const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
        await admin.from("users").update({ avatar_url: pub.publicUrl }).eq("id", u.id);
        copied++;
      } catch {
        /* per-user best effort */
      }
    }
    report.avatarsCopied = copied;
  } catch (e) {
    report.avatarsCopied = `error: ${e instanceof Error ? e.message : "unknown"}`;
  }

  // 3. Leaked egress on ended rooms
  try {
    const lkUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (lkUrl && apiKey && apiSecret) {
      const egress = new EgressClient(lkUrl.replace(/^wss?:\/\//, "https://"), apiKey, apiSecret);
      const active = await egress.listEgress({ active: true });
      let stopped = 0;
      for (const e of active) {
        const { data: room } = await admin
          .from("debate_rooms")
          .select("status")
          .eq("id", e.roomName)
          .maybeSingle();
        if (!room || room.status === "ended") {
          try {
            await egress.stopEgress(e.egressId);
            stopped++;
          } catch {
            /* already stopping */
          }
        }
      }
      report.egressStopped = stopped;
    } else {
      report.egressStopped = "livekit_not_configured";
    }
    // A dead room shouldn't advertise a stream that stopped with it.
    await admin
      .from("debate_rooms")
      .update({ hls_url: null })
      .eq("status", "ended")
      .not("hls_url", "is", null);
  } catch (e) {
    report.egressStopped = `error: ${e instanceof Error ? e.message : "unknown"}`;
  }

  // 4b. Headline-created debate topics nobody is waiting on (>24h)
  try {
    const { data, error } = await admin.rpc("retire_stale_headline_topics");
    report.headlineTopicsRetired = error ? `error: ${error.message}` : (data ?? 0);
  } catch (e) {
    report.headlineTopicsRetired = `error: ${e instanceof Error ? e.message : "unknown"}`;
  }

  // 4. Expired 2FA challenges + old login-attempt audit rows
  try {
    const now = new Date().toISOString();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await admin.from("two_factor_pending").delete().lt("expires_at", now);
    await admin.from("two_factor_gate").delete().lt("expires_at", now);
    await admin.from("two_factor_attempts").delete().lt("created_at", dayAgo);
    report.twoFactorPruned = true;
  } catch (e) {
    report.twoFactorPruned = `error: ${e instanceof Error ? e.message : "unknown"}`;
  }

  return NextResponse.json({ ok: true, ...report });
}
