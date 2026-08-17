import { NextRequest, NextResponse } from "next/server";
import { EgressClient, EncodingOptions, StreamOutput, StreamProtocol } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase-server";

/**
 * Restream a room to an external RTMP destination (TikTok, Twitch,
 * YouTube…). LiveKit composites the room server-side and pushes RTMP;
 * the streamer supplies their platform's ingest URL + key. Host-only,
 * same authorization pattern as host-mute.
 *
 * POST { roomId, action: "start", rtmpUrl } → { egressId }
 * POST { roomId, action: "stop", egressId } → { ok }
 * POST { roomId, action: "status" }         → { egressId | null }
 */
export async function POST(request: NextRequest) {
  try {
    const { roomId, action, rtmpUrl, egressId, portrait } = await request.json();
    if (!roomId || !["start", "stop", "status"].includes(action)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data: room } = await supabase
      .from("debate_rooms")
      .select("host_id, status")
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
    const egress = new EgressClient(lkUrl.replace(/^wss?:\/\//, "https://"), apiKey, apiSecret);

    if (action === "status") {
      const active = await egress.listEgress({ roomName: roomId, active: true });
      return NextResponse.json({ egressId: active[0]?.egressId ?? null });
    }

    if (action === "start") {
      if (typeof rtmpUrl !== "string" || !/^rtmps?:\/\/.+/.test(rtmpUrl.trim())) {
        return NextResponse.json(
          { error: "Enter the full RTMP URL including your stream key (rtmp://…)" },
          { status: 400 }
        );
      }
      if (room.status !== "live") {
        return NextResponse.json({ error: "Room isn't live" }, { status: 400 });
      }
      /* Custom template: the compositor films our own broadcast page —
         the full amphitheater (crowd + stage + holo screens), not a bare
         camera grid. Portrait preset frames it for TikTok. */
      const info = await egress.startRoomCompositeEgress(
        roomId,
        { stream: new StreamOutput({ protocol: StreamProtocol.RTMP, urls: [rtmpUrl.trim()] }) },
        {
          layout: "speaker",
          customBaseUrl: `${request.nextUrl.origin}/agora/${roomId}`,
          /* Explicit 1080p @ 6 Mbps: the animated 3D scene (stars, torch
             flicker, camera drift) smears badly at preset 720p bitrates. */
          encodingOptions: new EncodingOptions({
            width: portrait ? 1080 : 1920,
            height: portrait ? 1920 : 1080,
            framerate: 30,
            videoBitrate: 6000,
            audioBitrate: 128,
          }),
        }
      );
      return NextResponse.json({ egressId: info.egressId });
    }

    // stop
    if (typeof egressId !== "string" || !egressId) {
      return NextResponse.json({ error: "Missing egressId" }, { status: 400 });
    }
    await egress.stopEgress(egressId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("egress error", e);
    /* Surface LiveKit's validation reason — "Egress failed" alone sends
       people hunting through server logs for a bad RTMP URL. */
    const msg = e instanceof Error && /invalid|missing|bad request/i.test(e.message)
      ? `Rejected by the streaming service: ${e.message.replace(/^Bad Request:\s*/i, "")}`
      : "Egress failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
