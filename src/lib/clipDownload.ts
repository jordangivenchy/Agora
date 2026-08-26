/* Client-side clip download: fetch the recording's HLS playlist, take the
   MPEG-TS segments overlapping [start, end], transmux them to fragmented
   MP4 with mux.js (the same TS→fMP4 step hls.js does for playback), and
   hand the result to the browser as a .mp4 save.

   Cuts snap to segment boundaries (the egress writes ~4s segments), so a
   downloaded clip can start up to one segment early and end one late —
   the same tradeoff Twitch ships. No servers, no ffmpeg: the work happens
   in the viewer's tab. */

type TransmuxerSegment = { initSegment: Uint8Array; data: Uint8Array };
type Transmuxer = {
  on(event: "data", cb: (segment: TransmuxerSegment) => void): void;
  on(event: "done", cb: () => void): void;
  off(event: string): void;
  push(data: Uint8Array): void;
  flush(): void;
};

interface PlaylistSegment {
  url: string;
  start: number; // cumulative seconds from the recording's start
  duration: number;
}

/** Parse a media playlist into segments with cumulative start times. */
export function parsePlaylist(text: string, playlistUrl: string): PlaylistSegment[] {
  const base = new URL(playlistUrl);
  const out: PlaylistSegment[] = [];
  let cursor = 0;
  let pendingDur: number | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      pendingDur = parseFloat(line.slice("#EXTINF:".length));
    } else if (line && !line.startsWith("#") && pendingDur !== null) {
      out.push({ url: new URL(line, base).toString(), start: cursor, duration: pendingDur });
      cursor += pendingDur;
      pendingDur = null;
    }
  }
  return out;
}

/** The subset of segments any part of [start, end] falls inside. */
export function segmentsInRange(segs: PlaylistSegment[], start: number, end: number): PlaylistSegment[] {
  return segs.filter((s) => s.start + s.duration > start && s.start < end);
}

function sanitizeFilename(title: string): string {
  const t = title.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-");
  return (t || "clip").slice(0, 60);
}

/**
 * Download the [start, end] window of an HLS recording as an .mp4 file.
 * Reports progress as 0..1. Throws on network or transmux failure.
 */
export async function downloadClip(opts: {
  src: string;
  start: number;
  end: number;
  title: string;
  onProgress?: (frac: number) => void;
}): Promise<void> {
  const { src, start, end, title, onProgress } = opts;
  const plRes = await fetch(src);
  if (!plRes.ok) throw new Error(`playlist ${plRes.status}`);
  const segs = segmentsInRange(parsePlaylist(await plRes.text(), src), start, end);
  if (segs.length === 0) throw new Error("no segments in range");

  const muxjs = (await import("mux.js")) as unknown as {
    default?: { mp4: { Transmuxer: new () => Transmuxer } };
    mp4?: { Transmuxer: new () => Transmuxer };
  };
  const Mp4 = muxjs.mp4 ?? muxjs.default?.mp4;
  if (!Mp4) throw new Error("mux.js unavailable");
  const transmuxer = new Mp4.Transmuxer();

  const parts: Uint8Array[] = [];
  let wroteInit = false;
  transmuxer.on("data", (segment) => {
    if (!wroteInit) {
      parts.push(segment.initSegment);
      wroteInit = true;
    }
    parts.push(segment.data);
  });

  for (let i = 0; i < segs.length; i++) {
    const res = await fetch(segs[i].url);
    if (!res.ok) throw new Error(`segment ${res.status}`);
    transmuxer.push(new Uint8Array(await res.arrayBuffer()));
    /* flush per segment so memory stays bounded and 'data' fires as we go */
    transmuxer.flush();
    onProgress?.((i + 1) / segs.length);
  }

  if (parts.length === 0) throw new Error("transmux produced no output");
  const blob = new Blob(parts as BlobPart[], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(title)}.mp4`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
