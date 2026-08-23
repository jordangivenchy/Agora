import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";
import { debateReplayReadyEmail, emailConfigured, sendEmail } from "@/lib/email";
import { roomPath } from "@/lib/urls";
import { sendPushToUsers } from "@/lib/webPush";
import { displayName } from "@/lib/names";

/* Out-of-app delivery for the social notification types that deserve
   it: followed_live / followed_scheduled / debate_replay_ready go out as
   web push (same sender as the 30-minute reminders), and replay-ready
   also as email. Triggered every minute by pg_cron
   (dispatch_notification_push → pg_net POST) only when undelivered rows
   exist; each row is stamped delivered_at so nothing goes twice.

   Auth: Bearer <reminder_webhook_secret from app_config> — no env. */

const PUSH_TYPES = ["followed_live", "followed_scheduled", "debate_replay_ready"] as const;
type PushType = (typeof PUSH_TYPES)[number];

type Row = {
  id: string;
  user_id: string;
  type: PushType;
  meta: Record<string, unknown> | null;
  room: { id: string; motion: string; scheduled_start: string | null } | null;
  actor: { username: string; display_name: string | null } | null;
  user: { email: string | null } | null;
};

function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!hasAdminCredentials()) {
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    const cfg = await getAppConfig();
    const secret = cfg.reminder_webhook_secret;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data } = await admin
      .from("notifications")
      .select(
        "id, user_id, type, meta, room:debate_rooms(id, motion, scheduled_start), actor:users!notifications_actor_id_fkey(username, display_name), user:users!notifications_user_id_fkey(email)"
      )
      .is("delivered_at", null)
      .in("type", [...PUSH_TYPES])
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(500);
    const rows = (data ?? []) as unknown as Row[];
    if (!rows.length) return NextResponse.json({ ok: true, skipped: "nothing_pending" });

    const origin = cfg.app_origin ?? "https://agorasphere.net";
    const payloads = new Map<string, { title: string; body: string; url: string }>();
    for (const r of rows) {
      if (!r.room) continue;
      const url = `${origin}${roomPath({ id: r.room.id, motion: r.room.motion })}`;
      const who = r.actor ? displayName(r.actor) || `@${r.actor.username}` : "Someone you follow";
      const motion = `“${r.room.motion}”`;
      if (r.type === "followed_live") {
        payloads.set(r.user_id, { title: `${who} is live`, body: `${motion} — join the amphitheater.`, url });
      } else if (r.type === "followed_scheduled") {
        const when = whenLabel(r.room.scheduled_start);
        payloads.set(r.user_id, {
          title: `${who} scheduled a debate`,
          body: `${motion}${when ? ` · ${when}` : ""}`,
          url,
        });
      } else {
        payloads.set(r.user_id, { title: "Your replay is ready", body: `${motion} — watch it back.`, url });
      }
    }

    const pushed = await sendPushToUsers(admin, cfg, [...payloads.keys()], (uid) => payloads.get(uid) ?? null);

    let emailed = 0;
    if (emailConfigured()) {
      for (const r of rows) {
        if (r.type !== "debate_replay_ready" || !r.room || !r.user?.email) continue;
        const url = `${origin}${roomPath({ id: r.room.id, motion: r.room.motion })}`;
        const { subject, html } = debateReplayReadyEmail(r.room.motion, url);
        if (await sendEmail({ to: r.user.email, subject, html })) emailed++;
      }
    }

    await admin
      .from("notifications")
      .update({ delivered_at: new Date().toISOString() })
      .in("id", rows.map((r) => r.id));

    return NextResponse.json({ ok: true, rows: rows.length, pushed, emailed });
  } catch {
    return NextResponse.json({ error: "notification_dispatch_failed" }, { status: 500 });
  }
}
