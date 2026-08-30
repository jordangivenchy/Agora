import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";
import { parseVodPlaylist, chunkSegments, tsToAdts, type HlsSegment } from "@/lib/replayTranscribe";

/* Post-run replay transcription. Fired by the replay-transcripts cron
   (pg_net POST) for ended rooms whose recording has finalized: pulls the
   VOD's MPEG-TS segments from R2, extracts the raw AAC audio (no
   ffmpeg — see lib/replayTranscribe), transcribes it in ~9-minute
   chunks with Gemini, attributes lines to speakers by aligning against
   the live utterances, and stores the polished transcript on
   replay_transcripts. The replay page prefers it over the patchy live
   Web-Speech transcript when present.

   Auth: Bearer <reminder_webhook_secret from app_config> — same
   contract as the other internal webhooks. */

export const maxDuration = 300;

const CHUNK_SECONDS = 540; // ~9 min ≈ 8–9 MB of AAC — under inline limits
const MAX_VOD_SECONDS = 4500; // 75 min; longer recordings are skipped in v1
const ATTRIBUTION_WINDOW_S = 8;

interface PolishedLine {
  offset_seconds: number;
  text: string;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface UtteranceRef {
  offset: number;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

async function fetchChunkAac(segments: HlsSegment[]): Promise<Uint8Array> {
  // Fetch a chunk's segments with bounded parallelism, extract in order.
  const buffers: Uint8Array[] = new Array(segments.length);
  const POOL = 8;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(POOL, segments.length) }, async () => {
      while (next < segments.length) {
        const idx = next++;
        const res = await fetch(segments[idx].url);
        if (!res.ok) throw new Error(`segment_fetch_${res.status}`);
        buffers[idx] = tsToAdts(new Uint8Array(await res.arrayBuffer()));
      }
    })
  );
  let total = 0;
  for (const b of buffers) total += b.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of buffers) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

