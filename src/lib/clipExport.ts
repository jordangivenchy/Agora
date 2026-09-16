/* A clip, as a file someone can post.

   A clip is a start and an end on a room's recording — nothing to
   upload anywhere. This turns one into an upright video: the picture
   re-framed for a phone held normally, the words burned on, the motion
   across the top, ready for the apps that only take vertical.

   The recording is a 16:9 composite of the room, and what's in it
   depends on who had a camera on: two cards side by side, one in the
   middle, a grid. Rather than guess from the room's data — or hard-code
   the recording page's CSS, which moves — the frame tells us: ffmpeg's
   cropdetect gives the box the picture actually occupies, and the shape
   of that box says how to lay it out. A box twice as wide as it is tall
   is two people beside each other, and reads far better stacked, each
   face filling the width; anything else is fitted whole.

   Pure: every function here takes numbers and text and returns numbers
   and text, so the awkward parts are testable without a video. */

/** What the finished file is: the size every vertical app wants. */
export const OUT_W = 1080;
export const OUT_H = 1920;

/* ── Where things may go ───────────────────────────────────────────────
   The apps draw their own furniture over the video: the top ~140px
   carries their tabs and the phone's notch, the bottom ~400 the
   username, the caption, the sound and the scrubber, and the right
   ~150 the like and share column. Anything put there is covered on the
   only screen that matters. So the picture runs the whole frame — no
   bands, no bars, full bleed — and the words sit in the lower middle,
   which is clear of all of it and is where a reader's eye already is. */
export const SAFE_TOP = 150;
export const SAFE_BOTTOM = 420;
export const SAFE_SIDE = 150;
/** The words' block, measured from the bottom of the frame. */
export const CAPTION_BASELINE = 600;
/** The question, long enough to say what this is and then gone. */
export const HOOK_SECONDS = 2.6;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ClipLayout = "stack" | "fit";

/** ffmpeg prints `crop=w:h:x:y` for every frame it looks at; the last one
    it settles on is the box that held the picture. */
export function parseCropdetect(stderr: string): Box | null {
  const all = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  const last = all[all.length - 1];
  if (!last) return null;
  const [, w, h, x, y] = last.map(Number) as unknown as [string, number, number, number, number];
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Two people beside each other, or one picture to fit. A box wider than
    ~2.2:1 can only be a row of cards; a single card is about 16:9. */
export function layoutFor(box: Box): ClipLayout {
  return box.w / box.h >= 2.2 ? "stack" : "fit";
}

/** Escape what a drawtext value may not carry raw. */
export function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%").replace(/\n/g, " ");
}

/** Two lines at most of the motion, so a long one doesn't fill the screen. */
export function titleLines(motion: string, perLine = 30, maxLines = 2): string[] {
  const words = motion.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= perLine) line += " " + w;
    else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (words.length && lines.length === maxLines) {
    const used = lines.join(" ").split(/\s+/).length;
    if (used < words.length) lines[maxLines - 1] = lines[maxLines - 1].replace(/[.,;:]?$/, "…");
  }
  return lines;
}

export interface CaptionLine {
  /** Seconds from the start of the recording. */
  offset_seconds: number;
  content: string;
  /** Who said it, when the room had more than one voice. */
  username?: string | null;
}

function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s - h * 3600 - m * 60;
  return `${h}:${String(m).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

/** Break a line into caption-sized pieces: two short lines on screen at a
    time is what reads at arm's length. */
export function captionChunks(text: string, perChunk = 24): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= perChunk) line += " " + w;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Word by word, because that is what holds a muted viewer.

    The transcript stamps a line, not a word, so each line's span is
    shared out across its words by length — a long word holds the
    highlight longer than a short one. Approximate, and far better than
    a paragraph appearing all at once: the eye follows the moving word.
    ASS counts karaoke in hundredths of a second. */
export function karaokeLine(text: string, seconds: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const weight = words.map((w) => Math.max(2, w.length));
  const total = weight.reduce((a, b) => a + b, 0);
  const cs = Math.max(1, Math.round(seconds * 100));
  let spent = 0;
  return words
    .map((w, i) => {
      const share = i === words.length - 1 ? cs - spent : Math.max(8, Math.round((weight[i] / total) * cs));
      spent += share;
      return `{\\k${Math.max(1, share)}}${w}`;
    })
    .join(" ");
}

/** The transcript over this stretch, as a subtitle file: times counted
    from the clip's own start, a line held until the next one arrives (or
    four seconds, whichever is sooner), sitting in the lower middle where
    nothing the app draws can cover it. */
export function assCaptions(lines: CaptionLine[], startSec: number, endSec: number): string {
  const within = lines
    .filter((l) => l.offset_seconds >= startSec - 1.5 && l.offset_seconds < endSec)
    .sort((a, b) => a.offset_seconds - b.offset_seconds);
  const head = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${OUT_W}`,
    `PlayResY: ${OUT_H}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    /* Primary is the word being said — the brand's yellow, which is
       also the colour these captions are usually best in; secondary is
       the rest of the line, white. Both on a dark plate with a hard
       edge, which beats a stroke alone over a bright picture.
       (&HAABBGGRR: yellow is 00b7ff, the plate black at two-thirds.) */
    `Style: Caption,Arial,74,&H0000B7FF,&H00FFFFFF,&H00000000,&H55000000,-1,3,3,0,2,${SAFE_SIDE},${SAFE_SIDE},${CAPTION_BASELINE},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = within.flatMap((l, i) => {
    const from = Math.max(0, l.offset_seconds - startSec);
    const next = within[i + 1];
    const until = Math.min(
      next ? Math.max(from + 0.6, next.offset_seconds - startSec) : from + 4,
      endSec - startSec,
    );
    if (until <= from) return [];
    const safe = l.content.replace(/\{/g, "(").replace(/\}/g, ")");
    const text = captionChunks(safe)
      .map((chunk, n, all) => karaokeLine(chunk, (until - from) / all.length))
      .join("\\N");
    return [`Dialogue: 0,${assTime(from)},${assTime(until)},Caption,,0,0,0,,${text}`];
  });
  return [...head, ...events, ""].join("\n");
}

