/**
 * Rate-limit policy for the Agora AI assistant. Pure decision logic, so it is
 * unit-testable without a database; the API route (src/app/api/agora/route.ts)
 * fetches recent message timestamps from Postgres and calls this.
 *
 * Two windows, both enforced — a request is blocked if EITHER limit is hit:
 *   - burst:    stops one user hammering the orb during a heated exchange
 *   - sustained: caps what a single account can cost us over an hour
 *
 * At 10k DAU the sustained cap is what actually bounds spend; the burst window
 * mostly protects latency for everyone else in the room.
 */
export const BURST_WINDOW_MS = 60 * 1000; // 1 min
export const BURST_MAX_REQUESTS = 6;

export const SUSTAINED_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const SUSTAINED_MAX_REQUESTS = 60;

export interface RateLimitDecision {
  limited: boolean;
  /** Seconds until the caller may retry. 0 when not limited. */
  retryAfterSeconds: number;
}

function decide(
  timestamps: number[],
  windowMs: number,
  maxRequests: number,
  now: number
): RateLimitDecision {
  const recent = timestamps.filter((t) => now - t < windowMs);
  if (recent.length < maxRequests) return { limited: false, retryAfterSeconds: 0 };

  // The oldest request inside the window is the one that has to age out before
  // a slot frees up.
  const oldest = Math.min(...recent);
  const retryAfterMs = windowMs - (now - oldest);
  return {
    limited: true,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

export function checkChatRateLimit(params: {
  /** Epoch-ms timestamps of this user's recent questions, newest or oldest first. */
  requestTimestamps: number[];
  now?: number;
}): RateLimitDecision {
  const now = params.now ?? Date.now();
  const burst = decide(params.requestTimestamps, BURST_WINDOW_MS, BURST_MAX_REQUESTS, now);
  if (burst.limited) return burst;
  return decide(params.requestTimestamps, SUSTAINED_WINDOW_MS, SUSTAINED_MAX_REQUESTS, now);
}
