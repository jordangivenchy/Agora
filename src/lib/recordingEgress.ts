/* Starting and ending a room's recording parts against LiveKit — the I/O
   around lib/recordingParts. Used by /api/egress (the host's start and
   stop, and the host page's check on a running recording) and the
   LiveKit webhook (a recorder that stopped on its own).
   Bookkeeping goes through the claim_/finish_recording_part functions
   (20260915_recording_parts.sql) with the service role, so two starts
   can never film the same room at once. */

import {
  EgressClient,
  EncodingOptions,
  S3Upload,
  SegmentedFileOutput,
  SegmentedFileProtocol,
  WebhookConfig,
  type EgressInfo,
} from "livekit-server-sdk";
import type { createAdminClient } from "@/lib/supabase-admin";
import { partFiles, readParts, recordingUrlFor, replayKey, shouldRestart, stitchPlaylists } from "@/lib/recordingParts";
import { signS3Request } from "@/lib/s3Sign";

type Admin = ReturnType<typeof createAdminClient>;

/* HLS needs an S3-compatible bucket for segments. Configure in Vercel:
     HLS_S3_ENDPOINT, HLS_S3_REGION, HLS_S3_BUCKET,
     HLS_S3_ACCESS_KEY, HLS_S3_SECRET, HLS_PUBLIC_BASE_URL
   Until then start_hls returns hls_not_configured and the UI hides. */
export interface HlsEnv {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secret: string;
  publicBase: string;
}

export function readHlsEnv(): HlsEnv | null {
  const env = {
    endpoint: process.env.HLS_S3_ENDPOINT,
    region: process.env.HLS_S3_REGION,
    bucket: process.env.HLS_S3_BUCKET,
    accessKey: process.env.HLS_S3_ACCESS_KEY,
    secret: process.env.HLS_S3_SECRET,
    publicBase: process.env.HLS_PUBLIC_BASE_URL,
  };
  return Object.values(env).every(Boolean) ? (env as HlsEnv) : null;
}

