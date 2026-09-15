import { NextRequest, NextResponse } from "next/server";
import { EncodingOptions, StreamOutput, StreamProtocol } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { checkRecording, egressClient, isRecording, readHlsEnv, startRecordingPart } from "@/lib/recordingEgress";

/* The live playlist dies with the stream; the recording (recording_url)
   stays so the ended room can be replayed. recording_ended_at only lands
   for rooms that were actually recording. Runs BEFORE the recorder is
   stopped: a cleared hls_url is how the LiveKit webhook tells a
   deliberate stop from a recorder that died (lib/recordingParts). */
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
    if (!roomId || !["start", "start_hls", "stop", "stop_all", "status", "check_recording"].includes(action)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data: room } = await supabase
      .from("debate_rooms")
      .select("host_id, status, is_private, access_mode")
      .eq("id", roomId)
      .maybeSingle();
    if (!room || room.host_id !== user.id) {
      return NextResponse.json({ error: "Host only" }, { status: 403 });
    }

    const egress = egressClient();
    if (!egress) {
      return NextResponse.json({ error: "LiveKit not configured" }, { status: 500 });
    }
    const hlsEnv = readHlsEnv();
    const hlsConfigured = !!hlsEnv && hasAdminCredentials();

    if (action === "status") {
      const active = await egress.listEgress({ roomName: roomId, active: true });
      return NextResponse.json({ egressId: active[0]?.egressId ?? null, hlsConfigured });
    }

    /* The host's page asks every little while during a recorded call: a
       recorder LiveKit has let go of is closed and the next part starts
       (lib/recordingEgress), whether or not the webhook said so. */
    if (action === "check_recording") {
      if (!hlsEnv || !hasAdminCredentials()) return NextResponse.json({ state: "idle" });
      const state = await checkRecording(createAdminClient(), egress, hlsEnv, roomId, request.nextUrl.origin);
      return NextResponse.json({ state });
    }

    if (action === "start_hls") {
      /* Idempotent: an HLS egress already filming this room is reused —
         the auto-start on the host's client can fire safely on reconnects. */
      {
        const active = await egress.listEgress({ roomName: roomId, active: true });
        const existing = active.find(isRecording);
        if (existing) {
          return NextResponse.json({ egressId: existing.egressId, reused: true });
        }
      }
      if (!hlsConfigured || !hlsEnv) {
        return NextResponse.json({ error: "hls_not_configured" }, { status: 400 });
      }
      if (room.status !== "live") {
        return NextResponse.json({ error: "Room isn't live" }, { status: 400 });
      }
      /* Followers/friends/community rooms must not broadcast: the HLS
         playlist sits on a public bucket at a room-id-derived URL, so any
         link-holder could watch it, bypassing the access gate. These
         rooms are small by nature (no overflow), so skipping HLS costs
         nothing. */
      if (room.is_private && ["followers", "friends", "community"].includes(room.access_mode)) {
        return NextResponse.json({ error: "private_no_broadcast" }, { status: 409 });
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
      /* Nothing is filming (checked above), so a part still marked open
         ended without word from LiveKit; the next part starts after it —
         a host who stops and starts again keeps the earlier part. */
      const started = await startRecordingPart({
        admin: createAdminClient(),
        egress,
        hls: hlsEnv,
        roomId,
        origin: request.nextUrl.origin,
        closeOpen: true,
      });
      if (!started) return NextResponse.json({ error: "recording_starting" }, { status: 409 });
      return NextResponse.json({ egressId: started.egressId, hlsUrl: started.hlsUrl, part: started.part });
    }

    /* Closing the stage stops every restream with it — an egress left
       running against an ended room films a black page and bills minutes. */
    if (action === "stop_all") {
      await markStreamStopped(supabase, roomId);
      const active = await egress.listEgress({ roomName: roomId, active: true });
      await Promise.allSettled(active.map((e) => egress.stopEgress(e.egressId)));
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
         the stage over the flat backdrop (the 3D scene ran LiveKit's
         recorders out of CPU), not a bare camera grid. Portrait preset
         frames it for TikTok; 720p for the same reason as recordings. */
      const info = await egress.startRoomCompositeEgress(
        roomId,
        { stream: new StreamOutput({ protocol: StreamProtocol.RTMP, urls: [rtmpUrl.trim()] }) },
        {
          layout: "speaker",
          customBaseUrl: `${request.nextUrl.origin}/agora/${roomId}`,
          encodingOptions: new EncodingOptions({
            width: portrait ? 720 : 1280,
            height: portrait ? 1280 : 720,
            framerate: 30,
            videoBitrate: 3500,
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
    /* Stopping the restream alone leaves the recording (and hls_url) be.
       Stopping the recording stops whichever part is filming now — a
       page can hold the id of a part that has since been replaced. */
    const target = (await egress.listEgress({ egressId }).catch(() => [])).find((e) => e.egressId === egressId);
    if (target && !isRecording(target)) {
      await egress.stopEgress(egressId);
      return NextResponse.json({ ok: true });
    }
    await markStreamStopped(supabase, roomId);
    const recorders = (await egress.listEgress({ roomName: roomId, active: true })).filter(isRecording);
    const ids = new Set([...recorders.map((e) => e.egressId), ...(target ? [] : [egressId])]);
    await Promise.allSettled([...ids].map((id) => egress.stopEgress(id)));
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
