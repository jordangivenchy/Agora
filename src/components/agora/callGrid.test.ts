import { describe, it, expect } from "vitest";
import { planGrid, screenBlock, screenPlaces, type GridKind } from "./callGrid";

const cams = (n: number): GridKind[] => Array(n).fill("camera");
/* Rows of window counts, top to bottom, e.g. [3, 3, 1]. */
const rowCounts = (kinds: GridKind[], w: number, h: number, ratio: number) => {
  const plan = planGrid(kinds, w, h, 8, ratio);
  const rows = new Map<number, number>();
  for (const c of plan.cells) rows.set(c.y, (rows.get(c.y) ?? 0) + 1);
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
};

describe("call gallery grid", () => {
  it("gives a screen the block closest to its own 16:9", () => {
    expect(screenBlock(1)).toEqual({ c: 2, r: 1 });
    expect(screenBlock(16 / 9)).toEqual({ c: 2, r: 2 });
  });

  it("counts the places screens take by the same rule", () => {
    expect(screenPlaces(1, 1)).toBe(2);
    expect(screenPlaces(2, 1)).toBe(4);
    expect(screenPlaces(1, 16 / 9)).toBe(4);
    expect(screenPlaces(2, 16 / 9)).toBe(5);
  });

  it("lays out one to nine people the Discord way on the app's squares", () => {
    const layouts = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => rowCounts(cams(n), 420, 584, 1));
    expect(layouts).toEqual([[1], [1, 1], [2, 1], [2, 2], [2, 2, 1], [2, 2, 2], [3, 3, 1], [3, 3, 2], [3, 3, 3]]);
  });

  it("lays out one to nine people on the site's 16:9 windows", () => {
    const layouts = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => rowCounts(cams(n), 1100, 620, 16 / 9));
    expect(layouts).toEqual([[1], [2], [2, 1], [2, 2], [3, 2], [3, 3], [3, 3, 1], [3, 3, 2], [3, 3, 3]]);
  });

  it("turns a thin column into columns on a phone's 16:9 windows", () => {
    expect(rowCounts(cams(3), 370, 520, 16 / 9)).toEqual([1, 1, 1]);
    expect(rowCounts(cams(4), 370, 520, 16 / 9)).toEqual([2, 2]);
    expect(rowCounts(cams(6), 345, 698, 16 / 9)).toEqual([2, 2, 2]);
  });

  it("keeps every window the chosen shape and inside the space", () => {
    for (const ratio of [1, 16 / 9]) {
      for (let n = 1; n <= 9; n++) {
        const plan = planGrid(cams(n), 700, 500, 8, ratio);
        for (const c of plan.cells) {
          expect(Math.abs(c.w / c.h - ratio)).toBeLessThan(0.02);
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.x + c.w).toBeLessThanOrEqual(700);
          expect(c.y + c.h).toBeLessThanOrEqual(500);
        }
      }
    }
  });

  it("never overlaps two windows", () => {
    for (const kinds of [cams(9), ["screen", ...cams(5)] as GridKind[], ["screen", ...cams(3)] as GridKind[]]) {
      for (const ratio of [1, 16 / 9]) {
        const cells = planGrid(kinds, 1000, 640, 8, ratio).cells;
        for (let i = 0; i < cells.length; i++) {
          for (let j = i + 1; j < cells.length; j++) {
            const a = cells[i], b = cells[j];
            const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
            expect(apart).toBe(true);
          }
        }
      }
    }
  });

  it("shows a screen at a screen's shape: two squares wide on the app, a 2×2 block on the site", () => {
    const app = planGrid(["screen", ...cams(3)], 420, 584, 6, 1).cells[0];
    expect(app.w).toBeGreaterThan(app.h * 1.9);
    const site = planGrid(["screen", ...cams(3)], 1100, 620, 8, 16 / 9).cells[0];
    expect(Math.abs(site.w / site.h - 16 / 9)).toBeLessThan(0.05);
  });

  it("fills the width at 16:9 with a screen alone", () => {
    for (const ratio of [1, 16 / 9]) {
      const [cell] = planGrid(["screen"], 400, 600, 8, ratio).cells;
      expect(cell.w).toBe(400);
      expect(Math.abs(cell.w / cell.h - 16 / 9)).toBeLessThan(0.02);
    }
  });

  it("centres a short last row", () => {
    const cells = planGrid(cams(7), 420, 584, 6, 1).cells;
    const lone = cells[6];
    expect(Math.abs(lone.x + lone.w / 2 - 210)).toBeLessThanOrEqual(1);
  });
});
