import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { isRoomUuid } from "@/lib/roomLifecycle";
import { validSpeechKey } from "@/lib/recordingSpeechKey";

/* The recorder telling us who is speaking. The page LiveKit films for a
   recording (the room's broadcast view, components/agora/useRecorderSpeech)
   posts a handful of spans every few seconds — this account, from here to
   there, on the recorder's own clock — and they are kept in
   recording_speech_spans for the replay's transcript to name its lines
   with (lib/replayAttribution).

   Auth: the pass the recording was started with (lib/recordingSpeechKey),
   signed for this one room. No session, no cookie: the recorder has none. */

const MAX_SPANS = 400;
/** One span of speaking: at least a blip, at most two minutes (the page cuts long turns every few seconds). */
const MIN_MS = 50;
const MAX_MS = 120_000;
/** The recorder's clock against ours: reports held back by a bad connection can be old, never from the future. */
const OLDEST_MS = 30 * 60_000;
const AHEAD_MS = 5 * 60_000;

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!secret || !hasAdminCredentials()) {
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    const body = (await request.json().catch(() => null)) as { roomId?: unknown; key?: unknown; spans?: unknown } | null;
    const roomId = body?.roomId;
    if (!isRoomUuid(roomId) || !validSpeechKey(body?.key, roomId, secret)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const now = Date.now();
    const rows: Array<{ room_id: string; user_id: string; started_at: string; ended_at: string }> = [];
    for (const raw of Array.isArray(body?.spans) ? body.spans.slice(0, MAX_SPANS) : []) {
      const span = raw as { id?: unknown; s?: unknown; e?: unknown } | null;
      if (!span || !isRoomUuid(span.id)) continue; // account ids are uuids too
      const from = Number(span.s);
      const to = Number(span.e);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      if (to - from < MIN_MS || to - from > MAX_MS) continue;
      if (from < now - OLDEST_MS || to > now + AHEAD_MS) continue;
      rows.push({
        room_id: roomId,
        user_id: span.id,
        started_at: new Date(from).toISOString(),
        ended_at: new Date(to).toISOString(),
      });
    }
    if (rows.length) {
      const { error } = await createAdminClient().from("recording_speech_spans").insert(rows);
      if (error) {
        console.error("[recording-speech] insert failed:", error.message);
        return NextResponse.json({ error: "store_failed" }, { status: 500 });
      }
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[recording-speech] failed:", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
