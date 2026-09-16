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
/** Room across the top for the motion, and along the bottom for words. */
export const TITLE_H = 210;
export const CAPTION_H = 430;

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

/** The transcript over this stretch, as a subtitle file: times counted
    from the clip's own start, a line held until the next one arrives (or
    four seconds, whichever is sooner). */
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
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    /* White, heavy, with a hard black edge: legible over anything, the
       way every caption on a phone is. Alignment 2 = bottom centre. */
    `Style: Caption,Arial,64,&H00FFFFFF,&H00000000,&H00000000,-1,1,5,0,2,60,60,${Math.round(CAPTION_H / 3)},1`,
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
    const text = captionChunks(l.content).join("\\N");
    return [`Dialogue: 0,${assTime(from)},${assTime(until)},Caption,,0,0,0,,${text.replace(/\{/g, "(").replace(/\}/g, ")")}`];
  });
  return [...head, ...events, ""].join("\n");
}

/** The picture: crop away the dead black, lay it out for an upright
    screen, and set it on a blurred blow-up of itself so the bands above
    and below aren't flat black. */
export function videoFilter(box: Box, layout: ClipLayout): string {
  const innerH = OUT_H - TITLE_H - CAPTION_H;
  const crop = `crop=${box.w}:${box.h}:${box.x}:${box.y}`;
  const half = Math.floor(box.w / 2);
  /* Each half fills its own slot exactly — scaled up until it covers,
     then trimmed — so the pair always lands inside the band between the
     motion and the words instead of growing over them. */
  const slotH = Math.floor(innerH / 2);
  const fill = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  const stage =
    layout === "stack"
      ? `[c]split=2[l][r];` +
        `[l]crop=${half}:${box.h}:0:0,${fill(OUT_W, slotH)}[top];` +
        `[r]crop=${half}:${box.h}:${half}:0,${fill(OUT_W, slotH)}[bot];` +
        `[top][bot]vstack=inputs=2[stage];`
      : /* One picture: as wide as the screen, and never taller than the band. */
        `[c]scale=${OUT_W}:${innerH}:force_original_aspect_ratio=decrease[stage];`;
  return (
    `[0:v]${crop},setsar=1[c];` +
    stage +
    /* The ground: the same picture, blown up and blurred. */
    `[stage]split=2[sharp][bg];` +
    `[bg]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},gblur=sigma=28,eq=brightness=-0.22[ground];` +
    `[ground][sharp]overlay=x=0:y=${TITLE_H}+(${innerH}-h)/2[framed]`
  );
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

/** Everything after the picture: the motion up top, then the words. */
export function overlayFilter(motion: string, assPath: string | null): string {
  const lines = titleLines(motion);
  const title = lines
    .map((line, i) =>
      `drawtext=text='${escapeDrawtext(line)}':fontcolor=white:fontsize=58:box=0:` +
      `x=(w-text_w)/2:y=${72 + i * 68}:line_spacing=8`,
    )
    .join(",");
  const subs = assPath ? `,ass='${assPath.replace(/'/g, "'\\\\''")}'` : "";
  return `[framed]${title || "null"}${subs}[v]`;
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
