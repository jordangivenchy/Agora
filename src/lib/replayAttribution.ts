/* Who said a line of a replay's transcript. The transcript is made from
   the room's one mixed recording, so the words carry no speaker; that
   comes from somewhere else, best first:

     1. The recorder's own note of who was speaking when. The page
        LiveKit films (the room's broadcast view) sees the call's
        "speaking" state for everyone on any device, and keeps it against
        the same clock that stamps the recording
        (/api/internal/recording-speech, recording_speech_spans).
     2. A room with one person on its stage: every line is theirs.
     3. The live per-speaker captions the browser used to write
        (debate_utterances) — only while Agora's listening is on.

   Pure, so it can be tested without a recording. */

export interface SpeechSpan {
  user_id: string;
  /** Epoch ms, on the recorder's clock. */
  from: number;
  to: number;
}

/* The call reports "speaking" a beat after the sound, and lets go a
   little after it stops; a model's own timing of a line is good to a
   second or so. A line is matched against speech from half a second
   before it to a second after. */
const LEAD_MS = 500;
const TRAIL_MS = 1000;
/** Less shared time than this is a brush, not a speaker. */
const MIN_OVERLAP_MS = 200;
/** A line left without a speaker takes its neighbours' when both agree and are this close. */
const NEIGHBOUR_MS = 6000;
/** How near a live caption has to be to name a line (the older way). */
export const UTTERANCE_WINDOW_S = 8;

/** Each person's spans in order, with the ones that touch joined: the
    recorder reports in pieces (it sends what it has every few seconds,
    cutting whoever is mid-sentence), and this puts the sentence back. */
export function joinSpans(spans: SpeechSpan[], gapMs = 400): SpeechSpan[] {
  const byUser = new Map<string, SpeechSpan[]>();
  for (const s of spans) {
    if (!(s.to > s.from)) continue;
    const list = byUser.get(s.user_id);
    if (list) list.push(s);
    else byUser.set(s.user_id, [s]);
  }
  const out: SpeechSpan[] = [];
  for (const list of byUser.values()) {
    list.sort((a, b) => a.from - b.from);
    let cur = { ...list[0] };
    for (let i = 1; i < list.length; i++) {
      if (list[i].from <= cur.to + gapMs) cur.to = Math.max(cur.to, list[i].to);
      else {
        out.push(cur);
        cur = { ...list[i] };
      }
    }
    out.push(cur);
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Whose speaking shares the most time with [fromMs, toMs]. `spans` in
    order of start (joinSpans). Nobody, or only a brush: null. */
export function speakerDuring(spans: SpeechSpan[], fromMs: number, toMs: number): string | null {
  const lo = fromMs - LEAD_MS;
  const hi = Math.max(toMs, fromMs) + TRAIL_MS;
  const shared = new Map<string, number>();
  for (const s of spans) {
    if (s.from >= hi) break;
    if (s.to <= lo) continue;
    const overlap = Math.min(s.to, hi) - Math.max(s.from, lo);
    if (overlap > 0) shared.set(s.user_id, (shared.get(s.user_id) ?? 0) + overlap);
  }
  let best: string | null = null;
  let most = MIN_OVERLAP_MS;
  for (const [user, ms] of shared) {
    if (ms > most) {
      most = ms;
      best = user;
    }
  }
  return best;
}

export interface LineTiming {
  /** The recorder's clock at the line's start and end (epoch ms), when the recording is stamped. */
  wallFrom: number | null;
  wallTo: number | null;
  /** Seconds from recording_started_at — the frame live captions are timed in. */
  frame: number;
}

/** A speaker for every line, or null where nothing says. */
export function pickSpeakers(
  lines: LineTiming[],
  known: {
    /** What the recorder noted, any order. */
    spans: SpeechSpan[];
    /** The one person on the stage, when there was only one. */
    solo: string | null;
    /** Live captions: seconds from recording_started_at, and whose. */
    utterances: Array<{ offset: number; user_id: string | null }>;
  }
): Array<string | null> {
  const spans = joinSpans(known.spans);
  const picked: Array<string | null> = lines.map((l) => {
    if (spans.length && l.wallFrom !== null) {
      const who = speakerDuring(spans, l.wallFrom, l.wallTo ?? l.wallFrom);
      if (who) return who;
    }
    return null;
  });

  /* A line between two of the same person's, close by, is theirs too:
     a sentence the model split, or one the call was slow to notice. */
  if (spans.length) {
    for (let i = 0; i < lines.length; i++) {
      if (picked[i] || lines[i].wallFrom === null) continue;
      const before = i > 0 ? picked[i - 1] : null;
      const after = i + 1 < lines.length ? picked[i + 1] : null;
      const nearBefore = before && lines[i - 1].wallFrom !== null && lines[i].wallFrom! - lines[i - 1].wallFrom! <= NEIGHBOUR_MS;
      const nearAfter = after && lines[i + 1].wallFrom !== null && lines[i + 1].wallFrom! - lines[i].wallFrom! <= NEIGHBOUR_MS;
      if (nearBefore && nearAfter && before === after) picked[i] = before;
    }
  }

  return picked.map((who, i) => {
    if (who) return who;
    if (known.solo) return known.solo;
    let nearest: string | null = null;
    let best = UTTERANCE_WINDOW_S;
    for (const u of known.utterances) {
      const d = Math.abs(u.offset - lines[i].frame);
      if (d <= best && u.user_id) {
        best = d;
        nearest = u.user_id;
      }
    }
    return nearest;
  });
}

/** When a line ends, in seconds on its own clock: where the model said,
    else where a person speaking those words would be done — never past
    the next line's start, never unreasonably long. */
export function lineEnd(start: number, end: number | undefined, text: string, nextStart: number | undefined): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const spoken = start + Math.min(20, Math.max(1.2, words / 2.4));
  let to = end !== undefined && end > start ? Math.min(end, start + 30) : spoken;
  if (nextStart !== undefined && nextStart > start) to = Math.min(to, nextStart);
  return Math.max(to, start + 0.4);
}
