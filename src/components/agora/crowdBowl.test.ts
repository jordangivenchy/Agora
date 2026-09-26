import { describe, it, expect } from "vitest";
import { MIN_SEAT_SCALE, fillOrder, generateSeats, scaleFor } from "./AgoraScene3D";

/* The bowl's stone never changes; how many sit on it does. */
describe("the bowl's seats", () => {
  const base = generateSeats();

  it("holds about two hundred and fifty at rest, more at the back", () => {
    expect(base.length).toBeGreaterThan(240);
    expect(base.length).toBeLessThan(260);
    const perRow = Array.from({ length: 8 }, (_, r) => base.filter((s) => s.row === r).length);
    for (let r = 1; r < perRow.length; r++) expect(perRow[r]).toBeGreaterThan(perRow[r - 1]);
    expect(base.every((s) => s.scale === 1)).toBe(true);
  });

  it("stays full size until the bowl is full, then tightens — all rows alike", () => {
    expect(scaleFor(1)).toBe(1);
    expect(scaleFor(base.length)).toBe(1);
    const s1 = scaleFor(base.length + 1);
    expect(s1).toBeLessThan(1);
    expect(s1).toBeGreaterThan(0.95);
    const seats = generateSeats(s1);
    expect(seats.length).toBeGreaterThanOrEqual(base.length + 1);
    expect(new Set(seats.map((s) => s.scale)).size).toBe(1);
  });

  it("every arrival draws the bowl a hair closer — no steps", () => {
    let last = 1;
    for (let count = base.length; count <= base.length * 4; count += 7) {
      const s = scaleFor(count);
      expect(s).toBeLessThanOrEqual(last);
      expect(last - s).toBeLessThan(0.05);
      last = s;
    }
  });

  it("seats everyone it says it can, down to a quarter, then stops", () => {
    for (const count of [300, 500, 800, 1000]) {
      const s = scaleFor(count);
      expect(generateSeats(s).length).toBeGreaterThanOrEqual(count);
    }
    expect(scaleFor(100000)).toBe(MIN_SEAT_SCALE);
    const most = generateSeats(MIN_SEAT_SCALE).length;
    expect(most).toBeGreaterThan(base.length * 3.5);
    expect(most).toBeLessThan(base.length * 4.5);
  });

  it("stays symmetrical at every size: each row mirrors about the centre, evenly spaced", () => {
    for (const scale of [1, 0.9, 0.61, 0.33, 0.25]) {
      const seats = generateSeats(scale);
      for (let row = 0; row < 8; row++) {
        const angles = seats.filter((s) => s.row === row).map((s) => s.angle).sort((a, b) => a - b);
        // Mirror: for every chair at angle a there is one at π − a.
        for (const a of angles) {
          const mirror = Math.PI - a;
          expect(Math.min(...angles.map((b) => Math.abs(b - mirror)))).toBeLessThan(1e-6);
        }
        // Even: the front rows are two blocks split by the aisle, so one
        // side's chairs are one block — every gap in it the same, however
        // many chairs it holds.
        if (row < 2) {
          const side = angles.filter((a) => a < Math.PI / 2);
          const gaps = side.slice(1).map((a, i) => a - side[i]);
          for (const g of gaps) expect(Math.abs(g - gaps[0])).toBeLessThan(1e-6);
        }
      }
    }
  });

  it("fills front and centre first, and the same way every time", () => {
    const order = fillOrder(base);
    const first = base[order[0]];
    expect(first.row).toBe(0);
    expect(first.center).toBe(Math.min(...base.filter((s) => s.row === 0).map((s) => s.center)));
    const rows = order.map((i) => base[i].row);
    for (let i = 1; i < rows.length; i++) expect(rows[i]).toBeGreaterThanOrEqual(rows[i - 1]);
    expect(fillOrder(base)).toEqual(order);
  });
});
