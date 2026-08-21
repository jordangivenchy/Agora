"use client";

/* Behavioral capture: the client-side entry point. Call track(signal) from
   anywhere in the app — clicks, views, dwell, watch time, likes, follows,
   searches. Signals buffer locally and flush to /api/signals in batches
   (coalesced first), on an interval, on batch-full, and on page hide.

   Consent is enforced SERVER-SIDE (the route checks has_data_consent). This
   lib can also be told the user opted out, in which case it drops everything
   locally too — belt and suspenders, and no wasted requests.

   Nothing here collects anything sensitive: it records what a user did in
   the app (the same category every product measures), never audio, never
   content of private messages. In-debate analysis is a separate, explicitly
   consented pipeline (see src/lib/positions). */

import type { UserSignal } from "@/lib/dataPlatform/contract";
import { sanitizeBatch } from "./batch";

const FLUSH_MS = 10_000;
const BATCH_MAX = 25;

let buffer: UserSignal[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let enabled = false;
let listenersBound = false;

function flush(useBeacon = false) {
  if (buffer.length === 0) return;
  const rows = sanitizeBatch(buffer);
  buffer = [];
  if (rows.length === 0) return;

  const payload = JSON.stringify({ signals: rows });
  if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/signals", new Blob([payload], { type: "application/json" }));
    return;
  }
  fetch("/api/signals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Analytics loss is acceptable — never surface an error to the user.
  });
}

function bindLifecycle() {
  if (listenersBound || typeof window === "undefined") return;
  listenersBound = true;
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}

/**
 * Enable or disable capture for this session. Wire this to the user's
 * analytics consent flag: on = collect, off = drop locally and stop. Calling
 * with false also clears any buffered-but-unsent signals.
 */
export function setCaptureEnabled(on: boolean) {
  enabled = on;
  if (!on) {
    buffer = [];
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    return;
  }
  bindLifecycle();
  if (!flushTimer) flushTimer = setInterval(() => flush(), FLUSH_MS);
}

/** Record one interaction. No-op unless capture is enabled for this session. */
export function track(signal: UserSignal) {
  if (!enabled || typeof window === "undefined") return;
  buffer.push(signal);
  if (buffer.length >= BATCH_MAX) flush();
}
