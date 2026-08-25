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

/* The live playlist dies with the stream; the recording (recording_url)
   stays so the ended room can be replayed. recording_ended_at only lands
   for rooms that were actually recording. */
async function markStreamStopped(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roomId: string
) {
  await supabase.from("debate_rooms").update({ hls_url: null }).eq("id", roomId);
  await supabase
    .from("debate_rooms")
    .update({ recording_ended_at: new Date().toISOString() })
    .eq("id", roomId)
    .not("recording_url", "is", null)
    .is("recording_ended_at", null);
}

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
      /* Idempotent: an HLS egress already filming this room is reused —
         the auto-start on the host's client can fire safely on reconnects. */
      {
        const active = await egress.listEgress({ roomName: roomId, active: true });
        const existing = active.find((e) => e.request?.case === "roomComposite");
        if (existing) {
          return NextResponse.json({ egressId: existing.egressId, reused: true });
        }
      }
      if (!hlsConfigured) {
        return NextResponse.json({ error: "hls_not_configured" }, { status: 400 });
      }
      if (room.status !== "live") {
        return NextResponse.json({ error: "Room isn't live" }, { status: 400 });
      }
      /* VOD gating: recording is a host choice (Settings → Recordings),
         and stops being offered once the host's storage allowance is
         full — the allowance is the paid-plan lever. Both answers are
         benign choices, not faults; the auto-start client skips quietly.
         A pre-migration DB returns null and fails open. */
      const { data: vod } = await supabase.rpc("get_recording_usage");
      if (vod && typeof vod === "object") {
        const v = vod as { used_bytes?: number; limit_mb?: number; record_debates?: boolean };
        if (v.record_debates === false) {
          return NextResponse.json({ error: "recording_disabled" }, { status: 409 });
        }
        if ((v.used_bytes ?? 0) >= (v.limit_mb ?? 5120) * 1024 * 1024) {
          return NextResponse.json({ error: "storage_full" }, { status: 409 });
        }
      }
      const info = await egress.startRoomCompositeEgress(
        roomId,
        {
          segments: new SegmentedFileOutput({
            filenamePrefix: `${roomId}/seg`,
            playlistName: `${roomId}/index.m3u8`,
            livePlaylistName: `${roomId}/live.m3u8`,
            segmentDuration: 2, // shorter segments ≈ 7-10s glass-to-glass for broadcast viewers
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
      const base = hlsEnv.publicBase!.replace(/\/$/, "");
      const hlsUrl = `${base}/${roomId}/live.m3u8`;
      /* index.m3u8 is the VOD playlist LiveKit finalizes when egress stops —
         it persists in the bucket, so it IS the replay. Record it now (the
         row outlives the stream) alongside the start time the transcript
         offsets are measured from. */
      await supabase
        .from("debate_rooms")
        .update({
          hls_url: hlsUrl,
          recording_url: `${base}/${roomId}/index.m3u8`,
          recording_started_at: new Date().toISOString(),
          recording_ended_at: null,
        })
        .eq("id", roomId);
      return NextResponse.json({ egressId: info.egressId, hlsUrl });
    }

    /* Closing the stage stops every restream with it — an egress left
       running against an ended room films a black page and bills minutes. */
    if (action === "stop_all") {
      const active = await egress.listEgress({ roomName: roomId, active: true });
      await Promise.allSettled(active.map((e) => egress.stopEgress(e.egressId)));
      await markStreamStopped(supabase, roomId);
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
    await markStreamStopped(supabase, roomId);
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
