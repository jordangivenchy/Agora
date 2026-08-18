import { NextRequest, NextResponse } from "next/server";
import {
  EgressClient,
  EncodingOptions,
  S3Upload,
  SegmentedFileOutput,
  SegmentedFileProtocol,
  StreamOutput,
  StreamProtocol,
} from "livekit-server-sdk";
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
    if (!roomId || !["start", "start_hls", "stop", "stop_all", "status"].includes(action)) {
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

    /* HLS needs an S3-compatible bucket for segments (Supabase Storage's
       S3 endpoint works). Configure in Vercel:
         HLS_S3_ENDPOINT, HLS_S3_REGION, HLS_S3_BUCKET,
         HLS_S3_ACCESS_KEY, HLS_S3_SECRET, HLS_PUBLIC_BASE_URL
       Until then start_hls returns hls_not_configured and the UI hides. */
    const hlsEnv = {
      endpoint: process.env.HLS_S3_ENDPOINT,
      region: process.env.HLS_S3_REGION,
      bucket: process.env.HLS_S3_BUCKET,
      accessKey: process.env.HLS_S3_ACCESS_KEY,
      secret: process.env.HLS_S3_SECRET,
      publicBase: process.env.HLS_PUBLIC_BASE_URL,
    };
    const hlsConfigured = Object.values(hlsEnv).every(Boolean);

    if (action === "status") {
      const active = await egress.listEgress({ roomName: roomId, active: true });
      return NextResponse.json({ egressId: active[0]?.egressId ?? null, hlsConfigured });
    }

    if (action === "start_hls") {
      if (!hlsConfigured) {
        return NextResponse.json({ error: "hls_not_configured" }, { status: 400 });
      }
      if (room.status !== "live") {
        return NextResponse.json({ error: "Room isn't live" }, { status: 400 });
      }
      const info = await egress.startRoomCompositeEgress(
        roomId,
        {
          segments: new SegmentedFileOutput({
            filenamePrefix: `${roomId}/seg`,
            playlistName: `${roomId}/index.m3u8`,
            livePlaylistName: `${roomId}/live.m3u8`,
            segmentDuration: 4,
            protocol: SegmentedFileProtocol.HLS_PROTOCOL,
            output: {
              case: "s3",
              value: new S3Upload({
                endpoint: hlsEnv.endpoint!,
                region: hlsEnv.region!,
                bucket: hlsEnv.bucket!,
                accessKey: hlsEnv.accessKey!,
                secret: hlsEnv.secret!,
                forcePathStyle: true,
              }),
            },
          }),
        },
        {
          layout: "speaker",
          customBaseUrl: `${request.nextUrl.origin}/agora/${roomId}`,
          encodingOptions: new EncodingOptions({
            width: 1920,
            height: 1080,
            framerate: 30,
            videoBitrate: 4500,
            audioBitrate: 128,
          }),
        }
      );
      const hlsUrl = `${hlsEnv.publicBase!.replace(/\/$/, "")}/${roomId}/live.m3u8`;
      await supabase.from("debate_rooms").update({ hls_url: hlsUrl }).eq("id", roomId);
      return NextResponse.json({ egressId: info.egressId, hlsUrl });
    }

    /* Closing the stage stops every restream with it — an egress left
       running against an ended room films a black page and bills minutes. */
    if (action === "stop_all") {
      const active = await egress.listEgress({ roomName: roomId, active: true });
      await Promise.allSettled(active.map((e) => egress.stopEgress(e.egressId)));
      await supabase.from("debate_rooms").update({ hls_url: null }).eq("id", roomId);
      return NextResponse.json({ ok: true, stopped: active.length });
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
    await supabase.from("debate_rooms").update({ hls_url: null }).eq("id", roomId);
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
