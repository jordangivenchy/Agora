import { describe, it, expect } from "vitest";
import { compareAudienceOrder, sortAudience, type AudienceMember } from "./audienceOrder";

// Helper: build a member with a raise time and/or join time.
const m = (joined_at: string | null, hand_raised_at: string | null = null): AudienceMember => ({
  joined_at,
  hand_raised_at,
});

describe("audience line ordering", () => {
  it("puts any raised hand ahead of any lowered hand, regardless of join time", () => {
    // b joined way earlier but has no hand up; a joined late but raised.
    const a = m("2026-07-08T10:00:00Z", "2026-07-08T10:30:00Z");
    const b = m("2026-07-08T09:00:00Z", null);
    expect(compareAudienceOrder(a, b)).toBeLessThan(0); // a first
    expect(compareAudienceOrder(b, a)).toBeGreaterThan(0);
  });

  it("orders raised hands by who raised longest ago (oldest raise first)", () => {
    const early = m("2026-07-08T10:00:00Z", "2026-07-08T10:05:00Z");
    const late = m("2026-07-08T09:00:00Z", "2026-07-08T10:10:00Z");
    const [first, second] = sortAudience([late, early]);
    expect(first).toBe(early); // raised at 10:05, longer ago than 10:10
    expect(second).toBe(late);
  });

  it("orders lowered hands by longest time in the audience (earliest join first)", () => {
    const old = m("2026-07-08T09:00:00Z", null);
    const recent = m("2026-07-08T09:45:00Z", null);
    const [first, second] = sortAudience([recent, old]);
    expect(first).toBe(old);
    expect(second).toBe(recent);
  });

  it("produces a full front-to-back line across a mixed audience", () => {
    const raisedOld = m("2026-07-08T10:00:00Z", "2026-07-08T10:02:00Z");
    const raisedNew = m("2026-07-08T09:30:00Z", "2026-07-08T10:20:00Z");
    const downOld = m("2026-07-08T08:00:00Z", null);
    const downNew = m("2026-07-08T09:00:00Z", null);

    const line = sortAudience([downNew, raisedNew, downOld, raisedOld]);
    // Raised (oldest raise → newest raise), then hands-down (oldest join → newest).
    expect(line).toEqual([raisedOld, raisedNew, downOld, downNew]);
  });

  it("does not mutate the input array", () => {
    const input = [m("2026-07-08T10:00:00Z", null), m("2026-07-08T09:00:00Z", null)];
    const copy = [...input];
    sortAudience(input);
    expect(input).toEqual(copy);
  });

  it("treats a missing join time as earliest (front of the hands-down group)", () => {
    const noJoin = m(null, null);
    const joined = m("2026-07-08T09:00:00Z", null);
    expect(compareAudienceOrder(noJoin, joined)).toBeLessThan(0);
  });
});
