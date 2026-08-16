import { describe, it, expect } from "vitest";
import {
  MIC_POS,
  PORTAL_Z,
  RENDER_CAP,
  VISIBLE_SLOTS,
  overflowCount,
  renderedCount,
  slotPosition,
} from "./queueLayout";

describe("speaker queue layout", () => {
  it("keeps every slot on the center aisle axis", () => {
    for (let i = 0; i < RENDER_CAP; i++) expect(slotPosition(i).x).toBe(0);
  });

  it("moves monotonically toward the mic as the index drops", () => {
    for (let i = 1; i < RENDER_CAP; i++) {
      expect(slotPosition(i - 1).z).toBeGreaterThan(slotPosition(i).z);
    }
    // Slot #1 is behind the mic, not on top of it.
    expect(slotPosition(0).z).toBeLessThan(MIC_POS.z);
  });

  it("puts the first slots on the open floor and the rest in the tunnel", () => {
    for (let i = 0; i < VISIBLE_SLOTS; i++) {
      const s = slotPosition(i);
      expect(s.tunnel).toBe(false);
      expect(s.y).toBe(0);
    }
    for (let i = VISIBLE_SLOTS; i < RENDER_CAP; i++) {
      const s = slotPosition(i);
      expect(s.tunnel).toBe(true);
      expect(s.y).toBeLessThan(0); // below grade
      expect(s.z).toBeLessThan(PORTAL_Z + 1); // at/past the portal
    }
  });

  it("ramps down into the tunnel without exceeding the floor depth", () => {
    let prevY = 0;
    for (let i = VISIBLE_SLOTS; i < RENDER_CAP; i++) {
      const { y } = slotPosition(i);
      expect(y).toBeLessThanOrEqual(prevY);
      expect(y).toBeGreaterThanOrEqual(-0.85);
      prevY = y;
    }
  });

  it("caps rendering and reports overflow", () => {
    expect(renderedCount(3)).toBe(3);
    expect(renderedCount(50)).toBe(RENDER_CAP);
    expect(overflowCount(3)).toBe(0);
    expect(overflowCount(50)).toBe(50 - RENDER_CAP);
  });
});
