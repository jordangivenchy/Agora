import { describe, it, expect } from "vitest";
import { coalesceSignals, sanitizeBatch } from "./batch";
import type { UserSignal } from "@/lib/dataPlatform/contract";

const dwell = (id: string, v: number): UserSignal => ({ kind: "dwell", subjectType: "room", subjectId: id, value: v });
const view = (id: string): UserSignal => ({ kind: "view", subjectType: "room", subjectId: id });

describe("coalesceSignals", () => {
  it("sums accumulating signals on the same subject", () => {
    const out = coalesceSignals([dwell("a", 1), dwell("a", 1), dwell("a", 2)]);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(4);
  });

  it("keeps accumulating signals on different subjects separate", () => {
    const out = coalesceSignals([dwell("a", 3), dwell("b", 5)]);
    expect(out).toHaveLength(2);
  });

  it("drops an exact immediate repeat of a point event", () => {
    const out = coalesceSignals([view("a"), view("a"), view("b")]);
    expect(out.map((s) => s.subjectId)).toEqual(["a", "b"]);
  });

  it("keeps a point event that recurs after an intervening subject", () => {
    const out = coalesceSignals([view("a"), view("b"), view("a")]);
    expect(out).toHaveLength(3);
  });

  it("preserves interleaved point and accumulating events", () => {
    const out = coalesceSignals([view("a"), dwell("a", 2), view("a"), dwell("a", 3)]);
    // two views (separated by dwell), one folded dwell of 5
    expect(out.filter((s) => s.kind === "view")).toHaveLength(2);
    const d = out.find((s) => s.kind === "dwell");
    expect(d?.value).toBe(5);
  });
});

describe("sanitizeBatch", () => {
  it("caps the row count", () => {
    const many = Array.from({ length: 250 }, (_, i) => view(`room-${i}`));
    expect(sanitizeBatch(many, 100)).toHaveLength(100);
  });

  it("clamps wild values and truncates long strings", () => {
    const out = sanitizeBatch([{ kind: "watch", subjectId: "x".repeat(500), value: 1e9 }]);
    expect(out[0].value).toBe(86_400);
    expect(out[0].subjectId!.length).toBe(200);
  });

  it("drops a non-finite value rather than storing NaN", () => {
    const out = sanitizeBatch([{ kind: "watch", subjectId: "a", value: NaN }]);
    expect(out[0].value).toBeUndefined();
  });
});
