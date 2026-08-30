/* Server-side helpers for post-run replay transcription: parse the VOD
   HLS playlist, and extract the raw AAC (ADTS) audio stream out of
   MPEG-TS segments so it can be fed to Gemini as audio/aac — no ffmpeg,
   no video decode. Used by /api/internal/transcribe-replay. */

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
