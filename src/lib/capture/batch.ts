/**
 * Pure batching helpers for the behavioral capture lib. Kept separate from
 * the client transport (track.ts) so the coalescing logic is unit-testable
 * without a DOM or network.
 *
 * Coalescing matters: a user dwelling on one room card fires a dwell signal
 * every second. Sending 30 rows for one 30-second dwell is wasteful and
 * noisy; we fold them into a single row whose `value` is the total. View and
 * click events are point events and pass through, deduped only against an
 * exact immediate repeat (double-fire guard).
 */

import type { UserSignal } from "@/lib/dataPlatform/contract";

/** Signal kinds whose `value` accumulates when repeated on the same subject
    inside a batch (time/progress measures), rather than counting as N events. */
const ACCUMULATING = new Set(["dwell", "watch", "scroll"]);

function subjectKey(s: UserSignal): string {
  return `${s.kind}|${s.subjectType ?? ""}|${s.subjectId ?? ""}`;
}

/**
 * Fold a raw signal buffer into the minimal set of rows worth persisting.
 * Order-preserving for point events; accumulating kinds collapse to one row
 * per subject carrying the summed value.
 */
export function coalesceSignals(signals: UserSignal[]): UserSignal[] {
  const out: UserSignal[] = [];
  const accumIndex = new Map<string, number>(); // subjectKey → index in out

  for (const s of signals) {
    if (ACCUMULATING.has(s.kind)) {
      const key = subjectKey(s);
      const existing = accumIndex.get(key);
      if (existing !== undefined) {
        out[existing] = { ...out[existing], value: (out[existing].value ?? 0) + (s.value ?? 0) };
        continue;
      }
      accumIndex.set(key, out.length);
      out.push({ ...s, value: s.value ?? 0 });
      continue;
    }

    // Point event: drop an exact immediate repeat (UI double-fire), else keep.
    const prev = out[out.length - 1];
    if (prev && subjectKey(prev) === subjectKey(s) && !ACCUMULATING.has(prev.kind)) {
      continue;
    }
    out.push(s);
  }

  return out;
}

/** Guard against a client shipping absurd batches — cap count and clamp the
    per-signal numeric value to a sane range before they hit the DB. */
export function sanitizeBatch(signals: UserSignal[], maxRows = 100): UserSignal[] {
  return coalesceSignals(signals)
    .slice(0, maxRows)
    .map((s) => ({
      ...s,
      kind: String(s.kind).slice(0, 40),
      subjectType: s.subjectType ? String(s.subjectType).slice(0, 40) : undefined,
      subjectId: s.subjectId ? String(s.subjectId).slice(0, 200) : undefined,
      topicKey: s.topicKey ? String(s.topicKey).slice(0, 60) : s.topicKey,
      value:
        typeof s.value === "number" && Number.isFinite(s.value)
          ? Math.max(0, Math.min(s.value, 86_400)) // cap at one day of seconds/ms/percent
          : undefined,
    }));
}
