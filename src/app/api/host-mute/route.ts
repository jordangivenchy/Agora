import { NextRequest, NextResponse } from "next/server";
import { RoomServiceClient, TrackType } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase-server";

/**
 * Host-enforced mute: mutes a participant's published audio/video track at
 * the LiveKit SERVER, so the target can't simply ignore it client-side.
 * Authorization is checked here — the caller's session must belong to the
 * room's host.
 */
export async function POST(request: NextRequest) {
  try {
    const { roomId, targetUserId, kind } = await request.json();
    if (!roomId || !targetUserId || !["audio", "video"].includes(kind)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data: room } = await supabase
      .from("debate_rooms")
      .select("host_id")
      .eq("id", roomId)
      .maybeSingle();
    if (!room || room.host_id !== user.id) {
      return NextResponse.json({ error: "Host only" }, { status: 403 });
    }

    const lkUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!lkUrl || !apiKey || !apiSecret) {
      return NextResponse.json({ error: "LiveKit not configured" }, { status: 500 });
    }

    const svc = new RoomServiceClient(
      lkUrl.replace(/^wss?:\/\//, "https://"),
      apiKey,
      apiSecret
    );

    const participants = await svc.listParticipants(roomId);
    const target = participants.find((p) => p.identity === targetUserId);
    if (!target) {
      return NextResponse.json({ error: "User not connected" }, { status: 404 });
    }

    const wanted = kind === "audio" ? TrackType.AUDIO : TrackType.VIDEO;
    let mutedCount = 0;
    for (const t of target.tracks) {
      if (t.type === wanted && !t.muted) {
        await svc.mutePublishedTrack(roomId, targetUserId, t.sid, true);
        mutedCount++;
      }
    }

    return NextResponse.json({ ok: true, muted: mutedCount });
  } catch (e) {
    console.error("host-mute failed", e);
    return NextResponse.json({ error: "Failed to mute" }, { status: 500 });
  }
}
