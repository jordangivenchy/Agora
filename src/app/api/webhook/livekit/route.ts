import { NextRequest, NextResponse } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { planWebhook } from "@/lib/roomLifecycle";

/* LiveKit Cloud lifecycle webhook. This is how the server learns that a
   tab closed or a connection died — the browser never got to say
   goodbye. Configure in LiveKit Cloud → Settings → Webhooks:
     https://agorasphere.net/api/webhook/livekit

   participant_left   → stamp the seat's left_at; if it was the LIVE
                        host, start the 90s grace timer (host_left_at)
                        instead of ending the room, so a refresh
                        survives. The 'room-lifecycle' pg_cron sweep
                        (20260855) does the actual ending.
   participant_joined → host is back: clear the grace timer. Seat
                        restore (left_at = null) stays the room page's
                        own job — the webhook never re-seats anyone.
   room_finished      → LiveKit closed an empty room past its timeout:
                        end the debate if it was still live.

   Signature: WebhookReceiver verifies the raw body against the
   Authorization JWT minted with our LIVEKIT_API_KEY/SECRET — nobody
   else can forge events. Always answer 200 fast on verified events
   (LiveKit retries non-2xx); per-event DB errors are logged and
   swallowed. /api/webhook/* is beta-gate exempt (src/proxy.ts). */

export async function POST(request: NextRequest) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret || !hasAdminCredentials()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let event;
  try {
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    const body = await request.text();
    event = await receiver.receive(
      body,
      request.headers.get("authorization") ?? undefined
    );
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const plan = planWebhook(
    event.event,
    event.room?.name,
    event.participant?.identity
  );

  try {
    if (plan.action !== "ignore") {
      const admin = createAdminClient();
      const now = new Date().toISOString();

      if (plan.action === "participant_left") {
        await admin
          .from("debate_participants")
          .update({ left_at: now, hand_raised_at: null })
          .eq("room_id", plan.roomId)
          .eq("user_id", plan.userId)
          .is("left_at", null);
        /* Live host dropping starts the grace clock — never an instant end. */
        const { data: room } = await admin
          .from("debate_rooms")
          .select("host_id, status")
          .eq("id", plan.roomId)
          .maybeSingle();
        if (room?.status === "live" && room.host_id === plan.userId) {
          await admin
            .from("debate_rooms")
            .update({ host_left_at: now })
            .eq("id", plan.roomId)
            .eq("status", "live");
        }
      } else if (plan.action === "participant_joined") {
        /* Only meaningful when the joiner is the host with a running
           grace timer; the host_id filter makes it a no-op otherwise. */
        await admin
          .from("debate_rooms")
          .update({ host_left_at: null })
          .eq("id", plan.roomId)
          .eq("host_id", plan.userId)
          .not("host_left_at", "is", null);
      } else if (plan.action === "room_finished") {
        await admin
          .from("debate_rooms")
          .update({
            status: "ended",
            ended_at: now,
            host_left_at: null,
            close_reason: "inactive",
          })
          .eq("id", plan.roomId)
          .eq("status", "live");
      }
    }
  } catch (e) {
    console.error("livekit webhook error", plan, e);
  }
  return NextResponse.json({ ok: true });
}
