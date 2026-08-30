import { NextRequest, NextResponse } from "next/server";
import { EgressClient } from "livekit-server-sdk";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";

/* Fired by the debate_rooms ended-trigger (pg_net POST) the moment a
   room ends by ANY path — reaper, duel leave-trigger, close stage,
   manual cleanup. Stops every active egress for the room so recordings
   never keep rolling (and billing storage/minutes) against a dead
   stage. The host's close-stage stop_all still runs client-side; this
   is the server-side backstop that doesn't need anyone's browser.

   Auth: Bearer <reminder_webhook_secret from app_config> — same
   contract as /api/cron/reminders. */

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

    const { roomId } = await request.json();
    if (typeof roomId !== "string" || !roomId) {
      return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
    }

    const lkUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!lkUrl || !apiKey || !apiSecret) {
      return NextResponse.json({ error: "livekit_not_configured" }, { status: 503 });
    }

    const egress = new EgressClient(lkUrl.replace(/^wss?:\/\//, "https://"), apiKey, apiSecret);
    const active = await egress.listEgress({ roomName: roomId, active: true });
    await Promise.allSettled(active.map((e) => egress.stopEgress(e.egressId)));

    /* Same bookkeeping as the host's stop_all: the live playlist dies
       with the stream; recording_ended_at lands once for recorded rooms. */
    const admin = createAdminClient();
    await admin.from("debate_rooms").update({ hls_url: null }).eq("id", roomId);
    await admin
      .from("debate_rooms")
      .update({ recording_ended_at: new Date().toISOString() })
      .eq("id", roomId)
      .not("recording_url", "is", null)
      .is("recording_ended_at", null);

    return NextResponse.json({ ok: true, stopped: active.length });
  } catch (e) {
    console.error("[room-ended] failed:", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
