/* Where a moment of the call sits in its recording. Transcript lines are
   timed in seconds from recording_started_at — when the recorder was
   asked for — but the video's own clock starts at its first frame, a few
   seconds later, and a recording in parts (lib/recordingParts) skips the
   gaps between parts. LiveKit stamps every segment with
   EXT-X-PROGRAM-DATE-TIME, so the playlist maps the wall clock to video
   time exactly: a run of back-to-back segments is one span.

   One span with its first frame 0–120 s after the stamp is the old
   single "sync delta"; outside that window the stamp is trusted instead
   (the old behaviour, when the tag looked wrong). No tags: video time is
   the offset itself. Shared by the replay page, the app's replay (Metro
   watches this folder) and the transcriber. */

export interface TimelineSpan {
  /** Video seconds where the span starts. */
  video: number;
  /** Wall clock (epoch ms) of that frame. */
  wall: number;
  /** Seconds of video in the span. */
  duration: number;
}

/** Segments within this much of back-to-back belong to the same span. */
const JOIN_MS = 1500;

export function parseTimeline(m3u8: string): TimelineSpan[] {
  const spans: TimelineSpan[] = [];
  let video = 0;
  let pendingWall: number | null = null;
  let pendingDur = 0;
  let haveDur = false;
  for (const raw of m3u8.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      const t = Date.parse(line.slice("#EXT-X-PROGRAM-DATE-TIME:".length));
      pendingWall = Number.isFinite(t) ? t : null;
    } else if (line.startsWith("#EXTINF:")) {
      pendingDur = parseFloat(line.slice(8)) || 0;
      haveDur = true;
    } else if (line && !line.startsWith("#")) {
      if (!haveDur) continue;
      const last = spans[spans.length - 1];
      const expected = last ? last.wall + last.duration * 1000 : null;
      if (pendingWall === null) {
        /* An untagged segment carries on from whatever came before. */
        if (last) last.duration += pendingDur;
      } else if (last && expected !== null && Math.abs(pendingWall - expected) <= JOIN_MS) {
        last.duration += pendingDur;
      } else {
        spans.push({ video, wall: pendingWall, duration: pendingDur });
      }
      video += pendingDur;
      pendingWall = null;
      pendingDur = 0;
      haveDur = false;
    }
  }
  return spans;
}

/** The spans with the first frame trusted only 0–120 s after the stamp. */
function anchored(spans: TimelineSpan[], startedAtMs: number): TimelineSpan[] {
  if (!spans.length || !Number.isFinite(startedAtMs)) return [];
  const d = (spans[0].wall - startedAtMs) / 1000;
  if (d > 0 && d < 120) return spans;
  const shift = spans[0].wall - startedAtMs;
  return spans.map((s) => ({ ...s, wall: s.wall - shift }));
}

/** A transcript offset (seconds from recording_started_at) → video seconds.
    A moment between parts lands on the next part's first frame. */
export function videoTime(spans: TimelineSpan[], startedAtMs: number, offsetSeconds: number): number {
  const a = anchored(spans, startedAtMs);
  if (!a.length) return Math.max(0, offsetSeconds);
  const wall = startedAtMs + offsetSeconds * 1000;
  let i = -1;
  for (let k = 0; k < a.length; k++) if (a[k].wall <= wall) i = k;
  if (i < 0) return 0;
  const s = a[i];
  const into = (wall - s.wall) / 1000;
  if (into > s.duration && i + 1 < a.length) return a[i + 1].video;
  return s.video + into;
}

/** Video seconds → a transcript offset (seconds from recording_started_at). */
export function recordingOffset(spans: TimelineSpan[], startedAtMs: number, videoSeconds: number): number {
  const a = anchored(spans, startedAtMs);
  if (!a.length) return videoSeconds;
  let i = 0;
  for (let k = 0; k < a.length; k++) if (a[k].video <= videoSeconds) i = k;
  const s = a[i];
  return (s.wall + (videoSeconds - s.video) * 1000 - startedAtMs) / 1000;
}
