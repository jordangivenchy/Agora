import { describe, it, expect } from "vitest";
import {
  checkChatRateLimit,
  BURST_MAX_REQUESTS,
  BURST_WINDOW_MS,
  SUSTAINED_MAX_REQUESTS,
} from "./rateLimit";

describe("checkChatRateLimit", () => {
  const now = 10_000_000;

  it("allows a first request", () => {
    expect(checkChatRateLimit({ requestTimestamps: [], now })).toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
  });

  it("allows requests just under the burst limit", () => {
    const timestamps = Array.from({ length: BURST_MAX_REQUESTS - 1 }, (_, i) => now - i * 1000);
    expect(checkChatRateLimit({ requestTimestamps: timestamps, now }).limited).toBe(false);
  });

  it("blocks at the burst limit and returns a sane retry-after", () => {
    const timestamps = Array.from({ length: BURST_MAX_REQUESTS }, (_, i) => now - i * 1000);
    const decision = checkChatRateLimit({ requestTimestamps: timestamps, now });
    expect(decision.limited).toBe(true);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(BURST_WINDOW_MS / 1000);
  });

  it("recovers once burst requests age out of the window", () => {
    const timestamps = Array.from(
      { length: BURST_MAX_REQUESTS },
      () => now - BURST_WINDOW_MS - 1000
    );
    expect(checkChatRateLimit({ requestTimestamps: timestamps, now }).limited).toBe(false);
  });

  it("blocks on the sustained limit even when the burst window is clear", () => {
    // Spread over the hour: never more than a few per minute, but too many total.
    const timestamps = Array.from(
      { length: SUSTAINED_MAX_REQUESTS },
      (_, i) => now - BURST_WINDOW_MS - i * 30_000
    );
    const decision = checkChatRateLimit({ requestTimestamps: timestamps, now });
    expect(decision.limited).toBe(true);
  });
});
