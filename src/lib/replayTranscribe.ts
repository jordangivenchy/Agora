/* Server-side helpers for post-run replay transcription: parse the VOD
   HLS playlist, extract the raw AAC (ADTS) audio stream out of MPEG-TS
   segments so it can be fed to Gemini as audio/aac — no ffmpeg, no video
   decode — and the bookkeeping that lets a long recording be done a few
   minutes at a time, across as many runs as it takes. Used by
   /api/internal/transcribe-replay. */

export interface HlsSegment {
  url: string;
  duration: number;
  /** Seconds from the start of the VOD to this segment's first frame. */
  offset: number;
}

export interface ParsedPlaylist {
  segments: HlsSegment[];
  /** Epoch ms of the first frame (EXT-X-PROGRAM-DATE-TIME), if present. */
  programDateTime: number | null;
  totalDuration: number;
}

export function parseVodPlaylist(text: string, baseUrl: string): ParsedPlaylist {
  const segments: HlsSegment[] = [];
  let pdt: number | null = null;
  let pending = 0;
  let offset = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      if (pdt === null) {
        const t = Date.parse(line.slice("#EXT-X-PROGRAM-DATE-TIME:".length));
        if (Number.isFinite(t)) pdt = t;
      }
    } else if (line.startsWith("#EXTINF:")) {
      pending = parseFloat(line.slice(8)) || 0;
    } else if (line && !line.startsWith("#")) {
      segments.push({ url: new URL(line, baseUrl).toString(), duration: pending, offset });
      offset += pending;
      pending = 0;
    }
  }
  return { segments, programDateTime: pdt, totalDuration: offset };
}

/* Where a clip has sound, without decoding it. An AAC frame of silence is
   a handful of bytes (22 in LiveKit's recordings; 7 of them the ADTS
   header) against hundreds for anything audible, so each frame's size
   says whether its moment has sound. A model handed silence doesn't
   return nothing — it returns interviews, sign-offs and streamer banter
   (production, 2026-09: three silent recordings "transcribed"). */
const SILENT_FRAME_MAX_BYTES = 64;
const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** Every audio frame in the clip: when it starts (seconds), how long it
    lasts, and whether it carries sound. Bytes that aren't frames are skipped. */
function walkFrames(adts: Uint8Array, visit: (at: number, seconds: number, sound: boolean) => void): number {
  let i = 0;
  let at = 0;
  while (i + 7 <= adts.length) {
    if (adts[i] !== 0xff || (adts[i + 1] & 0xf0) !== 0xf0) {
      i++;
      continue;
    }
    const rate = ADTS_RATES[(adts[i + 2] >> 2) & 0x0f] ?? 44100;
    const length = ((adts[i + 3] & 0x03) << 11) | (adts[i + 4] << 3) | ((adts[i + 5] & 0xe0) >> 5);
    if (length < 7) {
      i++;
      continue;
    }
    const seconds = (1024 * ((adts[i + 6] & 0x03) + 1)) / rate;
    visit(at, seconds, length > SILENT_FRAME_MAX_BYTES);
    at += seconds;
    i += length;
  }
  return at;
}

/** One entry per second of the clip: whether any audio frame in it had sound. */
export function soundSeconds(adts: Uint8Array): boolean[] {
  const seconds: boolean[] = [];
  walkFrames(adts, (at, _len, sound) => {
    const second = Math.floor(at + 1e-9);
    while (seconds.length <= second) seconds.push(false);
    if (sound) seconds[second] = true;
  });
  return seconds;
}

/** Does the clip open and close in quiet? A recording is cut for the model
    where a segment ends quiet or the next starts quiet — a pause — so no
    sentence is handed over in two halves. (Quiet here is a muted
    microphone's digital silence; an open one is never this quiet, so a
    cut in the middle of open-mic talk falls where the plan put it.) */
export function quietEdges(adts: Uint8Array, seconds = 0.35): { start: boolean; end: boolean; duration: number } {
  const frames: Array<{ at: number; sound: boolean }> = [];
  const duration = walkFrames(adts, (at, _len, sound) => frames.push({ at, sound }));
  if (!frames.length) return { start: true, end: true, duration: 0 };
  return {
    start: !frames.some((f) => f.sound && f.at < seconds),
    end: !frames.some((f) => f.sound && f.at >= duration - seconds),
    duration,
  };
}

/** Was there sound around `t` seconds into the clip (a second before, a few after — a line's start)? */
export function heardAt(sound: boolean[], t: number): boolean {
  const from = Math.max(0, Math.floor(t) - 1);
  const to = Math.min(sound.length - 1, Math.floor(t) + 4);
  for (let s = from; s <= to; s++) if (sound[s]) return true;
  return false;
}

