/**
 * Rate-limit policy for password reset requests. The decision logic lives
 * here as a pure function so it's unit-testable without a database; the
 * API route (src/app/api/auth/forgot-password/route.ts) is responsible for
 * fetching recent attempt timestamps from Postgres and calling this.
 *
 * Two independent windows, both enforced — a request is blocked if EITHER
 * limit is hit:
 *   - per email:  cheap to guess, so a tight cap stops "spam this address"
 *   - per IP:     stops one client from farming many different emails
 */
export const EMAIL_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const EMAIL_MAX_ATTEMPTS = 3;

export const IP_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const IP_MAX_ATTEMPTS = 8;

export function isRateLimited(
  attemptTimestamps: number[],
  windowMs: number,
  maxAttempts: number,
  now: number = Date.now()
): boolean {
  const recent = attemptTimestamps.filter((t) => now - t < windowMs);
  return recent.length >= maxAttempts;
}

export function isPasswordResetRateLimited(params: {
  emailAttempts: number[];
  ipAttempts: number[];
  now?: number;
}): boolean {
  const now = params.now ?? Date.now();
  return (
    isRateLimited(params.emailAttempts, EMAIL_WINDOW_MS, EMAIL_MAX_ATTEMPTS, now) ||
    isRateLimited(params.ipAttempts, IP_WINDOW_MS, IP_MAX_ATTEMPTS, now)
  );
}
