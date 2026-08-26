import { describe, expect, it } from "vitest";
import { LANTERN_ANGLES } from "./sceneTokens";

/* The lantern ring must be provably uniform — twice a hand-tuned list
   shipped rotated off-axis or with a lopsided gap, and it read as
   unevenly placed lights from the audience seats. */
describe("lantern ring", () => {
  it("covers the full circle with a constant 36° step", () => {
    expect(LANTERN_ANGLES.length).toBe(10);
    const sorted = [...LANTERN_ANGLES].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      const next = sorted[(i + 1) % sorted.length];
      const gap = ((next - sorted[i]) % 360 + 360) % 360;
      expect(gap).toBe(36);
    }
  });

  it("is mirror-symmetric about the center axis", () => {
    const set = new Set(LANTERN_ANGLES.map((a) => ((a % 360) + 360) % 360));
    for (const a of set) {
      const mirror = ((180 - a) % 360 + 360) % 360;
      expect(set.has(mirror)).toBe(true);
    }
  });
});