/** Group segments into transcription chunks of at most maxSeconds. */
export function chunkSegments(segments: HlsSegment[], maxSeconds: number): HlsSegment[][] {
  const chunks: HlsSegment[][] = [];
  let current: HlsSegment[] = [];
  let acc = 0;
  for (const s of segments) {
    if (current.length > 0 && acc + s.duration > maxSeconds) {
      chunks.push(current);
      current = [];
      acc = 0;
    }
    current.push(s);
    acc += s.duration;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** How many segments from `from` make a clip of at most maxSeconds (at least one). */
export function segmentsFor(segments: HlsSegment[], from: number, maxSeconds: number): number {
  let n = 0;
  let acc = 0;
  for (let i = from; i < segments.length; i++) {
    if (n > 0 && acc + segments[i].duration > maxSeconds) break;
    acc += segments[i].duration;
    n++;
  }
  return n;
}

/** Where to end a clip planned as `planned` segments: there, or up to
    `lookBack` segments earlier at the nearest pause (quiet on either
    side of the cut). `edges` is the planned segments and, when the
    recording goes on, the one after them. No pause in reach: the plan
    stands. */
export function chunkLength(edges: Array<{ start: boolean; end: boolean }>, planned: number, lookBack: number): number {
  if (planned >= edges.length) return edges.length; // the recording ends here
  const least = Math.max(1, planned - lookBack);
  for (let k = planned; k >= least; k--) {
    if (edges[k - 1].end || edges[k].start) return k;
  }
  return planned;
}

/* What a model hears in silence: sign-offs and captions from the
   training data, and the same line again and again. Those go; so does
   a line the model returned twice in a row (a stutter of its own,
   never of the speaker), and any line inside brackets — [Music],
   (inaudible) — that describes rather than transcribes. */
const GHOST = /^(thanks?( you)?( so much)?( for (watching|listening|your time))?|subtitles? by[^.]*|subscribe[^.]*|like and subscribe[^.]*|see you( next time| in the next (one|video))?|bye(-bye)?|(please )?don'?t forget to subscribe[^.]*|thank you\.?)[.!]*$/i;
export function dropGhosts<T extends { text: string }>(lines: T[]): T[] {
  const out: T[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  let last = "";
  for (const l of lines) {
    const n = norm(l.text);
    if (!n) continue;
    if (/^[\[(].*[\])]$/.test(l.text.trim())) continue;
    if (GHOST.test(l.text.trim())) continue;
    if (n === last) continue;
    last = n;
    out.push(l);
  }
  return out;
}

/** A line as the model returned it, timed within its own clip. */
export interface ClipLine {
  /** Seconds into the clip where the line starts. */
  t: number;
  /** Seconds into the clip where it ends, when the model said. */
  e?: number;
  text: string;
}

/** The model's answer, made safe to keep: well-formed lines only, in
    order, none timed outside the clip it was given (a model asked for
    times will give one for a line it made up, and that time is often
    past the end), an end only where it follows its start, no ghosts. */
export function cleanLines(parsed: unknown, clipSeconds: number): ClipLine[] {
  if (!Array.isArray(parsed)) return [];
  const lines: ClipLine[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const { t, e, text } = raw as { t?: unknown; e?: unknown; text?: unknown };
    if (typeof t !== "number" || !Number.isFinite(t) || typeof text !== "string") continue;
    const words = text.trim();
    if (!words) continue;
    if (t < 0 || t > clipSeconds + 1) continue;
    const line: ClipLine = { t: Math.min(t, clipSeconds), text: words };
    if (typeof e === "number" && Number.isFinite(e) && e > t) line.e = Math.min(e, clipSeconds + 1);
    lines.push(line);
  }
  lines.sort((a, b) => a.t - b.t);
  return dropGhosts(lines);
}

/** What the model is told about the room, for spelling only: its topic and
    the people on its stage. Their own words go in as data, on one line
    each and cut short, so a topic can't pass for an instruction. */
export function spellingNotes(room: { motion?: string | null; language?: string | null }, people: Array<{ username?: string | null; display_name?: string | null }>): string {
  const tidy = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f"“”]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const notes: string[] = [];
  const motion = room.motion ? tidy(room.motion, 200) : "";
  if (motion) notes.push(`The discussion's topic, as its host wrote it: "${motion}".`);
  const names = new Set<string>();
  for (const p of people.slice(0, 12)) {
    const name = p.display_name ? tidy(p.display_name, 40) : "";
    const handle = p.username ? tidy(p.username, 30) : "";
    if (name) names.add(name);
    if (handle && handle.toLowerCase() !== name.toLowerCase()) names.add(handle);
  }
  if (names.size) notes.push(`People who may be speaking or named: ${[...names].map((n) => `"${n}"`).join(", ")}.`);
  if (!notes.length) return "";
  return (
    " Background, for spelling only — use these spellings for words you actually hear, and never add anything from them that isn't spoken: " +
    notes.join(" ")
  );
}

/** How far a recording's transcription has got: finished clips, in order,
    each with the segments it covered and its lines timed from the start
    of the video. Kept on the row between runs, so a long recording is
    never started over. */
export interface TranscriptProgress {
  v: 1;
  /** The playlist this progress belongs to; a different one starts afresh. */
  sig: string;
  /** The next segment to transcribe. */
  next: number;
  clips: Array<{ from: number; to: number; lines: Array<{ t: number; e?: number; text: string }> }>;
  model?: string;
}

export function playlistSignature(playlist: ParsedPlaylist): string {
  return `${playlist.segments.length}:${Math.round(playlist.totalDuration)}`;
}

/** The saved progress if it is for this playlist and makes sense, else a fresh start. */
export function readProgress(raw: unknown, sig: string): TranscriptProgress {
  const fresh: TranscriptProgress = { v: 1, sig, next: 0, clips: [] };
  if (!raw || typeof raw !== "object") return fresh;
  const p = raw as Partial<TranscriptProgress>;
  if (p.v !== 1 || p.sig !== sig || typeof p.next !== "number" || !Array.isArray(p.clips)) return fresh;
  let next = 0;
  for (const c of p.clips) {
    if (!c || typeof c.from !== "number" || typeof c.to !== "number" || c.from !== next || c.to <= c.from || !Array.isArray(c.lines)) return fresh;
    next = c.to;
  }
  if (next !== p.next) return fresh;
  return { v: 1, sig, next, clips: p.clips, model: typeof p.model === "string" ? p.model : undefined };
}

/** A run that got nowhere waits longer before the next: 2 minutes, then
    5, 10, 20, 40, an hour, and every two hours after — about a day of
    tries in all before the job is given up (MAX_ATTEMPTS). A run that
    finished even one clip goes again at once and wipes the count. */
export const MAX_ATTEMPTS = 14;
export function retryMinutes(attempts: number): number {
  return [2, 5, 10, 20, 40, 60][Math.max(0, attempts - 1)] ?? 120;
}

/* Minimal MPEG-TS demuxer: walks the 188-byte packets, finds the PMT via
   the PAT, locates the ADTS AAC elementary stream (stream_type 0x0F),
   strips PES headers, and concatenates the payloads — which are valid
   ADTS frames, i.e. a playable .aac file. Video and metadata streams are
   ignored entirely. */
export function tsToAdts(ts: Uint8Array): Uint8Array {
  const PKT = 188;
  let pmtPid = -1;
  let aacPid = -1;
  const out: Uint8Array[] = [];

  let i = 0;
  while (i + PKT <= ts.length) {
    if (ts[i] !== 0x47) {
      // Lost sync — scan forward to the next sync byte.
      i++;
      continue;
    }
    const pusi = (ts[i + 1] & 0x40) !== 0;
    const pid = ((ts[i + 1] & 0x1f) << 8) | ts[i + 2];
    const afc = (ts[i + 3] >> 4) & 0x3;
    let p = i + 4;
    if (afc & 0x2) p += 1 + ts[p]; // skip adaptation field
    if (!(afc & 0x1) || p >= i + PKT) {
      i += PKT;
      continue;
    }

    if (pid === 0 && pusi) {
      // PAT: pointer_field, then the section. Program loop starts 8 bytes
      // into the section; 4-byte entries; CRC32 at the end.
      const q = p + 1 + ts[p];
      const sectionLen = ((ts[q + 1] & 0x0f) << 8) | ts[q + 2];
      const end = Math.min(q + 3 + sectionLen - 4, i + PKT);
      for (let r = q + 8; r + 4 <= end; r += 4) {
        const prog = (ts[r] << 8) | ts[r + 1];
        if (prog !== 0) pmtPid = ((ts[r + 2] & 0x1f) << 8) | ts[r + 3];
      }
    } else if (pid === pmtPid && pusi) {
      const q = p + 1 + ts[p];
      const sectionLen = ((ts[q + 1] & 0x0f) << 8) | ts[q + 2];
      const progInfoLen = ((ts[q + 10] & 0x0f) << 8) | ts[q + 11];
      let r = q + 12 + progInfoLen;
      const end = Math.min(q + 3 + sectionLen - 4, i + PKT);
      while (r + 5 <= end) {
        const streamType = ts[r];
        const esPid = ((ts[r + 1] & 0x1f) << 8) | ts[r + 2];
        const esInfoLen = ((ts[r + 3] & 0x0f) << 8) | ts[r + 4];
        if (streamType === 0x0f) aacPid = esPid; // ISO/IEC 13818-7 ADTS AAC
        r += 5 + esInfoLen;
      }
    } else if (pid === aacPid && aacPid !== -1) {
      let q = p;
      if (pusi && q + 9 <= i + PKT && ts[q] === 0 && ts[q + 1] === 0 && ts[q + 2] === 1) {
        const hdrLen = ts[q + 8];
        q += 9 + hdrLen; // fixed PES header + optional fields
      }
      if (q < i + PKT) out.push(ts.subarray(q, i + PKT));
    }

    i += PKT;
  }

  let total = 0;
  for (const b of out) total += b.length;
  const buf = new Uint8Array(total);
  let o = 0;
  for (const b of out) {
    buf.set(b, o);
    o += b.length;
  }
  return buf;
}
