import { describe, it, expect } from "vitest";
import { ROW_MAX_DENSITY, densitiesFor, fillOrder, generateSeats } from "./AgoraScene3D";

/* The bowl's stone never changes; how many sit on it does. */
describe("the bowl's seats", () => {
  const base = generateSeats();

  it("holds about two hundred and fifty at rest, more at the back", () => {
    expect(base.length).toBeGreaterThan(240);
    expect(base.length).toBeLessThan(260);
    const perRow = ROW_MAX_DENSITY.map((_, r) => base.filter((s) => s.row === r).length);
    for (let r = 1; r < perRow.length; r++) expect(perRow[r]).toBeGreaterThan(perRow[r - 1]);
    expect(base.every((s) => s.scale === 1)).toBe(true);
  });

  it("thickens from the back, the whole bowl to two before any row to four", () => {
    const d = densitiesFor(base.length + 1);
    expect(d[d.length - 1]).toBe(2);
    expect(d.slice(0, -1).every((x) => x === 1)).toBe(true);
    /* The front two rows never thicken, so "everything at two" is the
       other six rows doubled — 457 seats before the last of them, 482
       after. */
    const d2 = densitiesFor(470);
    expect(Math.max(...d2)).toBe(2);
    expect(d2.slice(2).every((x) => x === 2)).toBe(true);
    expect(d2[0]).toBe(1);
    expect(d2[1]).toBe(1);
    const d4 = densitiesFor(base.length * 3);
    expect(d4.includes(4)).toBe(true);
    expect(d4[0]).toBe(1);
    expect(d4[1]).toBe(1);
  });

  it("never exceeds each row's most, and stops there", () => {
    const d = densitiesFor(100000);
    expect(d).toEqual(ROW_MAX_DENSITY);
    const seats = generateSeats(d);
    expect(seats.length).toBeGreaterThan(base.length * 3);
    expect(seats.length).toBeLessThan(base.length * 4);
  });

  it("a thickened row's chairs are smaller and there are more of them", () => {
    const d = ROW_MAX_DENSITY.map(() => 1);
    d[7] = 2;
    const seats = generateSeats(d);
    const back = seats.filter((s) => s.row === 7);
    const baseBack = base.filter((s) => s.row === 7);
    expect(back.length).toBeGreaterThan(baseBack.length * 1.8);
    expect(back.every((s) => s.scale === 0.5)).toBe(true);
    expect(seats.filter((s) => s.row === 0).length).toBe(base.filter((s) => s.row === 0).length);
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