async function transcribeChunk(
  aac: Uint8Array,
  apiKey: string,
  model: string
): Promise<Array<{ t: number; text: string }>> {
  const prompt =
    "Transcribe this audio recording of a live discussion verbatim. " +
    'Return ONLY a JSON array. Each element is {"t": <number — seconds from the start of THIS clip when the segment begins>, "text": "<transcribed speech>"}. ' +
    "Split into natural sentence-sized segments of at most ~30 words. Use correct punctuation and casing. " +
    "Do not include speaker labels, timestamps inside the text, or any commentary. If the audio contains no intelligible speech, return [].";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: "audio/aac", data: Buffer.from(aac).toString("base64") } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 65536 },
      }),
    }
  );
  if (!res.ok) throw new Error(`gemini_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "[]";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* Long chunks can truncate mid-array — salvage every complete
       element rather than losing the whole chunk. */
    const cut = text.lastIndexOf("}");
    if (cut > 0) {
      try {
        parsed = JSON.parse(text.slice(0, cut + 1).replace(/,\s*$/, "") + "]");
      } catch {
        throw new Error("gemini_bad_json");
      }
    } else {
      throw new Error("gemini_bad_json");
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (l): l is { t: number; text: string } =>
        !!l && typeof (l as { t?: unknown }).t === "number" && typeof (l as { text?: unknown }).text === "string"
    )
    .map((l) => ({ t: Math.max(0, l.t), text: l.text.trim() }))
    .filter((l) => l.text.length > 0);
}

export async function POST(request: NextRequest) {
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let roomId = "";
  try {
    if (!hasAdminCredentials()) {
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    const cfg = await getAppConfig();
    const secret = cfg.reminder_webhook_secret;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    roomId = typeof body?.roomId === "string" ? body.roomId : "";
    if (!roomId) return NextResponse.json({ error: "Missing roomId" }, { status: 400 });

    admin = createAdminClient();
    const { data: room } = await admin
      .from("debate_rooms")
      .select("id, recording_url, recording_started_at")
      .eq("id", roomId)
      .maybeSingle();
    if (!room?.recording_url) {
      return NextResponse.json({ ok: true, skipped: "no_recording" });
    }

    const { data: existing } = await admin
      .from("replay_transcripts")
      .select("status, attempts")
      .eq("room_id", roomId)
      .maybeSingle();
    if (existing?.status === "done" || existing?.status === "skipped") {
      return NextResponse.json({ ok: true, skipped: existing.status });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "gemini_not_configured" }, { status: 503 });
    const model = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

    await admin.from("replay_transcripts").upsert({
      room_id: roomId,
      status: "processing",
      attempts: (existing?.attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    });

    const plRes = await fetch(room.recording_url);
    if (!plRes.ok) throw new Error(`playlist_fetch_${plRes.status}`);
    const playlist = parseVodPlaylist(await plRes.text(), room.recording_url);
    if (playlist.segments.length === 0) throw new Error("empty_playlist");
    if (playlist.totalDuration > MAX_VOD_SECONDS) {
      await admin
        .from("replay_transcripts")
        .update({ status: "skipped", error: "too_long_v1", updated_at: new Date().toISOString() })
        .eq("room_id", roomId);
      return NextResponse.json({ ok: true, skipped: "too_long_v1" });
    }

    /* Live utterances give speaker attribution. Their offsets are from
       recording_started_at (the egress REQUEST); the playlist's
       PROGRAM-DATE-TIME is the true first frame — same correction the
       replay page applies (syncDelta). */
    const started = room.recording_started_at ? Date.parse(room.recording_started_at) : NaN;
    let syncDelta = 0;
    if (playlist.programDateTime && Number.isFinite(started)) {
      const d = (playlist.programDateTime - started) / 1000;
      if (d > 0 && d < 120) syncDelta = d;
    }
    const utterances: UtteranceRef[] = [];
    if (Number.isFinite(started)) {
      const { data: uts } = await admin
        .from("debate_utterances")
        .select("user_id, created_at, users(username, display_name, avatar_url)")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(4000);
      for (const u of (uts ?? []) as unknown as Array<{
        user_id: string | null;
        created_at: string;
        users: { username: string; display_name: string | null; avatar_url: string | null } | null;
      }>) {
        utterances.push({
          offset: (Date.parse(u.created_at) - started) / 1000,
          user_id: u.user_id,
          username: u.users?.username ?? null,
          display_name: u.users?.display_name ?? null,
          avatar_url: u.users?.avatar_url ?? null,
        });
      }
    }

    const chunks = chunkSegments(playlist.segments, CHUNK_SECONDS);
    const lines: PolishedLine[] = [];
    for (const chunk of chunks) {
      const chunkOffset = chunk[0].offset;
      const aac = await fetchChunkAac(chunk);
      if (aac.length < 1000) continue; // silent/empty chunk
      const raw = await transcribeChunk(aac, apiKey, model);
      for (const l of raw) {
        const videoT = chunkOffset + l.t;
        /* Store offsets in the recording_started_at frame — the same one
           live utterances use — so the replay page's syncDelta math
           applies identically to both transcript sources. */
        const frameT = videoT + syncDelta;
        let speaker: UtteranceRef | null = null;
        let best = ATTRIBUTION_WINDOW_S + 1;
        for (const u of utterances) {
          const d = Math.abs(u.offset - frameT);
          if (d < best) {
            best = d;
            speaker = u;
          }
        }
        lines.push({
          offset_seconds: Math.round(frameT * 10) / 10,
          text: l.text,
          user_id: speaker?.user_id ?? null,
          username: speaker?.username ?? null,
          display_name: speaker?.display_name ?? null,
          avatar_url: speaker?.avatar_url ?? null,
        });
      }
    }
    lines.sort((a, b) => a.offset_seconds - b.offset_seconds);

    await admin
      .from("replay_transcripts")
      .update({
        status: "done",
        model,
        error: null,
        lines: lines as unknown as object,
        updated_at: new Date().toISOString(),
      })
      .eq("room_id", roomId);

    return NextResponse.json({ ok: true, lines: lines.length, chunks: chunks.length });
  } catch (e) {
    console.error("[transcribe-replay] failed:", e);
    if (admin && roomId) {
      await admin
        .from("replay_transcripts")
        .update({
          status: "failed",
          error: String(e instanceof Error ? e.message : e).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("room_id", roomId)
        .then(undefined, () => {});
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
