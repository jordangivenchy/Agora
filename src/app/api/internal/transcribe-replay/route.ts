import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase-admin";
import { getAppConfig } from "@/lib/appConfig";
import {
  MAX_ATTEMPTS,
  cleanLines,
  parseVodPlaylist,
  playlistSignature,
  readProgress,
  retryMinutes,
  spellingNotes,
  tsToAdts,
  type ClipLine,
  type TranscriptProgress,
} from "@/lib/replayTranscribe";
import { timeAndName, transcribeClips } from "@/lib/replayTranscribeRun";
import type { SpeechSpan } from "@/lib/replayAttribution";
import { parseTimeline } from "@/components/agora/hlsTimeline";
import { readHlsEnv, type HlsEnv } from "@/lib/recordingEgress";
import { signS3Request } from "@/lib/s3Sign";

/* Post-run replay transcription. Fired by the replay-transcripts cron
   (pg_net POST) for ended rooms whose recording has finalized: pulls the
   VOD's MPEG-TS segments from R2, extracts the raw AAC audio (no ffmpeg
   — see lib/replayTranscribe), transcribes it with Gemini a few minutes
   at a time, names each line's speaker (lib/replayAttribution) and
   stores the transcript on replay_transcripts, which the replay page
   reads.

   A recording is done in clips of about four minutes
   (lib/replayTranscribeRun), and every finished clip is saved on the
   row at once. A run does as many as fit in its time and hands the
   rest to the next run (the cron comes round every two minutes), so a
   long recording is never started over and never has to finish inside
   one request; a model that is out of capacity costs the clip it was
   on, not the recording. Runs that get nowhere wait longer each time
   and are given up after about a day (retryMinutes, MAX_ATTEMPTS).

   Auth: Bearer <reminder_webhook_secret from app_config> — same
   contract as the other internal webhooks. */

export const maxDuration = 300;

/** Recordings past this are left alone (eight hours — a room left running). */
const MAX_VOD_SECONDS = 8 * 3600;
const MODEL_TIMEOUT_MS = 110_000;

/* gemini-2.5-flash answered 404 "no longer available" in September 2026
   and failed every retry that fell back to it. */
const FALLBACK_MODEL = "gemini-3.6-flash";

