/* A room's recording, in parts. LiveKit's recorder can stop on its own
   while the room is still live (production saw "CPU exhausted" cut every
   camera room to its first ~10 seconds). When that happens the LiveKit
   webhook starts the next part in a folder of its own, and the replay
   plays the parts back in order through /api/recordings/<room>/index.m3u8.

   Part 1 keeps the original files — <room>/index.m3u8, <room>/live.m3u8,
   <room>/seg_* — so a recording that never broke is exactly what it
   always was, played straight from the bucket. Part n writes under
   <room>/p<n>/.

   Pure (tested in recordingParts.test.ts); the routes do the I/O. */

export interface RecordingPart {
  /** 1-based, in recording order. */
  n: number;
  egress_id: string | null;
  /** When the part was requested. */
  started_at: string | null;
  ended_at?: string | null;
  /** Seconds of video, as LiveKit reported at the end. */
  duration?: number | null;
  /** Bytes uploaded, as LiveKit reported at the end. */
  bytes?: number | null;
}

/** A room that keeps losing its recorder stops trying after this many parts. */
export const MAX_PARTS = 12;

/** The folder a part writes into, relative to the room's own folder. */
export function partPrefix(n: number): string {
  return n <= 1 ? "" : `p${n}/`;
}

/** LiveKit's output names for a part (keys in the HLS bucket). */
export function partFiles(roomId: string, n: number) {
  const dir = `${roomId}/${partPrefix(n)}`;
  return {
    filenamePrefix: `${dir}seg`,
    playlistName: `${dir}index.m3u8`,
    livePlaylistName: `${dir}live.m3u8`,
  };
}

/** The replay address for a recording of `parts` parts: the bucket's own
    playlist for one part, the stitched playlist for more. */
export function recordingUrlFor(publicBase: string, origin: string, roomId: string, parts: number): string {
  return parts <= 1
    ? `${publicBase.replace(/\/$/, "")}/${roomId}/index.m3u8`
    : `${origin.replace(/\/$/, "")}/api/recordings/${roomId}/index.m3u8`;
}

/** The parts column, read defensively. A room recorded before parts existed
    (a recording_url but an empty list) has one part: the original files. */
export function readParts(raw: unknown, recordingUrl: string | null): RecordingPart[] {
  const list = Array.isArray(raw)
    ? raw
        .filter((p): p is RecordingPart => !!p && typeof p === "object" && Number.isInteger((p as RecordingPart).n) && (p as RecordingPart).n >= 1)
        .sort((a, b) => a.n - b.n)
    : [];
  if (list.length === 0 && recordingUrl) return [{ n: 1, egress_id: null, started_at: null }];
  return list;
}

/** Bytes across the parts LiveKit has reported on; null while none has. */
export function totalBytes(parts: RecordingPart[]): number | null {
  const known = parts.filter((p) => typeof p.bytes === "number" && Number.isFinite(p.bytes));
  return known.length ? known.reduce((sum, p) => sum + (p.bytes as number), 0) : null;
}

/** After a part ends: start the next one only while the room is live and
    still wants recording (every deliberate stop clears hls_url first, and
    an ended room is ended), no other recorder is running, and the room
    hasn't burned through its parts. */
export function shouldRestart(room: { status: string | null; hls_url: string | null; parts: number }, otherRecorderActive: boolean): boolean {
  return room.status === "live" && !!room.hls_url && !otherRecorderActive && room.parts < MAX_PARTS;
}

/** The replay playlist for a recording in parts: each part's segments in
    order, a discontinuity between parts (every part's timestamps start
    over), segment addresses made absolute against the part's own
    playlist. Each entry is a part's index.m3u8 (null when missing) and
    the address it came from. The list ends (VOD) only once the room has
    ended and every part's playlist is final. */
export function stitchPlaylists(parts: Array<{ text: string | null; url: string }>, roomEnded: boolean): string {
  const body: string[] = [];
  let target = 1;
  let first = true;
  let allFinal = true;
  for (const part of parts) {
    if (!part.text) {
      allFinal = false;
      continue;
    }
    if (!/#EXT-X-ENDLIST/.test(part.text)) allFinal = false;
    const lines: string[] = [];
    let pendingTags: string[] = [];
    for (const raw of part.text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") || line === "#EXT-X-DISCONTINUITY") {
        pendingTags.push(line);
      } else if (line.startsWith("#EXTINF:")) {
        const d = parseFloat(line.slice(8));
        if (Number.isFinite(d)) target = Math.max(target, Math.ceil(d));
        pendingTags.push(line);
      } else if (!line.startsWith("#")) {
        let uri = line;
        try {
          uri = new URL(line, part.url).toString();
        } catch {
          /* leave it as written */
        }
        lines.push(...pendingTags, uri);
        pendingTags = [];
      }
    }
    if (lines.length === 0) continue;
    if (!first) body.push("#EXT-X-DISCONTINUITY");
    body.push(...lines);
    first = false;
  }
  const done = roomEnded && allFinal;
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:4",
    `#EXT-X-PLAYLIST-TYPE:${done ? "VOD" : "EVENT"}`,
    `#EXT-X-TARGETDURATION:${target}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    ...body,
    ...(done ? ["#EXT-X-ENDLIST"] : []),
    "",
  ].join("\n");
}
