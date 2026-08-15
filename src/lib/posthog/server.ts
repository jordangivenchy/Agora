/* PostHog server-side capture. Fire-and-forget by design: analytics must never
   add latency to, or fail, a chat request.

   Uses PostHog's public /i/v0/e/ capture endpoint over fetch rather than the
   posthog-node SDK — the SDK's batching queue doesn't fit serverless route
   handlers (events sitting in a queue are lost when the lambda freezes), and
   capture is the only write operation we need. */

const POSTHOG_HOST = (process.env.POSTHOG_HOST ?? "https://us.i.posthog.com").replace(/\/$/, "");

export function posthogEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

/**
 * Records an event against a user. Never throws, never blocks: callers do NOT
 * await the network round trip beyond the fetch dispatch.
 */
export function captureEvent(params: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  /** Person properties to $set on the profile — feeds the trait cache. */
  set?: Record<string, unknown>;
}): void {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  const body = JSON.stringify({
    api_key: key,
    event: params.event,
    distinct_id: params.distinctId,
    properties: {
      ...params.properties,
      ...(params.set ? { $set: params.set } : {}),
    },
    timestamp: new Date().toISOString(),
  });

  fetch(`${POSTHOG_HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    // Let the platform finish the request after the response is sent.
    keepalive: true,
  }).catch((err) => {
    console.error("[posthog] capture failed:", err);
  });
}
