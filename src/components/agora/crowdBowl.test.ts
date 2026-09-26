import { describe, it, expect } from "vitest";
import { MIN_SEAT_SCALE, REST_LAYOUT, ROW_STEP, SEAT_DEPTH, fillOrder, generateSeats, layoutFor, seatCount } from "./AgoraScene3D";

/* The bowl's stone never changes; how many sit on it does. */
describe("the bowl's seats", () => {
  const base = generateSeats();

  it("holds about two hundred and fifty at rest, one row a step, more at the back", () => {
    expect(base.length).toBeGreaterThan(240);
    expect(base.length).toBeLessThan(260);
    expect(seatCount(REST_LAYOUT)).toBe(base.length);
    const perRow = Array.from({ length: 8 }, (_, r) => base.filter((s) => s.row === r).length);
    for (let r = 1; r < perRow.length; r++) expect(perRow[r]).toBeGreaterThan(perRow[r - 1]);
    expect(base.every((s) => s.scale === 1 && s.sub === 0)).toBe(true);
  });

  it("stays full size until the bowl is full, then tightens — all rows alike", () => {
    expect(layoutFor(1)).toEqual(REST_LAYOUT);
    expect(layoutFor(base.length)).toEqual(REST_LAYOUT);
    const next = layoutFor(base.length + 1);
    expect(next.scale).toBeLessThan(1);
    expect(next.scale).toBeGreaterThan(0.95);
    const seats = generateSeats(next);
    expect(seats.length).toBeGreaterThanOrEqual(base.length + 1);
    expect(new Set(seats.map((s) => s.scale)).size).toBe(1);
  });

  it("every arrival draws the bowl a hair closer — the chairs never jump", () => {
    let last = 1;
    for (let count = base.length; count <= base.length * 12; count += 7) {
      const layout = layoutFor(count);
      expect(layout.scale).toBeLessThanOrEqual(last + 1e-6);
      expect(last - layout.scale).toBeLessThan(0.05);
      expect(layout.spacing).toBeGreaterThanOrEqual(layout.scale - 1e-9); // chairs never overlap
      last = layout.scale;
    }
  });

  it("puts more rows on every step as the chairs shrink, and every row fits its step", () => {
    let rows = 1;
    for (const count of [300, 600, 1000, 2000, 5000, 9000]) {
      const layout = layoutFor(count);
      const seats = generateSeats(layout);
      expect(seats.length).toBeGreaterThanOrEqual(count);
      expect(layout.subRows).toBeGreaterThanOrEqual(rows);
      rows = layout.subRows;
      for (let row = 0; row < 8; row++) {
        expect(new Set(seats.filter((s) => s.row === row).map((s) => s.sub)).size).toBe(layout.subRows);
      }
      expect(layout.subRows * SEAT_DEPTH * layout.scale).toBeLessThanOrEqual(ROW_STEP + 1e-9);
    }
    expect(layoutFor(2000).subRows).toBeGreaterThanOrEqual(3);
    expect(rows).toBeGreaterThanOrEqual(6);
  });

  it("keeps the chairs as large as it can: a new row before smaller chairs", () => {
    let two = base.length;
    while (layoutFor(two).subRows < 2) two++;
    // Where a second row first fits, the chairs are still nearly full size.
    expect(layoutFor(two).scale).toBeGreaterThan(0.85);
    expect(layoutFor(two - 1).subRows).toBe(1);
  });

  it("seats everyone it says it can, down to a fifth, then stops", () => {
    expect(layoutFor(100000).scale).toBe(MIN_SEAT_SCALE);
    const most = seatCount(layoutFor(100000));
    expect(most).toBeGreaterThan(base.length * 30);
    expect(most).toBeLessThan(base.length * 60);
    expect(generateSeats(layoutFor(10000)).length).toBeGreaterThanOrEqual(10000);
  });

  it("stays symmetrical at every size: each row mirrors about the centre, evenly spaced", () => {
    for (const count of [1, 300, 700, 2000, 6000, 100000]) {
      const seats = generateSeats(layoutFor(count));
      for (let row = 0; row < 8; row++) {
        const subs = new Set(seats.filter((s) => s.row === row).map((s) => s.sub));
        for (const sub of subs) {
          const angles = seats.filter((s) => s.row === row && s.sub === sub).map((s) => s.angle).sort((a, b) => a - b);
          // Mirror: the chairs read the same from either end of the arc.
          const n = angles.length;
          for (let i = 0; i < n; i++) expect(Math.abs(angles[i] - (Math.PI - angles[n - 1 - i]))).toBeLessThan(1e-6);
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
    }
  });

  it("slots each new row into the gaps of the one in front", () => {
    const seats = generateSeats(layoutFor(3000));
    const front = seats.filter((s) => s.row === 0 && s.sub === 0 && s.side === "con").map((s) => s.angle).sort((a, b) => a - b);
    const behind = seats.filter((s) => s.row === 0 && s.sub === 1 && s.side === "con").map((s) => s.angle).sort((a, b) => a - b);
    expect(behind.length).toBe(front.length - 1);
    behind.forEach((a, i) => expect(Math.abs(a - (front[i] + front[i + 1]) / 2)).toBeLessThan(1e-6));
    // And each row sits deeper into the step than the one before it.
    const radii = [0, 1, 2].map((sub) => seats.find((s) => s.row === 0 && s.sub === sub)!.radius);
    expect(radii[1]).toBeGreaterThan(radii[0]);
    expect(radii[2]).toBeGreaterThan(radii[1]);
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
