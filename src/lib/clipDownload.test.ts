import { describe, expect, it } from "vitest";
import { parsePlaylist, segmentsInRange } from "./clipDownload";

const PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXTINF:4.000,
seg_00000.ts
#EXTINF:4.000,
seg_00001.ts
#EXTINF:4.000,
seg_00002.ts
#EXTINF:2.500,
seg_00003.ts
#EXT-X-ENDLIST
`;

const URL_BASE = "https://cdn.example.com/room-1/index.m3u8";

describe("parsePlaylist", () => {
  it("resolves relative segment URIs and accumulates start times", () => {
    const segs = parsePlaylist(PLAYLIST, URL_BASE);
    expect(segs).toHaveLength(4);
    expect(segs[0]).toMatchObject({ url: "https://cdn.example.com/room-1/seg_00000.ts", start: 0, duration: 4 });
    expect(segs[2].start).toBe(8);
    expect(segs[3]).toMatchObject({ start: 12, duration: 2.5 });
  });

  it("keeps absolute URIs as-is", () => {
    const abs = "#EXTINF:4,\nhttps://other.example.com/a.ts\n";
    expect(parsePlaylist(abs, URL_BASE)[0].url).toBe("https://other.example.com/a.ts");
  });
});

describe("segmentsInRange", () => {
  const segs = parsePlaylist(PLAYLIST, URL_BASE);

  it("takes every segment the window touches", () => {
    // [5, 9] touches seg1 (4-8) and seg2 (8-12)
    expect(segmentsInRange(segs, 5, 9).map((s) => s.start)).toEqual([4, 8]);
  });

  it("a window inside one segment returns just that segment", () => {
    expect(segmentsInRange(segs, 1, 3).map((s) => s.start)).toEqual([0]);
  });

  it("boundaries are exclusive on exact edges", () => {
    // window ending exactly at a segment's start doesn't drag it in
    expect(segmentsInRange(segs, 0, 4).map((s) => s.start)).toEqual([0]);
    // window starting exactly at a segment's end skips it
    expect(segmentsInRange(segs, 4, 6).map((s) => s.start)).toEqual([4]);
  });

  it("clamps sanely past the end of the recording", () => {
    expect(segmentsInRange(segs, 13, 99).map((s) => s.start)).toEqual([12]);
    expect(segmentsInRange(segs, 20, 30)).toHaveLength(0);
  });
});
