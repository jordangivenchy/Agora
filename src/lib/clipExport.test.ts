import { describe, expect, it } from "vitest";
import { CAPTION_CHARS, assCaptions, captionChunks, cropdetectArgs, escapeDrawtext, exportArgs, exportKey, layoutFor, overlayFilter, parseCropdetect, titleLines, videoFilter } from "./clipExport";

describe("finding the picture in the frame", () => {
  it("takes the box ffmpeg settled on, not the first guess", () => {
    const err = "crop=1280:720:0:0\ncrop=1180:400:60:160\ncrop=1123:315:78:165\n";
    expect(parseCropdetect(err)).toEqual({ w: 1123, h: 315, x: 78, y: 165 });
  });
  it("says nothing when ffmpeg found nothing", () => {
    expect(parseCropdetect("no crop here")).toBeNull();
  });
  it("stacks a row of two, fits a single card", () => {
    expect(layoutFor({ x: 78, y: 165, w: 1123, h: 315 })).toBe("stack"); // the real one
    expect(layoutFor({ x: 0, y: 0, w: 1280, h: 720 })).toBe("fit");
    expect(layoutFor({ x: 300, y: 100, w: 680, h: 383 })).toBe("fit"); // one card
  });
});

describe("the motion across the top", () => {
  it("keeps a short one on one line", () => {
    expect(titleLines("Should college be free?")).toEqual(["Should college be free?"]);
  });
  it("wraps a long one to two, and says there was more", () => {
    const lines = titleLines("Should the federal government forgive all outstanding student debt for everyone");
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });
  it("escapes what drawtext would choke on", () => {
    expect(escapeDrawtext("50% by 2030: yes or no?")).toBe("50\\% by 2030\\: yes or no?");
    expect(escapeDrawtext("it's fine")).toBe("it\u2019s fine");
  });
});

describe("the words, burned on", () => {
  const lines = [
    { offset_seconds: 30, content: "That isn't what the numbers say." },
    { offset_seconds: 33, content: "It is exactly what they say." },
    { offset_seconds: 600, content: "Much later, not in this clip." },
  ];
  it("counts time from the clip's start, not the recording's", () => {
    const ass = assCaptions(lines, 30, 40);
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:03.00");
    expect(ass).toContain("That");
  });
  it("highlights a word at a time, sharing the line's span by word length", () => {
    const ass = assCaptions([{ offset_seconds: 0, content: "short enormously long" }], 0, 3);
    const ks = [...ass.matchAll(/\\k(\d+)/g)].map((m) => Number(m[1]));
    expect(ks).toHaveLength(3);
    expect(ks.reduce((a, b) => a + b, 0)).toBeCloseTo(300, -1); // the whole three seconds
    expect(ks[1]).toBeGreaterThan(ks[0]); // "enormously" holds longer than "short"
  });
  it("sits clear of what the apps draw over the bottom", () => {
    const ass = assCaptions(lines, 30, 40);
    /* The style's vertical margin is measured from the bottom: the words
       land in the lower middle, above the username and the scrubber. */
    expect(ass).toContain(",560,1"); // CAPTION_BASELINE
    expect(ass).toContain("Style: Caption,Arial,60");
  });
  it("leaves out what happens after the clip ends", () => {
    expect(assCaptions(lines, 30, 40)).not.toContain("Much later");
  });
  it("holds the last line, but never past the end", () => {
    const ass = assCaptions(lines, 30, 34);
    const ends = [...ass.matchAll(/,(\d:\d\d:\d\d\.\d\d),Caption/g)].map((m) => m[1]);
    expect(ends.every((t) => t <= "0:00:04.00")).toBe(true);
  });
  it("balances the lines instead of leaving a long one over a short one", () => {
    const chunks = captionChunks("That is not what the numbers actually say about any of this");
    expect(chunks.length).toBeGreaterThan(1);
    const lengths = chunks.map((c) => c.length);
    /* No line more than half again the shortest: the block reads square. */
    expect(Math.max(...lengths)).toBeLessThanOrEqual(Math.min(...lengths) * 1.5 + 6);
  });
  it("wraps to what fits the frame, so the renderer doesn't wrap again", () => {
    /* The renderer breaks at the margins whatever we do; if our own
       lines are wider than that, the balance we worked out is thrown
       away and the block goes ragged again. */
    const lines = captionChunks("And the other one disagrees, at length, with feeling.");
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(CAPTION_CHARS);
  });
  it("keeps every word, in order, however it breaks", () => {
    const text = "one two three four five six seven eight nine ten eleven twelve";
    const chunks = captionChunks(text, 20);
    expect(chunks.join(" ")).toBe(text);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(28);
  });
  it("can't be broken out of by braces in the transcript", () => {
    const ass = assCaptions([{ offset_seconds: 0, content: "he said {\\an8}hello" }], 0, 5);
    expect(ass).not.toContain("{\\an8}");
  });
});

describe("the command", () => {
  const box = { x: 78, y: 165, w: 1123, h: 315 };
  it("seeks before the input, so a long recording opens fast", () => {
    const args = exportArgs({ src: "https://r2/x.m3u8", startSeconds: 120, endSeconds: 160, box, layout: "stack", motion: "Test", assPath: null, outPath: "/tmp/o.mp4" });
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-t") + 1]).toBe("40");
  });
  it("asks for an upright file, and keeps the audio if there is any", () => {
    const args = exportArgs({ src: "s", startSeconds: 0, endSeconds: 10, box, layout: "fit", motion: "T", assPath: null, outPath: "/tmp/o.mp4" });
    /* Full bleed: the picture covers the frame and is trimmed, never
       fitted inside bars. */
    expect(args.join(" ")).toContain("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920");
    expect(args).toContain("0:a?");
    expect(args).toContain("+faststart");
  });
  it("stacks by splitting the row down the middle", () => {
    const f = videoFilter(box, "stack");
    expect(f).toContain("vstack=inputs=2");
    expect(f).toContain("crop=561:315:561:0"); // the right half
    /* Each half exactly fills its slot: two of them and the bands above
       and below add up to the frame, so nothing grows over the title. */
    expect(f).toContain("scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960");
    expect(f).not.toContain("gblur"); // no blurred filler: the picture fills it
  });
  it("looks for the box a few seconds in, and writes no file", () => {
    const args = cropdetectArgs("https://r2/x.m3u8", 12);
    expect(args.join(" ")).toContain("cropdetect=limit=24:round=2:reset=0");
    expect(args.join(" ")).toContain("crop=iw:ih*0.88:0:0"); // our own mark, out of the way
    expect(args.slice(-3)).toEqual(["-f", "null", "-"]);
  });
  it("shows the question for a moment, then gets out of the way", () => {
    const f = overlayFilter("Should college be free?", null);
    expect(f).toContain("enable='lt(t,2.6)'");
    expect(f).toContain("boxcolor=black@0.5"); // legible over any picture
    expect(f).not.toContain("y=72"); // not up under the app's own tabs
  });
  it("gives a clip one home, so it renders once", () => {
    expect(exportKey("abc-123")).toBe("clips/abc-123.mp4");
  });
});