interface StoredLine {
  offset_seconds: number;
  end_seconds: number;
  text: string;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface Person {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/* ── the recording's audio ───────────────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Segments are read straight from the bucket with our own key when we
   have one: the public address (r2.dev) is rate-limited, and a long
   recording is a thousand files — that was the 429 that ended a
   24-minute room's transcript. Without the key, or if the signed read
   is refused, the public address is used, gently. */
function makeSegmentReader(hls: HlsEnv | null) {
  let signed = !!hls;
  const base = hls?.publicBase.replace(/\/$/, "");
  const endpoint = hls ? (/^https?:\/\//.test(hls.endpoint) ? hls.endpoint : `https://${hls.endpoint}`).replace(/\/$/, "") : "";

  return async function read(url: string): Promise<Uint8Array> {
    if (signed && hls && base && url.startsWith(`${base}/`)) {
      const direct = `${endpoint}/${hls.bucket}/${url.slice(base.length + 1)}`;
      try {
        const { host: _host, ...headers } = signS3Request({
          method: "GET",
          url: direct,
          body: "",
          accessKey: hls.accessKey,
          secret: hls.secret,
          region: hls.region,
        });
        void _host;
        const res = await fetch(direct, { headers, cache: "no-store" });
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
        if (res.status === 401 || res.status === 403) {
          console.warn(`[transcribe-replay] signed read refused (${res.status}); using the public address`);
          signed = false;
        }
      } catch {
        /* fall through to the public address for this one */
      }
    }
    let wait = 800;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      const busy = res.status === 429 || res.status >= 500;
      if (!busy || attempt >= 4) throw new Error(`segment_fetch_${res.status}`);
      const asked = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(asked) && asked > 0 ? Math.min(asked * 1000, 10_000) : wait);
      wait *= 2;
    }
  };
}

/* ── the model ───────────────────────────────────────────────────── */

async function transcribeClip(aac: Uint8Array, clipSeconds: number, apiKey: string, model: string, notes: string, timeoutMs: number): Promise<ClipLine[]> {
  const prompt =
    "Transcribe this audio recording of a live discussion verbatim. " +
    'Return ONLY a JSON array. Each element is {"t": <number — seconds from the start of THIS clip when the segment begins>, "e": <number — seconds from the start of THIS clip when it ends>, "text": "<transcribed speech>"}. ' +
    "Split into natural sentence-sized segments of at most ~30 words; start a new segment whenever the speaker changes. Use correct punctuation and casing. " +
    "Do not include speaker labels, timestamps inside the text, or any commentary. " +
    "Transcribe only words that are actually spoken and clearly audible. Never guess, complete, paraphrase or invent speech: " +
    "silence, music, noise, breathing, laughter, crosstalk or unintelligible passages produce nothing — leave them out rather than filling them. " +
    "The clip may begin or end in the middle of the discussion: do not add an opening or a closing that isn't spoken. " +
    "Never repeat a segment. If the audio contains no intelligible speech, return []." +
    notes;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ inline_data: { mime_type: "audio/aac", data: Buffer.from(aac).toString("base64") } }, { text: prompt }],
        },
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 65536 },
    }),
  });
  if (!res.ok) throw new Error(`gemini_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "[]";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* An answer can stop mid-array — keep every complete element rather
       than lose the clip. */
    const cut = text.lastIndexOf("}");
    if (cut <= 0) throw new Error("gemini_bad_json");
    try {
      parsed = JSON.parse(text.slice(0, cut + 1).replace(/,\s*$/, "") + "]");
    } catch {
      throw new Error("gemini_bad_json");
    }
  }
  return cleanLines(parsed, clipSeconds);
}

/* 503/429 mean the model is momentarily out of capacity: wait a little
   and ask again, then ask the pinned fallback — as long as the run has
   the time. Past that the clip waits for the next run. */
async function transcribeClipResilient(
  aac: Uint8Array,
  clipSeconds: number,
  apiKey: string,
  model: string,
  notes: string,
  msLeft: () => number
): Promise<{ lines: ClipLine[]; model: string }> {
  let lastErr: unknown;
  for (const m of model === FALLBACK_MODEL ? [model] : [model, FALLBACK_MODEL]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const left = msLeft();
      if (left < 20_000) throw lastErr ?? new Error("out_of_time");
      try {
        return { lines: await transcribeClip(aac, clipSeconds, apiKey, m, notes, Math.min(MODEL_TIMEOUT_MS, left - 5_000)), model: m };
      } catch (e) {
        lastErr = e;
        const msg = String(e instanceof Error ? e.message : e);
        if (!/gemini_(503|429)/.test(msg)) break; // not a capacity answer: the other model
        const pause = 6_000 * (attempt + 1);
        if (msLeft() < pause + 30_000) throw e;
        await sleep(pause);
      }
    }
  }
  throw lastErr;
}

/* ── the run ─────────────────────────────────────────────────────── */

export async function POST(request: NextRequest) {
  const began = Date.now();
  const elapsed = () => Date.now() - began;
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let roomId = "";
  let attempts = 0;
  let progress: TranscriptProgress | null = null;
  let progressed = false;

  /** Not finished, for whatever reason: keep what is done and say when to come back. */
  const comeBack = async (error: string | null) => {
    if (!admin || !roomId) return;
    const count = progressed ? 0 : attempts + 1;
    const givenUp = count >= MAX_ATTEMPTS;
    const wait = progressed ? 0 : retryMinutes(count);
    await admin
      .from("replay_transcripts")
      .update({
        status: givenUp ? "failed" : "queued",
        attempts: count,
        error: error ? error.slice(0, 500) : null,
        ...(progress ? { progress: progress as unknown as object } : {}),
        next_attempt_at: new Date(Date.now() + wait * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("room_id", roomId)
      .then(undefined, () => {});
  };

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
    const id = typeof body?.roomId === "string" ? body.roomId : "";
    if (!id) return NextResponse.json({ error: "Missing roomId" }, { status: 400 });

    const db = createAdminClient();
    const { data: room } = await db
      .from("debate_rooms")
      .select("id, motion, language, recording_url, recording_started_at")
      .eq("id", id)
      .maybeSingle();
    if (!room?.recording_url) {
      return NextResponse.json({ ok: true, skipped: "no_recording" });
    }

    const { data: existing } = await db
      .from("replay_transcripts")
      .select("status, attempts, progress, updated_at")
      .eq("room_id", id)
      .maybeSingle();
    if (existing?.status === "done" || existing?.status === "skipped") {
      return NextResponse.json({ ok: true, skipped: existing.status });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "gemini_not_configured" }, { status: 503 });
    const model = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

    /* One run at a time for a room. A row still "processing" belongs to
       a run that is either at work (leave it) or was stopped before it
       could say so (take it over, and count that against the job). */
    const stale = new Date(Date.now() - 6 * 60_000).toISOString();
    const lostRun = existing?.status === "processing";
    const startAttempts = (existing?.attempts ?? 0) + (lostRun ? 1 : 0);
    if (!existing) {
      await db.from("replay_transcripts").upsert({ room_id: id, status: "queued" }, { onConflict: "room_id", ignoreDuplicates: true });
    }
    const { data: claimed } = await db
      .from("replay_transcripts")
      .update({ status: "processing", attempts: startAttempts, updated_at: new Date().toISOString() })
      .eq("room_id", id)
      .or(`status.in.(queued,failed),and(status.eq.processing,updated_at.lt."${stale}")`)
      .select("room_id");
    if (!claimed?.length) return NextResponse.json({ ok: true, skipped: "in_progress" });
    if (startAttempts >= MAX_ATTEMPTS) {
      /* Run after run stopped before it could report: stop asking. */
      await db
        .from("replay_transcripts")
        .update({ status: "failed", error: "runs_kept_stopping", updated_at: new Date().toISOString() })
        .eq("room_id", id);
      return NextResponse.json({ ok: true, skipped: "given_up" });
    }
    admin = db;
    roomId = id;
    attempts = startAttempts;

    const plRes = await fetch(room.recording_url, { cache: "no-store" });
    if (!plRes.ok) throw new Error(`playlist_fetch_${plRes.status}`);
    const playlistText = await plRes.text();
    const playlist = parseVodPlaylist(playlistText, room.recording_url);
    if (playlist.segments.length === 0) throw new Error("empty_playlist");
    if (playlist.totalDuration > MAX_VOD_SECONDS) {
      await db
        .from("replay_transcripts")
        .update({ status: "skipped", error: "too_long", progress: null, updated_at: new Date().toISOString() })
        .eq("room_id", roomId);
      return NextResponse.json({ ok: true, skipped: "too_long" });
    }
    const segments = playlist.segments;
    progress = readProgress(existing?.progress, playlistSignature(playlist));

    /* Who was on the stage: their names help the model spell, and one
       person alone there is every line's speaker. */
    const { data: seats } = await db.from("debate_participants").select("user_id, role, stage_role").eq("room_id", roomId);
    const stageIds = [
      ...new Set(
        ((seats ?? []) as Array<{ user_id: string | null; role: string | null; stage_role: string | null }>)
          .filter((p) => p.user_id && (p.role === "debater" || (p.stage_role && p.stage_role !== "audience")))
          .map((p) => p.user_id as string)
      ),
    ];
    const people = new Map<string, Person>();
    const loadPeople = async (ids: string[]) => {
      const missing = ids.filter((x) => !people.has(x));
      if (!missing.length) return;
      const { data } = await db.from("users").select("id, username, display_name, avatar_url").in("id", missing.slice(0, 200));
      for (const u of (data ?? []) as Person[]) people.set(u.id, u);
    };
    await loadPeople(stageIds);
    const notes = spellingNotes(room, stageIds.map((x) => people.get(x)).filter((p): p is Person => !!p));

    /* ── clips, until the recording or this run's time is used up ── */
    const read = makeSegmentReader(readHlsEnv());
    const run = await transcribeClips({
      segments,
      progress,
      readAudio: async (segment) => tsToAdts(await read(segment.url)),
      transcribe: (aac, clipSeconds, msLeft) => transcribeClipResilient(aac, clipSeconds, apiKey, model, notes, msLeft),
      save: async (p) => {
        await db
          .from("replay_transcripts")
          .update({ progress: p as unknown as object, error: null, updated_at: new Date().toISOString() })
          .eq("room_id", roomId);
      },
      elapsed,
    });
    progressed = run.progressed;
    if (run.error) console.error(`[transcribe-replay] ${roomId}: clip at segment ${progress.next} failed:`, run.error);

    if (progress.next < segments.length) {
      await comeBack(run.error);
      return NextResponse.json({ ok: true, done: false, segments: `${progress.next}/${segments.length}`, error: run.error });
    }

    /* ── every clip is in: time the lines and name their speakers ── */
    const started = room.recording_started_at ? Date.parse(room.recording_started_at) : NaN;
    const spans: SpeechSpan[] = [];
    {
      const { data, error } = await db.rpc("recording_speech_for", { p_room: roomId });
      if (error) console.warn(`[transcribe-replay] ${roomId}: no speaking notes (${error.message})`);
      for (const row of Array.isArray(data) ? (data as unknown[]) : []) {
        if (!Array.isArray(row) || typeof row[0] !== "string") continue;
        const from = Number(row[1]);
        const to = Number(row[2]);
        if (Number.isFinite(from) && Number.isFinite(to) && to > from) spans.push({ user_id: row[0], from, to });
      }
    }
    /* Live captions, when Agora's listening was on: the older way to a name. */
    const utterances: Array<{ offset: number; user_id: string | null }> = [];
    if (Number.isFinite(started)) {
      const { data: uts } = await db
        .from("debate_utterances")
        .select("user_id, created_at")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(4000);
      for (const u of (uts ?? []) as Array<{ user_id: string | null; created_at: string }>) {
        utterances.push({ offset: (Date.parse(u.created_at) - started) / 1000, user_id: u.user_id });
      }
    }
    const named = timeAndName({
      progress,
      timeline: parseTimeline(playlistText),
      startedAtMs: started,
      spans,
      solo: stageIds.length === 1 ? stageIds[0] : null,
      utterances,
    });
    await loadPeople([...new Set(named.map((l) => l.user_id).filter((x): x is string => !!x))]);
    const lines: StoredLine[] = named.map((l) => {
      const who = l.user_id ? people.get(l.user_id) ?? null : null;
      return {
        offset_seconds: l.offset_seconds,
        end_seconds: l.end_seconds,
        text: l.text,
        user_id: who?.id ?? null,
        username: who?.username ?? null,
        display_name: who?.display_name ?? null,
        avatar_url: who?.avatar_url ?? null,
      };
    });

    await db
      .from("replay_transcripts")
      .update({
        status: "done",
        model: progress.model ?? model,
        error: null,
        lines: lines as unknown as object,
        progress: null,
        next_attempt_at: null,
        attempts: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("room_id", roomId);

    return NextResponse.json({
      ok: true,
      done: true,
      lines: lines.length,
      named: lines.filter((l) => l.user_id).length,
      clips: progress.clips.length,
    });
  } catch (e) {
    console.error("[transcribe-replay] failed:", e);
    await comeBack(String(e instanceof Error ? e.message : e));
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
