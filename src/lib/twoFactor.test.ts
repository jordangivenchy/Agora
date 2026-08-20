import { describe, expect, it } from "vitest";
import {
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  MAX_CODE_SENDS,
  RESEND_COOLDOWN_MS,
  challengeStatus,
  generateCode,
  hashCode,
  hashesMatch,
  resendStatus,
  type PendingChallenge,
} from "./twoFactor";

const NOW = Date.parse("2026-08-20T12:00:00Z");

function challenge(overrides: Partial<PendingChallenge> = {}): PendingChallenge {
  return {
    attempts: 0,
    sends: 1,
    last_sent_at: new Date(NOW - 2 * RESEND_COOLDOWN_MS).toISOString(),
    expires_at: new Date(NOW + CODE_TTL_MS).toISOString(),
    consumed_at: null,
    ...overrides,
  };
}

describe("generateCode", () => {
  it("returns 6 digits, preserving leading zeros", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe("hashCode / hashesMatch", () => {
  it("is deterministic per secret and code", () => {
    expect(hashCode("123456", "s")).toBe(hashCode("123456", "s"));
    expect(hashCode("123456", "s")).not.toBe(hashCode("123457", "s"));
    expect(hashCode("123456", "s")).not.toBe(hashCode("123456", "t"));
  });

  it("compares digests correctly", () => {
    const a = hashCode("000042", "secret");
    expect(hashesMatch(a, hashCode("000042", "secret"))).toBe(true);
    expect(hashesMatch(a, hashCode("000043", "secret"))).toBe(false);
  });

  it("rejects malformed or empty digests instead of throwing", () => {
    expect(hashesMatch("", "")).toBe(false);
    expect(hashesMatch("abcd", hashCode("123456", "s"))).toBe(false);
  });
});

describe("challengeStatus", () => {
  it("accepts a fresh challenge", () => {
    expect(challengeStatus(challenge(), NOW)).toBe("ok");
  });

  it("flags consumed first, even when also expired", () => {
    const row = challenge({
      consumed_at: new Date(NOW - 1000).toISOString(),
      expires_at: new Date(NOW - 500).toISOString(),
    });
    expect(challengeStatus(row, NOW)).toBe("consumed");
  });

  it("expires exactly at the deadline", () => {
    const row = challenge({ expires_at: new Date(NOW).toISOString() });
    expect(challengeStatus(row, NOW)).toBe("expired");
    expect(challengeStatus(row, NOW - 1)).toBe("ok");
  });

  it("locks after the attempt budget is spent", () => {
    expect(challengeStatus(challenge({ attempts: MAX_CODE_ATTEMPTS - 1 }), NOW)).toBe("ok");
    expect(challengeStatus(challenge({ attempts: MAX_CODE_ATTEMPTS }), NOW)).toBe("locked");
  });
});

describe("resendStatus", () => {
  it("allows a resend after the cooldown", () => {
    expect(resendStatus(challenge(), NOW)).toBe("ok");
  });

  it("enforces the cooldown window", () => {
    const row = challenge({ last_sent_at: new Date(NOW - RESEND_COOLDOWN_MS + 1000).toISOString() });
    expect(resendStatus(row, NOW)).toBe("cooldown");
  });

  it("caps total sends per challenge", () => {
    expect(resendStatus(challenge({ sends: MAX_CODE_SENDS }), NOW)).toBe("exhausted");
  });

  it("still permits resending a locked (max-attempts) challenge", () => {
    expect(resendStatus(challenge({ attempts: MAX_CODE_ATTEMPTS }), NOW)).toBe("ok");
  });

  it("refuses consumed and expired challenges", () => {
    expect(resendStatus(challenge({ consumed_at: new Date(NOW).toISOString() }), NOW)).toBe("consumed");
    expect(resendStatus(challenge({ expires_at: new Date(NOW - 1).toISOString() }), NOW)).toBe("expired");
  });
});
