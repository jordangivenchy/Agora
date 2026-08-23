import { describe, it, expect } from "vitest";
import { highlightSegments, queryTerms, excerptAround } from "@/lib/highlight";

const join = (segs: { text: string; hit: boolean }[]) =>
  segs.map((s) => (s.hit ? `[${s.text}]` : s.text)).join("");

describe("queryTerms", () => {
  it("splits, folds, strips operators and dedupes", () => {
    expect(queryTerms('  "Free Speech" -OR agora ')).toEqual(["speech", "agora", "free"]);
    expect(queryTerms("Café")).toEqual(["cafe"]);
    expect(queryTerms("")).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("marks whole-word and prefix matches, case-insensitively", () => {
    expect(join(highlightSegments("AgoraSphere hosts Agora debates", "agora")))
      .toBe("[Agora]Sphere hosts [Agora] debates");
  });
  it("matches accented text against an unaccented query", () => {
    expect(join(highlightSegments("Un café à Paris", "cafe"))).toBe("Un [café] à Paris");
  });
  it("does not match short terms mid-word but does for 3+ chars", () => {
    expect(join(highlightSegments("banana", "an"))).toBe("banana");
    expect(join(highlightSegments("banana", "nan"))).toBe("ba[nan]a");
  });
  it("highlights every term and merges adjacent hits", () => {
    expect(join(highlightSegments("free speech now", "free speech"))).toBe("[free] [speech] now");
    expect(join(highlightSegments("freespeech", "free speech"))).toBe("[freespeech]");
  });
  it("returns the text untouched when there is no query", () => {
    expect(highlightSegments("hello", "")).toEqual([{ text: "hello", hit: false }]);
    expect(highlightSegments("", "x")).toEqual([]);
  });
});

describe("excerptAround", () => {
  it("windows around the first hit", () => {
    const long = "a".repeat(200) + " agora " + "b".repeat(200);
    const ex = excerptAround(long, "agora", 20);
    expect(ex.startsWith("…")).toBe(true);
    expect(ex.endsWith("…")).toBe(true);
    expect(ex).toContain("agora");
    expect(ex.length).toBeLessThan(60);
  });
  it("falls back to the head when nothing matches", () => {
    expect(excerptAround("short text", "zzz")).toBe("short text");
  });
});
