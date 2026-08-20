/**
 * Email two-factor authentication: pure decision logic + code crypto.
 * The database work lives in the /api/auth/2fa/* routes; everything here
 * is deterministic and unit-testable (see twoFactor.test.ts).
 *
 * Codes are 6 digits, generated with rejection-sampling-free crypto
 * (node randomInt is uniform), and stored only as HMAC-SHA256 hashes.
 * The HMAC secret is derived from the service-role key so activation
 * needs no new env var.
 */
import { createHmac, createHash, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_TTL_MS = 10 * 60 * 1000; // a code is good for 10 minutes
export const MAX_CODE_ATTEMPTS = 5; // wrong guesses before the challenge locks
export const MAX_CODE_SENDS = 4; // emails per challenge (first send included)
export const RESEND_COOLDOWN_MS = 60 * 1000;

// Login-attempt rate limits (password guessing through the 2FA login
// route) — same two-window shape as the password-reset limiter.
export const LOGIN_EMAIL_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_EMAIL_MAX_ATTEMPTS = 10;
export const LOGIN_IP_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_MAX_ATTEMPTS = 30;

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(code).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/** HMAC secret derived from the service-role key — server-only by
    construction, and no extra activation step. */
export function twoFactorSecret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("2FA needs SUPABASE_SERVICE_ROLE_KEY");
  return createHash("sha256").update(`agora-2fa|${key}`).digest("hex");
}

export type PendingChallenge = {
  attempts: number;
  sends: number;
  last_sent_at: string;
  expires_at: string;
  consumed_at: string | null;
};

export type ChallengeStatus = "ok" | "expired" | "consumed" | "locked";

export function challengeStatus(row: PendingChallenge, now: number = Date.now()): ChallengeStatus {
  if (row.consumed_at) return "consumed";
  if (new Date(row.expires_at).getTime() <= now) return "expired";
  if (row.attempts >= MAX_CODE_ATTEMPTS) return "locked";
  return "ok";
}

export type ResendStatus = ChallengeStatus | "cooldown" | "exhausted";

/** A locked challenge may still be resent (the resend issues a fresh code
    and resets the guess counter), so "locked" doesn't block here. */
export function resendStatus(row: PendingChallenge, now: number = Date.now()): ResendStatus {
  if (row.consumed_at) return "consumed";
  if (new Date(row.expires_at).getTime() <= now) return "expired";
  if (row.sends >= MAX_CODE_SENDS) return "exhausted";
  if (now - new Date(row.last_sent_at).getTime() < RESEND_COOLDOWN_MS) return "cooldown";
  return "ok";
}
