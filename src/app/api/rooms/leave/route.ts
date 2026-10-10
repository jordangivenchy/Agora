import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isRoomUuid } from "@/lib/roomLifecycle";
import { roomConnections } from "@/lib/livekitRoom";
import { heldElsewhere } from "@/components/agora/roomPresence";

/* Leaving a room. The room page fires
     navigator.sendBeacon("/api/rooms/leave", JSON.stringify({ roomId, sid }))
   on pagehide, so a closed tab vacates its seat immediately instead of
   waiting for the LiveKit webhook; the Leave button (and the phone app)
   post the same thing. sendBeacon posts text/plain with the session
   cookies attached — auth comes from the cookie (or the app's bearer),
   the body names the room and the connection that is leaving.

   One person, two devices: the call holds one connection per person. If
   the one it holds now is not the one leaving (`sid`), they are still
   in the room on another device or tab, so nothing is stamped — their
   seat stands, and a host's room is not put on its grace clock. Before
   this, leaving on a laptop took a person out of the audience while
   they were still listening on their phone. `seatOnly` leaves a host's
   grace clock alone (the Leave button, which decides that itself).

   The caller's own participant row gets left_at; a live host also gets
   host_left_at stamped (the 90-second grace — the 'room-lifecycle' cron
   ends the room, never this route). Both writes ride the user-scoped
   client, so RLS keeps the beacon from touching anyone else's rows.
   Best-effort by design: a closing page is already gone and reads
   nothing. The Leave button and the app do read the answer: `signedIn:
   false` or a failure tells them to stamp the seat themselves, as they
   did before this route was asked. */

export async function POST(request: NextRequest) {
  try {
    let roomId: unknown;
    /* The leaving page's own connection: a string, null when it had none,
       undefined from a page too old to say. */
    let sid: string | null | undefined;
    let seatOnly = false;
    try {
      const body = JSON.parse(await request.text()) as { roomId?: unknown; sid?: unknown; seatOnly?: unknown } | null;
      roomId = body?.roomId;
      sid = typeof body?.sid === "string" ? body.sid : body?.sid === null ? null : undefined;
      seatOnly = body?.seatOnly === true;
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
      return NextResponse.json({ ok: true, signedIn: false });
    }

    /* Still in the call on another device? Then this is not a departure. */
    const connections = await roomConnections(roomId as string);
    if (connections && heldElsewhere(connections, user.id, sid)) {
      return NextResponse.json({ ok: true, kept: "elsewhere" });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("debate_participants")
      .update({ left_at: now, hand_raised_at: null })
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .is("left_at", null);
    if (error) return NextResponse.json({ ok: false }, { status: 500 });

    /* Host of a live room: start the grace timer. The host_id/status
       filters make this a no-op for everyone else. */
    if (!seatOnly) {
      await supabase
        .from("debate_rooms")
        .update({ host_left_at: now })
        .eq("id", roomId)
        .eq("host_id", user.id)
        .eq("status", "live");
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("rooms/leave error", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
