"use client";

/* Global online-presence store, backed by the user_presence table instead
   of a realtime presence channel. The old channel trusted a client-chosen
   payload ({ user_id }), so anyone could impersonate anyone's online
   status; the table is written only through touch_presence(), which takes
   identity from auth.uid() — spoof-proof by construction.

   Mechanics: signed-in tabs heartbeat touch_presence(room) every 45s (and
   on route changes); everyone POLLS the table every ~45s (±5s jitter, so
   clients don't thundering-herd) for rows fresh within the 90s staleness
   window and rebuilds the snapshot from scratch. We used to follow
   table-wide realtime change events instead, but that fans every
   heartbeat out to every client — N writes × N listeners per interval,
   ~N² messages — where polling is one linear query per client. Presence
   latency of up to ~a minute is the accepted trade. Hidden tabs skip the
   poll (and catch up immediately on becoming visible); the heartbeat
   keeps running so the user stays online. The local user's own state is
   reflected optimistically right after each heartbeat, so self-presence
   never waits for a poll. Rebuilding from a full fresh SELECT also prunes
   stale rows, so no separate prune tick is needed.

   Consumers read a snapshot map keyed by user id via
   useSyncExternalStore-compatible subscribe/get functions. */

import { createClient } from "@/lib/supabase-browser";

export interface PresenceInfo {
  room_id: string | null;
}

const STALE_MS = 90_000;
const HEARTBEAT_MS = 45_000;
const POLL_MS = 45_000;
const POLL_JITTER_MS = 5_000;

type Row = { user_id: string; room_id: string | null; last_seen_at: string };

let polling = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let selfId: string | null = null;
let selfRoom: string | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

/* Live rows by user id; the exported snapshot only includes fresh ones. */
const rows = new Map<string, { room_id: string | null; lastSeen: number }>();

/* Immutable snapshot (useSyncExternalStore requires stable references). */
let snapshot: ReadonlyMap<string, PresenceInfo> = new Map();
const listeners = new Set<() => void>();

function rebuildSnapshot() {
  const cutoff = Date.now() - STALE_MS;
  const next = new Map<string, PresenceInfo>();
  for (const [id, r] of rows) {
    if (r.lastSeen >= cutoff) next.set(id, { room_id: r.room_id });
    else rows.delete(id);
  }
  snapshot = next;
  listeners.forEach((l) => l());
}

function ingest(row: Row) {
  rows.set(row.user_id, {
    room_id: row.room_id ?? null,
    lastSeen: new Date(row.last_seen_at).getTime(),
  });
}

function beat() {
  if (!selfId) return;
  const id = selfId;
  const room = selfRoom;
  const supabase = createClient();
  supabase.rpc("touch_presence", { p_room: room }).then(() => {
    // Reflect our own write immediately — don't wait for the next poll.
    ingest({ user_id: id, room_id: room, last_seen_at: new Date().toISOString() });
    rebuildSnapshot();
  }, () => {});
}

/* One poll: fetch everyone fresh within the staleness window and rebuild
   the whole snapshot from the result. Stale rows simply aren't selected,
   so this subsumes the old prune tick. */
function poll() {
  const supabase = createClient();
  supabase
    .from("user_presence")
    .select("user_id, room_id, last_seen_at")
    .gt("last_seen_at", new Date(Date.now() - STALE_MS).toISOString())
    .then(({ data }) => {
      if (data) {
        rows.clear();
        data.forEach((r) => ingest(r as Row));
      }
      rebuildSnapshot();
    });
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  const jitter = (Math.random() * 2 - 1) * POLL_JITTER_MS;
  pollTimer = setTimeout(() => {
    // Background tabs shouldn't query; we catch up on visibilitychange.
    if (typeof document === "undefined" || document.visibilityState !== "hidden") {
      poll();
    }
    schedulePoll();
  }, POLL_MS + jitter);
}

/** Boot (or update) presence. Safe to call repeatedly — PresenceBoot calls
    this on auth and route changes. Signed-out users still poll (to read
    who's online) but never write. */
export function ensurePresence(userId: string | null, roomId: string | null) {
  const roomChanged = roomId !== selfRoom || userId !== selfId;
  selfId = userId;
  selfRoom = roomId;

  if (!polling) {
    polling = true;
    poll(); // seed with everyone currently fresh
    schedulePoll();

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          poll(); // catch up right away, then resume the cadence
          schedulePoll();
        }
      });
    }
  }

  if (selfId) {
    if (!heartbeat) heartbeat = setInterval(beat, HEARTBEAT_MS);
    if (roomChanged) beat();
  } else if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

export function subscribePresence(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPresenceSnapshot(): ReadonlyMap<string, PresenceInfo> {
  return snapshot;
}
