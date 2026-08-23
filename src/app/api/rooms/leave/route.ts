import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isRoomUuid } from "@/lib/roomLifecycle";

/* Instant-leave beacon. The room page fires
     navigator.sendBeacon("/api/rooms/leave", JSON.stringify({ roomId }))
   on pagehide, so a closed tab vacates its seat immediately instead of
   waiting for the LiveKit webhook. sendBeacon posts text/plain with the
   session cookies attached — auth comes from the cookie, the body only
   names the room.

   The caller's own participant row gets left_at; a live host also gets
   host_left_at stamped (the 90-second grace — the 'room-lifecycle' cron
   ends the room, never this route). Both writes ride the user-scoped
   client, so RLS keeps the beacon from touching anyone else's rows.
   Best-effort by design: the sender is already gone, so every outcome
   answers 200. */

export async function POST(request: NextRequest) {
  try {
    let roomId: unknown;
    try {
      roomId = JSON.parse(await request.text())?.roomId;
    } catch {
      /* malformed beacon body — nothing to do */
    }
    if (!isRoomUuid(roomId)) {
      return NextResponse.json({ error: "bad_room" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      /* Guests hold no participant row — nothing to stamp. */
      return NextResponse.json({ ok: true });
    }

    const now = new Date().toISOString();
    await supabase
      .from("debate_participants")
      .update({ left_at: now, hand_raised_at: null })
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .is("left_at", null);

    /* Host of a live room: start the grace timer. The host_id/status
       filters make this a no-op for everyone else. */
    await supabase
      .from("debate_rooms")
      .update({ host_left_at: now })
      .eq("id", roomId)
      .eq("host_id", user.id)
      .eq("status", "live");

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("rooms/leave error", e);
    return NextResponse.json({ ok: true });
  }
}
