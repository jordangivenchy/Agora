import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";

/* LiveKit token mint. Identity is server-verified: the Supabase cookie
   session decides who you are — the client's claimed userId is never
   trusted, so nobody can join the call wearing someone else's id. Guests
   (no session) get a guest- identity and are subscribe-only.

   Scheduled rooms enforce the 30-minute door here too: the room page
   gates the UI, but a token is the thing that actually admits you. */

const DOOR_MS = 30 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const { roomId, userId: claimedId, role } = await request.json();

    if (!roomId) {
      return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: "LiveKit not configured" }, { status: 500 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let identity: string;
    let name: string;
    let canPublish = false;

    if (user) {
      identity = user.id;
      const { data: profile } = await supabase
        .from("users")
        .select("username, display_name")
        .eq("id", user.id)
        .maybeSingle();
      name =
        profile?.display_name?.trim() ||
        profile?.username ||
        user.email?.split("@")[0] ||
        "User";
      canPublish = role === "debater";
    } else {
      /* Keep the client's guest id when it looks like one (harmless — no
         publish rights, no user mapping), so its local bookkeeping lines up. */
      identity =
        typeof claimedId === "string" && /^guest-[a-z0-9-]{4,40}$/i.test(claimedId)
          ? claimedId
          : `guest-${crypto.randomUUID().slice(0, 8)}`;
      name = "Guest";
    }

    const { data: room } = await supabase
      .from("debate_rooms")
      .select("host_id, status, scheduled_start")
      .eq("id", roomId)
      .maybeSingle();
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (room.status === "ended") {
      return NextResponse.json({ error: "room_ended" }, { status: 403 });
    }
    if (
      room.scheduled_start &&
      room.status !== "live" &&
      (!user || user.id !== room.host_id)
    ) {
      const opensAt = new Date(room.scheduled_start).getTime() - DOOR_MS;
      if (Date.now() < opensAt) {
        return NextResponse.json(
          { error: "room_not_open", opensAt: new Date(opensAt).toISOString() },
          { status: 403 }
        );
      }
    }

    /* Opportunistic ghost-seat sweep — keyed to arrivals, so stale rows
       clear whenever a room is actually being used. Fire-and-forget. */
    if (hasAdminCredentials()) {
      createAdminClient()
        .rpc("sweep_ghost_seats")
        .then(undefined, () => {});
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name,
      ttl: "1h",
    });
    at.addGrant({
      room: roomId,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}
