/* One run of the transcript job, without the database or the network —
   those are handed in — so the part that decides things can be tested:
   which clip is next, where it is cut, when a run stops and what it has
   to show for it; and, once every clip is in, each line's time and
   speaker. /api/internal/transcribe-replay supplies the real reads,
   the model and the row. */

import {
  chunkLength,
  heardAt,
  quietEdges,
  segmentsFor,
  soundSeconds,
  type ClipLine,
  type HlsSegment,
  type TranscriptProgress,
} from "@/lib/replayTranscribe";
import { lineEnd, pickSpeakers, type SpeechSpan } from "@/lib/replayAttribution";
import { recordingOffset, wallClock, type TimelineSpan } from "@/components/agora/hlsTimeline";

export interface RunLimits {
  /** A clip for the model: about this long, shorter when a pause comes first. */
  clipSeconds: number;
  /** How far back from the planned end to look for that pause (segments). */
  pauseReach: number;
  /** No new clip is started after this much of a run. */
  startBeforeMs: number;
  /** The run must be over by here. */
  hardStopMs: number;
}

/* About four minutes a clip: short enough that one answer from the model
   is quick, its timing stays close, and a busy model costs little;
   long enough that a recording isn't cut in many places (a cut can cost
   a word — it falls on a pause only when the microphones were muted
   there, an open one is never quite silent). A function runs five
   minutes at most; a clip started at three still has time to finish. */
export const RUN_LIMITS: RunLimits = {
  clipSeconds: 240,
  pauseReach: 15,
  startBeforeMs: 180_000,
  hardStopMs: 280_000,
};

function join(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const b of parts) total += b.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of parts) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

/** Transcribe clips from where `progress` stands until the recording or
    the run's time is used up. Each finished clip is added to `progress`
    and saved before the next begins. A clip that fails ends the run; the
    clips before it are kept. */
export async function transcribeClips(opts: {
  segments: HlsSegment[];
  progress: TranscriptProgress;
  /** A segment's audio (ADTS AAC). */
  readAudio: (segment: HlsSegment) => Promise<Uint8Array>;
  transcribe: (aac: Uint8Array, clipSeconds: number, msLeft: () => number) => Promise<{ lines: ClipLine[]; model: string }>;
  save: (progress: TranscriptProgress) => Promise<void>;
  /** Milliseconds since the run began. */
  elapsed: () => number;
  limits?: RunLimits;
  /** Segments read at once. */
  pool?: number;
}): Promise<{ progressed: boolean; error: string | null }> {
  const { segments, progress, elapsed } = opts;
  const limits = opts.limits ?? RUN_LIMITS;
  const pool = Math.max(1, opts.pool ?? 6);
  let progressed = false;

  while (progress.next < segments.length && elapsed() < limits.startBeforeMs) {
    const from = progress.next;
    const planned = segmentsFor(segments, from, limits.clipSeconds);
    try {
      /* One segment past the plan, to see whether the plan ends on a pause. */
      const wanted = segments.slice(from, from + planned + 1);
      const audio: Uint8Array[] = new Array(wanted.length);
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(pool, wanted.length) }, async () => {
          while (next < wanted.length) {
            const idx = next++;
            audio[idx] = await opts.readAudio(wanted[idx]);
          }
        })
      );
      const edges = audio.map((a) => quietEdges(a));
      const count = chunkLength(edges, Math.min(planned, audio.length), limits.pauseReach);
      const aac = join(audio.slice(0, count));
      const clipOffset = segments[from].offset;
      const clipSeconds =
        edges.slice(0, count).reduce((s, e) => s + e.duration, 0) || segments.slice(from, from + count).reduce((s, x) => s + x.duration, 0);
      const sound = soundSeconds(aac);
      let lines: ClipLine[] = [];
      /* Silence never goes to the model, and nothing it says over silence is kept. */
      if (aac.length >= 1000 && sound.some(Boolean)) {
        const heard = await opts.transcribe(aac, clipSeconds, () => limits.hardStopMs - elapsed());
        progress.model = heard.model;
        lines = heard.lines.filter((l) => heardAt(sound, l.t));
      }
      const round = (n: number) => Math.round(n * 100) / 100;
      progress.clips.push({
        from,
        to: from + count,
        lines: lines.map((l) => ({
          t: round(clipOffset + l.t),
          ...(l.e !== undefined ? { e: round(clipOffset + l.e) } : {}),
          text: l.text,
        })),
      });
      progress.next = from + count;
      progressed = true;
      await opts.save(progress);
    } catch (e) {
      return { progressed, error: String(e instanceof Error ? e.message : e) };
    }
  }
  return { progressed, error: null };
}

export interface NamedLine {
  /** Seconds from recording_started_at: the frame the replay page reads. */
  offset_seconds: number;
  end_seconds: number;
  text: string;
  user_id: string | null;
}

/** Every clip is in: put the lines on the recording's clock and say who
    spoke each. Offsets are kept in the recording_started_at frame — the
    one live captions use — so the replay page's timeline applies to both
    kinds of transcript alike; the recorder's speaking notes are matched
    on its own clock, the one stamped on the playlist. */
export function timeAndName(opts: {
  progress: TranscriptProgress;
  timeline: TimelineSpan[];
  /** recording_started_at, epoch ms (NaN when unknown). */
  startedAtMs: number;
  spans: SpeechSpan[];
  /** The one person on the stage, when there was only one. */
  solo: string | null;
  utterances: Array<{ offset: number; user_id: string | null }>;
}): NamedLine[] {
  const { timeline, startedAtMs } = opts;
  const heard = opts.progress.clips.flatMap((c) => c.lines).sort((a, b) => a.t - b.t);
  const known = Number.isFinite(startedAtMs);
  const timed = heard.map((l, i) => {
    const end = lineEnd(l.t, l.e, l.text, heard[i + 1]?.t);
    const frame = recordingOffset(timeline, startedAtMs, l.t);
    const frameEnd = recordingOffset(timeline, startedAtMs, end);
    return {
      text: l.text,
      frame,
      frameEnd,
      wallFrom: wallClock(timeline, l.t) ?? (known ? startedAtMs + frame * 1000 : null),
      wallTo: wallClock(timeline, end) ?? (known ? startedAtMs + frameEnd * 1000 : null),
    };
  });
  const speakers = pickSpeakers(timed, { spans: opts.spans, solo: opts.solo, utterances: opts.utterances });
  return timed
    .map((l, i) => ({
      offset_seconds: Math.round(l.frame * 10) / 10,
      end_seconds: Math.round(Math.max(l.frameEnd, l.frame) * 10) / 10,
      text: l.text,
      user_id: speakers[i],
    }))
    .sort((a, b) => a.offset_seconds - b.offset_seconds);
}