export function egressClient(): EgressClient | null {
  const lkUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!lkUrl || !apiKey || !apiSecret) return null;
  return new EgressClient(lkUrl.replace(/^wss?:\/\//, "https://"), apiKey, apiSecret);
}

/* The recorder films our own room page in a browser on LiveKit's
   machines, with no graphics card. At 1080p that page — then the 3D
   amphitheater — ran LiveKit's recorders out of CPU ~20 s into every
   camera room. 720p is 44% of the pixels to draw and encode; the page
   itself drops the scene and the blur when it's being filmed. */
export const RECORDING_ENCODING = () =>
  new EncodingOptions({ width: 1280, height: 720, framerate: 30, videoBitrate: 3000, audioBitrate: 128 });

/** Start the next part of a room's recording. `closeOpen`: the caller has
    checked LiveKit and nothing is filming, so any part still marked open
    is finished. Returns null when another start holds the claim. */
export async function startRecordingPart(opts: {
  admin: Admin;
  egress: EgressClient;
  hls: HlsEnv;
  roomId: string;
  origin: string;
  closeOpen: boolean;
}): Promise<{ egressId: string; hlsUrl: string; part: number } | null> {
  const { admin, egress, hls, roomId, origin } = opts;
  const { data: claimed, error } = await admin.rpc("claim_recording_part", { p_room: roomId, p_close_open: opts.closeOpen });
  if (error) throw new Error(`claim_recording_part: ${error.message}`);
  const n = typeof claimed === "number" ? claimed : null;
  if (!n) return null;

  const files = partFiles(roomId, n);
  let info: EgressInfo;
  try {
    info = await egress.startRoomCompositeEgress(
      roomId,
      {
        segments: new SegmentedFileOutput({
          ...files,
          segmentDuration: 2, // shorter segments ≈ 7-10s glass-to-glass for broadcast viewers
          protocol: SegmentedFileProtocol.HLS_PROTOCOL,
          output: {
            case: "s3",
            value: new S3Upload({
              endpoint: hls.endpoint,
              region: hls.region,
              bucket: hls.bucket,
              accessKey: hls.accessKey,
              secret: hls.secret,
              forcePathStyle: true,
            }),
          },
        }),
      },
      {
        layout: "speaker",
        customBaseUrl: `${origin}/agora/${roomId}`,
        encodingOptions: RECORDING_ENCODING(),
        /* The project webhook didn't bring this recorder's end in
           production; LiveKit sends a request's own webhooks too. */
        webhooks: process.env.LIVEKIT_API_KEY
          ? [new WebhookConfig({ url: `${origin}/api/webhook/livekit`, signingKey: process.env.LIVEKIT_API_KEY })]
          : [],
      }
    );
  } catch (e) {
    await admin.rpc("drop_recording_part", { p_room: roomId, p_n: n });
    throw e;
  }
  await admin.rpc("set_recording_part_egress", { p_room: roomId, p_n: n, p_egress: info.egressId });

  /* index.m3u8 is the VOD playlist LiveKit finalizes when the part ends —
     it persists in the bucket, so it IS the replay (stitched with the
     other parts past the first, in replay.m3u8). Part 1 also stamps the
     start the transcript offsets are measured from. */
  const base = hls.publicBase.replace(/\/$/, "");
  const hlsUrl = `${base}/${files.livePlaylistName}`;
  await admin
    .from("debate_rooms")
    .update(
      n === 1
        ? {
            hls_url: hlsUrl,
            recording_url: recordingUrlFor(base, roomId, 1),
            recording_started_at: new Date().toISOString(),
            recording_ended_at: null,
            recording_bytes: null,
          }
        : { hls_url: hlsUrl, recording_ended_at: null }
    )
    .eq("id", roomId);
  if (n > 1) await writeReplayPlaylist(admin, hls, roomId).catch((e) => console.error(`[recording] ${roomId}: replay playlist`, e));
  return { egressId: info.egressId, hlsUrl, part: n };
}

/** Put one small object into the recordings bucket (path-style, signed). */
async function putObject(hls: HlsEnv, key: string, body: string, contentType: string) {
  const endpoint = (/^https?:\/\//.test(hls.endpoint) ? hls.endpoint : `https://${hls.endpoint}`).replace(/\/$/, "");
  const url = `${endpoint}/${hls.bucket}/${key}`;
  const signed = signS3Request({
    method: "PUT",
    url,
    body,
    headers: { "content-type": contentType, "cache-control": "no-cache" },
    accessKey: hls.accessKey,
    secret: hls.secret,
    region: hls.region,
  });
  const { host: _host, ...headers } = signed;
  void _host;
  const res = await fetch(url, { method: "PUT", headers, body });
  if (!res.ok) throw new Error(`put ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** Stitch a room's parts into <room>/replay.m3u8, beside the segments.
    Rewritten whenever a part starts or ends; final (ENDLIST) once the room
    has ended and every part's playlist is. The replay moves to it only
    once it's written — until then recording_url stays on part 1, which
    plays. */
export async function writeReplayPlaylist(admin: Admin, hls: HlsEnv, roomId: string): Promise<{ url: string; final: boolean } | null> {
  const { data: room } = await admin
    .from("debate_rooms")
    .select("status, recording_url, recording_parts")
    .eq("id", roomId)
    .maybeSingle();
  if (!room?.recording_url) return null;
  const parts = readParts(room.recording_parts, room.recording_url);
  if (parts.length < 2) return null;
  const base = hls.publicBase.replace(/\/$/, "");
  const playlists = await Promise.all(
    parts.map(async (p) => {
      const url = `${base}/${partFiles(roomId, p.n).playlistName}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        return { url, text: res.ok ? await res.text() : null };
      } catch {
        return { url, text: null };
      }
    })
  );
  const url = `${base}/${replayKey(roomId)}`;
  const body = stitchPlaylists(playlists, room.status === "ended", url);
  await putObject(hls, replayKey(roomId), body, "application/vnd.apple.mpegurl");
  if (room.recording_url !== url) {
    await admin.from("debate_rooms").update({ recording_url: url }).eq("id", roomId);
  }
  return { url, final: body.includes("#EXT-X-ENDLIST") };
}

/** What LiveKit reported for a finished HLS recorder, or null for anything
    else (an RTMP restream has no segments). */
export function segmentsResult(info: EgressInfo): { duration: number; bytes: number } | null {
  const seg = info.result?.case === "segments" ? info.result.value : info.segmentResults?.[0];
  if (!seg) return null;
  return { duration: Number(seg.duration) / 1e9, bytes: Number(seg.size) };
}

/** An egress writing HLS segments — the room's recording, not a restream. */
export function isRecording(e: EgressInfo): boolean {
  if (e.request?.case !== "roomComposite") return false;
  const req = e.request.value;
  return req.segmentOutputs.length > 0 || req.output?.case === "segments";
}