/** The picture, filling the frame.

    Two beside each other: split the row and stack them, each half the
    height of the screen, each filled and trimmed rather than fitted —
    black bars read as a horizontal video someone couldn't be bothered
    to reframe, and the crop pulls in closer on the faces, which is what
    the format wants. One picture: the same, over the whole frame. */
export function videoFilter(box: Box, layout: ClipLayout): string {
  const crop = `crop=${box.w}:${box.h}:${box.x}:${box.y}`;
  const half = Math.floor(box.w / 2);
  const slotH = Math.floor(OUT_H / 2);
  const fill = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  if (layout === "stack") {
    return (
      `[0:v]${crop},setsar=1[c];` +
      `[c]split=2[l][r];` +
      `[l]crop=${half}:${box.h}:0:0,${fill(OUT_W, slotH)}[top];` +
      `[r]crop=${half}:${box.h}:${half}:0,${fill(OUT_W, slotH)}[bot];` +
      `[top][bot]vstack=inputs=2[framed]`
    );
  }
  return `[0:v]${crop},setsar=1,${fill(OUT_W, OUT_H)}[framed]`;
}

export interface ExportSpec {
  /** The recording's playlist. */
  src: string;
  startSeconds: number;
  endSeconds: number;
  box: Box;
  layout: ClipLayout;
  /** The room's motion, across the top. */
  motion: string;
  /** Written subtitle file, when there are words for this stretch. */
  assPath: string | null;
  outPath: string;
}

/** The question, and then out of the way.

    A band across the top for the whole clip is dead screen and sits
    under the app's own tabs anyway. The motion shows for a couple of
    seconds instead — long enough to say what the argument is, gone
    before it costs anything — clear of the top furniture, on a plate so
    it reads over any picture. */
export function overlayFilter(motion: string, assPath: string | null): string {
  const lines = titleLines(motion);
  const hook = lines
    .map((line, i) =>
      `drawtext=text='${escapeDrawtext(line)}':fontcolor=white:fontsize=62:` +
      `box=1:boxcolor=black@0.55:boxborderw=22:` +
      `x=(w-text_w)/2:y=${SAFE_TOP + 70 + i * 92}:` +
      `enable='lt(t,${HOOK_SECONDS})'`,
    )
    .join(",");
  const subs = assPath ? `,ass='${assPath.replace(/'/g, "'\\''")}'` : "";
  return `[framed]${hook || "null"}${subs}[v]`;
}

export function exportArgs(spec: ExportSpec): string[] {
  const duration = Math.max(1, spec.endSeconds - spec.startSeconds);
  return [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    /* Seeking before the input jumps by segment, which is what makes a
       ten-minute recording start in a second rather than thirty. */
    "-ss", String(spec.startSeconds),
    "-i", spec.src,
    "-t", String(duration),
    "-filter_complex", `${videoFilter(spec.box, spec.layout)};${overlayFilter(spec.motion, spec.assPath)}`,
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "21",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    spec.outPath,
  ];
}

/** Looking for the box: a few seconds, no output file.

    The recording carries our own mark along the bottom, and cropdetect
    counts it as picture — which stretches the box down over a band of
    black and turns two cards side by side into something that looks
    nearly square. The bottom eighth is cut away before looking, so what
    comes back is the cards. */
export const WATERMARK_BAND = 0.12;

export function cropdetectArgs(src: string, atSeconds: number): string[] {
  return [
    "-hide_banner",
    "-ss", String(atSeconds),
    "-i", src,
    "-t", "4",
    /* limit=24 ignores the near-black the page paints behind the cards. */
    "-vf", `crop=iw:ih*${1 - WATERMARK_BAND}:0:0,cropdetect=limit=24:round=2:reset=0`,
    "-f", "null",
    "-",
  ];
}

/** Where the finished file lives, so a clip renders once. */
export const exportKey = (clipId: string): string => `clips/${clipId}.mp4`;
