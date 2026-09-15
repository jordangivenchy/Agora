import { describe, expect, it } from "vitest";
import { MAX_PARTS, partFiles, partPrefix, readParts, recordingUrlFor, shouldRestart, stitchPlaylists, totalBytes } from "./recordingParts";

const ROOM = "d065f134-b85b-4424-81f2-97812a0e85ee";
const BASE = "https://pub-x.r2.dev";

/* Josh's recording as LiveKit left it: six segments and an end. */
const PART1 = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-PLAYLIST-TYPE:EVENT
#EXT-X-ALLOW-CACHE:NO
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PROGRAM-DATE-TIME:2026-09-14T18:59:15.533Z
#EXTINF:2.000,
seg_00000.ts
#EXT-X-PROGRAM-DATE-TIME:2026-09-14T18:59:17.533Z
#EXTINF:2.000,
seg_00001.ts
#EXT-X-PROGRAM-DATE-TIME:2026-09-14T18:59:19.533Z
#EXTINF:0.367,
seg_00002.ts
#EXT-X-ENDLIST
`;
const PART2 = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-PLAYLIST-TYPE:EVENT
#EXT-X-TARGETDURATION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PROGRAM-DATE-TIME:2026-09-14T18:59:41.000Z
#EXTINF:2.000,
seg_00000.ts
#EXT-X-PROGRAM-DATE-TIME:2026-09-14T18:59:43.000Z
#EXTINF:2.500,
seg_00001.ts
`;

describe("recording parts", () => {
  it("keeps part 1 in the room's own folder and puts later parts in p<n>/", () => {
    expect(partPrefix(1)).toBe("");
    expect(partPrefix(3)).toBe("p3/");
    expect(partFiles(ROOM, 1)).toEqual({ filenamePrefix: `${ROOM}/seg`, playlistName: `${ROOM}/index.m3u8`, livePlaylistName: `${ROOM}/live.m3u8` });
    expect(partFiles(ROOM, 2)).toEqual({ filenamePrefix: `${ROOM}/p2/seg`, playlistName: `${ROOM}/p2/index.m3u8`, livePlaylistName: `${ROOM}/p2/live.m3u8` });
  });

  it("plays one part from the bucket and several through the stitched playlist", () => {
    expect(recordingUrlFor(`${BASE}/`, "https://agorasphere.net", ROOM, 1)).toBe(`${BASE}/${ROOM}/index.m3u8`);
    expect(recordingUrlFor(BASE, "https://agorasphere.net/", ROOM, 2)).toBe(`https://agorasphere.net/api/recordings/${ROOM}/index.m3u8`);
  });

  it("reads a room recorded before parts existed as one part", () => {
    expect(readParts([], `${BASE}/${ROOM}/index.m3u8`)).toEqual([{ n: 1, egress_id: null, started_at: null }]);
    expect(readParts(null, null)).toEqual([]);
    expect(readParts([{ n: 2, egress_id: "b", started_at: "t2" }, { n: 1, egress_id: "a", started_at: "t1" }, { bogus: true }], null).map((p) => p.n)).toEqual([1, 2]);
  });

  it("adds up only the sizes LiveKit reported", () => {
    expect(totalBytes([{ n: 1, egress_id: "a", started_at: null }])).toBeNull();
    expect(totalBytes([{ n: 1, egress_id: "a", started_at: null, bytes: 3036764 }, { n: 2, egress_id: "b", started_at: null, bytes: 1000 }, { n: 3, egress_id: "c", started_at: null }])).toBe(3037764);
  });

  it("restarts only a live room that still wants recording, with nothing else filming it", () => {
    const live = { status: "live", hls_url: "https://x/live.m3u8", parts: 1 };
    expect(shouldRestart(live, false)).toBe(true);
    expect(shouldRestart({ ...live, hls_url: null }, false)).toBe(false); // deliberately stopped
    expect(shouldRestart({ ...live, status: "ended" }, false)).toBe(false);
    expect(shouldRestart(live, true)).toBe(false);
    expect(shouldRestart({ ...live, parts: MAX_PARTS }, false)).toBe(false);
  });

  it("stitches parts in order with a discontinuity and absolute segment addresses", () => {
    const out = stitchPlaylists(
      [
        { text: PART1, url: `${BASE}/${ROOM}/index.m3u8` },
        { text: PART2 + "#EXT-X-ENDLIST\n", url: `${BASE}/${ROOM}/p2/index.m3u8` },
      ],
      true
    );
    const lines = out.trim().split("\n");
    expect(lines.slice(0, 5)).toEqual(["#EXTM3U", "#EXT-X-VERSION:4", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-TARGETDURATION:3", "#EXT-X-MEDIA-SEQUENCE:0"]);
    expect(lines.filter((l) => l.endsWith(".ts"))).toEqual([
      `${BASE}/${ROOM}/seg_00000.ts`,
      `${BASE}/${ROOM}/seg_00001.ts`,
      `${BASE}/${ROOM}/seg_00002.ts`,
      `${BASE}/${ROOM}/p2/seg_00000.ts`,
      `${BASE}/${ROOM}/p2/seg_00001.ts`,
    ]);
    const disc = lines.indexOf("#EXT-X-DISCONTINUITY");
    expect(lines[disc - 1]).toBe(`${BASE}/${ROOM}/seg_00002.ts`);
    expect(lines[disc + 1]).toBe("#EXT-X-PROGRAM-DATE-TIME:2026-09-14T18:59:41.000Z");
    expect(lines.filter((l) => l === "#EXT-X-DISCONTINUITY")).toHaveLength(1);
    expect(lines[lines.length - 1]).toBe("#EXT-X-ENDLIST");
  });

  it("stays open while the room is live or a part isn't final", () => {
    const parts = [
      { text: PART1, url: `${BASE}/${ROOM}/index.m3u8` },
      { text: PART2, url: `${BASE}/${ROOM}/p2/index.m3u8` },
    ];
    expect(stitchPlaylists(parts, false)).not.toContain("#EXT-X-ENDLIST");
    const unfinished = stitchPlaylists(parts, true);
    expect(unfinished).toContain("#EXT-X-PLAYLIST-TYPE:EVENT");
    expect(unfinished).not.toContain("#EXT-X-ENDLIST");
    const missing = stitchPlaylists([parts[0], { text: null, url: `${BASE}/${ROOM}/p2/index.m3u8` }], true);
    expect(missing).not.toContain("#EXT-X-DISCONTINUITY");
    expect(missing).not.toContain("#EXT-X-ENDLIST");
  });
});
