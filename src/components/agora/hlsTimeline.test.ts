import { describe, expect, it } from "vitest";
import { parseTimeline, recordingOffset, videoTime } from "./hlsTimeline";
import { stitchPlaylists } from "../../lib/recordingParts";

const STARTED = Date.parse("2026-09-14T18:59:07.381Z"); // recording_started_at (the request)
const seg = (wall: string, dur: number, name: string) => `#EXT-X-PROGRAM-DATE-TIME:${wall}\n#EXTINF:${dur.toFixed(3)},\n${name}`;
const ONE = ["#EXTM3U", seg("2026-09-14T18:59:15.533Z", 2, "a0.ts"), seg("2026-09-14T18:59:17.533Z", 2, "a1.ts"), seg("2026-09-14T18:59:19.533Z", 2, "a2.ts"), "#EXT-X-ENDLIST"].join("\n");
/* Part 2 starts 20 s after part 1's last frame. */
const TWO = ["#EXTM3U", seg("2026-09-14T18:59:41.533Z", 2, "b0.ts"), seg("2026-09-14T18:59:43.533Z", 2, "b1.ts"), "#EXT-X-ENDLIST"].join("\n");

describe("recording timeline", () => {
  it("folds back-to-back segments into one span", () => {
    expect(parseTimeline(ONE)).toEqual([{ video: 0, wall: Date.parse("2026-09-14T18:59:15.533Z"), duration: 6 }]);
  });

  it("matches the old single sync delta for one part", () => {
    const spans = parseTimeline(ONE);
    const delta = (Date.parse("2026-09-14T18:59:15.533Z") - STARTED) / 1000; // 8.152 s
    for (const offset of [0, 5, 8.152, 9, 12.5, 40]) {
      expect(videoTime(spans, STARTED, offset)).toBeCloseTo(Math.max(0, offset - delta), 6);
    }
    expect(recordingOffset(spans, STARTED, 3)).toBeCloseTo(3 + delta, 6);
  });

  it("trusts the stamp when the first frame looks wrong, as before", () => {
    const early = parseTimeline(ONE);
    const later = Date.parse("2026-09-14T19:05:00.000Z"); // first frame "before" the stamp
    expect(videoTime(early, later, 4)).toBeCloseTo(4, 6);
    expect(recordingOffset(early, later, 4)).toBeCloseTo(4, 6);
  });

  it("skips the gap between parts", () => {
    const stitched = stitchPlaylists([{ text: ONE, url: "https://b/r/index.m3u8" }, { text: TWO, url: "https://b/r/p2/index.m3u8" }], true);
    const spans = parseTimeline(stitched);
    expect(spans).toHaveLength(2);
    expect(spans[1]).toEqual({ video: 6, wall: Date.parse("2026-09-14T18:59:41.533Z"), duration: 4 });
    const at = (iso: string) => (Date.parse(iso) - STARTED) / 1000;
    expect(videoTime(spans, STARTED, at("2026-09-14T18:59:18.533Z"))).toBeCloseTo(3, 6); // inside part 1
    expect(videoTime(spans, STARTED, at("2026-09-14T18:59:30.000Z"))).toBeCloseTo(6, 6); // in the gap: part 2's first frame
    expect(videoTime(spans, STARTED, at("2026-09-14T18:59:42.533Z"))).toBeCloseTo(7, 6); // inside part 2
    expect(recordingOffset(spans, STARTED, 7)).toBeCloseTo(at("2026-09-14T18:59:42.533Z"), 6);
    expect(recordingOffset(spans, STARTED, 2)).toBeCloseTo(at("2026-09-14T18:59:17.533Z"), 6);
  });

  it("uses the offset itself without tags", () => {
    const spans = parseTimeline("#EXTM3U\n#EXTINF:2.0,\nx.ts\n#EXT-X-ENDLIST");
    expect(spans).toEqual([]);
    expect(videoTime(spans, STARTED, 12)).toBe(12);
    expect(videoTime(spans, STARTED, -3)).toBe(0);
    expect(recordingOffset(spans, STARTED, 12)).toBe(12);
  });
});
