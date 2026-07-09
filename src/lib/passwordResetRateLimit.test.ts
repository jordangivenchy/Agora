import { describe, it, expect } from "vitest";
import {
  isRateLimited,
  isPasswordResetRateLimited,
  EMAIL_MAX_ATTEMPTS,
  EMAIL_WINDOW_MS,
  IP_MAX_ATTEMPTS,
} from "./passwordResetRateLimit";

describe("isRateLimited", () => {
  it("allows requests under the limit", () => {
    const now = 1_000_000;
    const attempts = [now - 1000, now - 2000];
    expect(isRateLimited(attempts, 60_000, 3, now)).toBe(false);
  });

  it("blocks at exactly the limit", () => {
    const now = 1_000_000;
    const attempts = [now - 1000, now - 2000, now - 3000];
    expect(isRateLimited(attempts, 60_000, 3, now)).toBe(true);
  });

  it("ignores attempts outside the window", () => {
    const now = 1_000_000;
    // 3 attempts, but 2 are far outside a 60s window
    const attempts = [now - 1000, now - 120_000, now - 200_000];
    expect(isRateLimited(attempts, 60_000, 3, now)).toBe(false);
  });

  it("blocks once enough attempts fall inside the window", () => {
    const now = 1_000_000;
    const attempts = [now - 1000, now - 2000, now - 120_000];
    expect(isRateLimited(attempts, 60_000, 2, now)).toBe(true);
  });
});

describe("isPasswordResetRateLimited", () => {
  const now = 2_000_000;

  it("allows a first-time request from a fresh email and IP", () => {
    expect(isPasswordResetRateLimited({ emailAttempts: [], ipAttempts: [], now })).toBe(false);
  });

  it("blocks when the email has hit its limit even if the IP is fine", () => {
    const emailAttempts = Array.from({ length: EMAIL_MAX_ATTEMPTS }, (_, i) => now - i * 1000);
    expect(
      isPasswordResetRateLimited({ emailAttempts, ipAttempts: [], now })
    ).toBe(true);
  });

  it("blocks when the IP has hit its limit even if the email is fine", () => {
    const ipAttempts = Array.from({ length: IP_MAX_ATTEMPTS }, (_, i) => now - i * 1000);
    expect(
      isPasswordResetRateLimited({ emailAttempts: [], ipAttempts, now })
    ).toBe(true);
  });

  it("recovers once attempts age out of the window (retry-after semantics)", () => {
    const staleAttempts = Array.from(
      { length: EMAIL_MAX_ATTEMPTS },
      () => now - EMAIL_WINDOW_MS - 1000
    );
    expect(
      isPasswordResetRateLimited({ emailAttempts: staleAttempts, ipAttempts: [], now })
    ).toBe(false);
  });
});
