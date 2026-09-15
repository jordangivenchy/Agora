/* Starting and ending a room's recording parts against LiveKit — the I/O
   around lib/recordingParts. Used by /api/egress (the host's start and
   stop) and the LiveKit webhook (a recorder that stopped on its own).
   Bookkeeping goes through the claim_/finish_recording_part functions
   (20260915_recording_parts.sql) with the service role, so two starts
   can never film the same room at once. */

import {
  EgressClient,
  EncodingOptions,
  S3Upload,
  SegmentedFileOutput,
  SegmentedFileProtocol,
  type EgressInfo,
} from "livekit-server-sdk";
import type { createAdminClient } from "@/lib/supabase-admin";
import { partFiles, recordingUrlFor } from "@/lib/recordingParts";

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
      }
    );
  } catch (e) {
    await admin.rpc("drop_recording_part", { p_room: roomId, p_n: n });
    throw e;
  }
  await admin.rpc("set_recording_part_egress", { p_room: roomId, p_n: n, p_egress: info.egressId });

  /* index.m3u8 is the VOD playlist LiveKit finalizes when the part ends —
     it persists in the bucket, so it IS the replay (stitched with the
     other parts past the first). Part 1 also stamps the start the
     transcript offsets are measured from. */
  const base = hls.publicBase.replace(/\/$/, "");
  const hlsUrl = `${base}/${files.livePlaylistName}`;
  await admin
    .from("debate_rooms")
    .update(
      n === 1
        ? {
            hls_url: hlsUrl,
            recording_url: recordingUrlFor(base, origin, roomId, 1),
            recording_started_at: new Date().toISOString(),
            recording_ended_at: null,
            recording_bytes: null,
          }
        : { hls_url: hlsUrl, recording_url: recordingUrlFor(base, origin, roomId, n), recording_ended_at: null }
    )
    .eq("id", roomId);
  return { egressId: info.egressId, hlsUrl, part: n };
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
