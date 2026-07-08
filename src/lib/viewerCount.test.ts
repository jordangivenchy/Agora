import { describe, it, expect } from "vitest";
import { uniqueViewerCount } from "./viewerCount";

describe("uniqueViewerCount", () => {
  it("is 0 for an empty room", () => {
    expect(uniqueViewerCount([])).toBe(0);
  });

  it("increments as users join", () => {
    expect(uniqueViewerCount(["host"])).toBe(1);
    expect(uniqueViewerCount(["host", "spectator-1"])).toBe(2);
    expect(uniqueViewerCount(["host", "spectator-1", "spectator-2"])).toBe(3);
  });

  it("decrements as users leave", () => {
    const before = uniqueViewerCount(["host", "a", "b"]);
    const after = uniqueViewerCount(["host", "a"]);
    expect(before).toBe(3);
    expect(after).toBe(2);
  });

  it("counts the same identity once (multiple tabs / reconnect races)", () => {
    expect(uniqueViewerCount(["host", "user-1", "user-1"])).toBe(2);
  });

  it("recovers to the same count after a reconnect", () => {
    const connected = uniqueViewerCount(["host", "user-1"]);
    const dropped = uniqueViewerCount(["host"]);
    const reconnected = uniqueViewerCount(["host", "user-1"]);
    expect(dropped).toBe(connected - 1);
    expect(reconnected).toBe(connected);
  });

  it("ignores empty/undefined identities so stale entries never inflate the count", () => {
    expect(uniqueViewerCount(["host", null, undefined, ""])).toBe(1);
  });
});
