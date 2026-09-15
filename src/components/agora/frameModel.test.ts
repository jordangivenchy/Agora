import { describe, it, expect } from "vitest";
import { FRAME_MAX_LINES, frameIsEmpty, frameLength, frameLines, frameNewsKey } from "./frameModel";

const ROOM = {
  host_id: "h",
  framing: {
    about: "Should voting be mandatory?",
    about_at: "2026-09-12T02:00:00.000Z",
    stances: {
      h: { text: "Yes, with a none-of-the-above box.", at: "2026-09-12T02:01:00.000Z" },
      d1: { text: "No. Compulsion cheapens the vote.", at: "2026-09-12T02:02:00.000Z" },
      gone: { text: "I left", at: "2026-09-12T02:03:00.000Z" },
    },
  },
};

describe("frameNewsKey and frameIsEmpty", () => {
  it("changes when the description changes, and knows when there isn't one", () => {
    const k1 = frameNewsKey(ROOM.framing);
    const k2 = frameNewsKey({ ...ROOM.framing, about_at: "2026-09-12T03:00:00.000Z" });
    expect(k1).not.toBe(k2);
    expect(frameNewsKey(null)).toBe("");
    expect(frameIsEmpty(null)).toBe(true);
    expect(frameIsEmpty({ about: "  " })).toBe(true);
    expect(frameIsEmpty({ about: "x" })).toBe(false);
  });
});

describe("frameLength", () => {
  it("counts a move down a line once, whether the editor wrote one newline or two", () => {
    expect(frameLength("abc")).toBe(3);
    expect(frameLength("ab\ncd")).toBe(5);
    expect(frameLength("ab\n\ncd")).toBe(5);
    expect(frameLength("ab\n\n\n\ncd")).toBe(5);
    expect(frameLength("- one\n- two")).toBe(11);
    expect(frameLength("")).toBe(0);
  });
});

describe("frameLines", () => {
  it("counts the lines on screen, blank ones and bullets included", () => {
    expect(frameLines("")).toBe(0);
    expect(frameLines("one line")).toBe(1);
    expect(frameLines("a\nb")).toBe(2);
    expect(frameLines("a\n\nb")).toBe(3);
    expect(frameLines("- one\n- two\n- three")).toBe(3);
    expect(frameLines(Array.from({ length: FRAME_MAX_LINES + 1 }, (_, i) => `l${i}`).join("\n"))).toBe(FRAME_MAX_LINES + 1);
  });
});