type RoomState = { status: string | null; hls_url: string | null; parts: number };

/** Close a part with what LiveKit reported (idempotent). */
async function closePart(admin: Admin, roomId: string, egressId: string, endedAt: string, duration: number, bytes: number): Promise<RoomState | null> {
  const { data, error } = await admin.rpc("finish_recording_part", {
    p_room: roomId,
    p_egress: egressId,
    p_ended_at: endedAt,
    p_duration: duration,
    p_bytes: bytes,
  });
  if (error) throw new Error(`finish_recording_part: ${error.message}`);
  return (data as RoomState | null) ?? null;
}

/* After a part closes: stitch a recording in parts again (final once the
   room has ended), and start the next part if the room is still live and
   still wants recording — every deliberate stop clears hls_url first.
   Viewers on the broadcast fall back to the call while it restarts. */
async function carryOn(opts: { admin: Admin; egress: EgressClient; hls: HlsEnv; roomId: string; origin: string; endedEgressId: string; room: RoomState; why: string }) {
  const { admin, egress, hls, roomId, origin, room } = opts;
  if (room.parts >= 2) {
    await writeReplayPlaylist(admin, hls, roomId).catch((e) => console.error(`[recording] ${roomId}: replay playlist`, e));
  }
  if (room.status !== "live" || !room.hls_url) return "finished" as const;
  const active = await egress.listEgress({ roomName: roomId, active: true });
  const otherRecorder = active.some((e) => e.egressId !== opts.endedEgressId && isRecording(e));
  if (!shouldRestart(room, otherRecorder)) return "finished" as const;
  console.warn(`[recording] ${roomId}: part ended while live (${opts.why}), starting the next`);
  await admin.from("debate_rooms").update({ hls_url: null }).eq("id", roomId).eq("status", "live");
  const started = await startRecordingPart({ admin, egress, hls, roomId, origin, closeOpen: false });
  return started ? ("restarted" as const) : ("claimed" as const);
}

const nsToIso = (ns: bigint) => (ns ? new Date(Number(ns / BigInt(1_000_000))).toISOString() : new Date().toISOString());

/** LiveKit's egress_ended for one of our recorders. */
export async function recorderEnded(admin: Admin, egress: EgressClient, hls: HlsEnv, info: EgressInfo, origin: string) {
  const result = segmentsResult(info);
  if (!result) return "not_recording" as const; // restreams carry no segments
  const room = await closePart(admin, info.roomName, info.egressId, nsToIso(info.endedAt), result.duration, result.bytes);
  if (!room) return "finished" as const;
  return carryOn({ admin, egress, hls, roomId: info.roomName, origin, endedEgressId: info.egressId, room, why: info.details || info.error || "no reason given" });
}

/** The host's page, every little while during a recorded call: is the
    recorder still running? If LiveKit has let it go and word never came
    (the webhook), close its part from LiveKit's own record and carry on. */
export async function checkRecording(admin: Admin, egress: EgressClient, hls: HlsEnv, roomId: string, origin: string) {
  const { data: row } = await admin
    .from("debate_rooms")
    .select("status, hls_url, recording_url, recording_parts")
    .eq("id", roomId)
    .maybeSingle();
  if (!row || row.status !== "live" || !row.hls_url || !row.recording_url) return "idle" as const;
  const active = await egress.listEgress({ roomName: roomId, active: true });
  if (active.some(isRecording)) return "recording" as const;
  const parts = readParts(row.recording_parts, row.recording_url as string);
  const open = [...parts].reverse().find((p) => !p.ended_at && p.egress_id);
  if (!open?.egress_id) {
    /* Nothing running and nothing on record to close: start after whatever there is. */
    const started = await startRecordingPart({ admin, egress, hls, roomId, origin, closeOpen: true });
    return started ? ("restarted" as const) : ("claimed" as const);
  }
  const [info] = await egress.listEgress({ egressId: open.egress_id }).catch(() => [] as EgressInfo[]);
  const result = info ? segmentsResult(info) : null;
  const room = await closePart(admin, roomId, open.egress_id, info ? nsToIso(info.endedAt) : new Date().toISOString(), result?.duration ?? 0, result?.bytes ?? 0);
  if (!room) return "idle" as const;
  return carryOn({ admin, egress, hls, roomId, origin, endedEgressId: open.egress_id, room, why: info?.details || "no longer running" });
}
