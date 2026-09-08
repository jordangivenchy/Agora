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
   poll (and catch up immediately on becoming visible).

   "Online" means someone is actually looking: the heartbeat only fires
   while the tab is visible and the person has touched it (pointer, key,
   scroll, touch) within the last few minutes. A tab hidden or left idle
   stops beating, and a hidden tab clears its row after a short grace, so
   the person reads as offline within about a minute instead of for as
   long as a forgotten tab stays open. The one exception is a live room:
   someone in a call keeps their presence while the tab is hidden, since
   the call itself is the activity. The local user's own state is
   reflected optimistically right after each heartbeat, so self-presence
   never waits for a poll. Rebuilding from a full fresh SELECT also prunes
   stale rows, so no separate prune tick is needed.

   Consumers read a snapshot map keyed by user id via
   useSyncExternalStore-compatible subscribe/get functions. */

import { createClient } from "@/lib/supabase-browser";

export interface PresenceInfo {
  room_id: string | null;
  /** Waiting in a debate queue (set by the queue boards while queued). */
  queued: boolean;
}

const STALE_MS = 90_000;
const HEARTBEAT_MS = 45_000;
const POLL_MS = 45_000;
const POLL_JITTER_MS = 5_000;
/* No input for this long and the tab counts as unattended. */
const IDLE_MS = 5 * 60_000;
/* A hidden tab clears its row after this, so leaving reads as offline
   quickly rather than at the end of the staleness window. */
const HIDDEN_CLEAR_MS = 30_000;

type Row = { user_id: string; room_id: string | null; queued?: boolean | null; last_seen_at: string };

let polling = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let selfId: string | null = null;
let selfRoom: string | null = null;
let selfQueued = false;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let lastActivity = 0;
let activityHooked = false;
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;

/* Looking at the tab: visible, and touched within IDLE_MS. A live room
   counts as attention on its own. */
function attending(): boolean {
  if (typeof document === "undefined") return true;
  if (selfRoom) return true;
  if (document.visibilityState !== "visible") return false;
  return Date.now() - lastActivity < IDLE_MS;
}

function hookActivity() {
  if (activityHooked || typeof document === "undefined") return;
  activityHooked = true;
  lastActivity = Date.now();
  let last = 0;
  const mark = () => {
    const now = Date.now();
    if (now - last < 1000) return; // pointermove fires constantly; sample it
    last = now;
    const wasIdle = now - lastActivity >= IDLE_MS;
    lastActivity = now;
    // Back from idle (or a fresh visit): say so at once rather than at the next tick.
    if (wasIdle && selfId && document.visibilityState === "visible") beat();
  };
  for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"]) {
    window.addEventListener(ev, mark, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
      lastActivity = Date.now();
      if (selfId) beat();
    } else if (selfId && !selfRoom) {
      // Gone from the tab: drop the row after a grace so a quick
      // tab-switch doesn't flicker, but leaving reads as offline soon.
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = setTimeout(() => {
        hiddenTimer = null;
        if (document.visibilityState === "visible" || !selfId || selfRoom) return;
        const id = selfId;
        createClient().rpc("clear_presence").then(() => {
          rows.delete(id);
          rebuildSnapshot();
        }, () => {});
      }, HIDDEN_CLEAR_MS);
    }
  });
}

/* Live rows by user id; the exported snapshot only includes fresh ones. */
const rows = new Map<string, { room_id: string | null; queued: boolean; lastSeen: number }>();

/* Immutable snapshot (useSyncExternalStore requires stable references). */
let snapshot: ReadonlyMap<string, PresenceInfo> = new Map();
const listeners = new Set<() => void>();

function rebuildSnapshot() {
  const cutoff = Date.now() - STALE_MS;
  const next = new Map<string, PresenceInfo>();
  for (const [id, r] of rows) {
    if (r.lastSeen >= cutoff) next.set(id, { room_id: r.room_id, queued: r.queued });
    else rows.delete(id);
  }
  snapshot = next;
  listeners.forEach((l) => l());
}

function ingest(row: Row) {
  rows.set(row.user_id, {
    room_id: row.room_id ?? null,
    queued: !!row.queued,
    lastSeen: new Date(row.last_seen_at).getTime(),
  });
}

async function beat() {
  if (!selfId) return;
  if (!attending()) return; // a background or idle tab is not "online"
  const id = selfId;
  const room = selfRoom;
  const queued = selfQueued;
  const supabase = createClient();
  // The cached selfId can outlive the session (sign-out in another tab,
  // a tick racing the SIGNED_OUT callback, a dropped refresh), and
  // touch_presence is authenticated-only — so confirm a live session and
  // stop the heartbeat when it's gone; ensurePresence re-arms on sign-in.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    return;
  }
  supabase.rpc("touch_presence", { p_room: room, p_queued: queued }).then(() => {
    // Reflect our own write immediately — don't wait for the next poll.
    ingest({ user_id: id, room_id: room, queued, last_seen_at: new Date().toISOString() });
    rebuildSnapshot();
  }, () => {});
}

/** Queue boards flip this while the local user is waiting in a debate
    queue. Only a change triggers an immediate heartbeat. */
export function setPresenceQueued(queued: boolean) {
  if (queued === selfQueued) return;
  selfQueued = queued;
  if (selfId) beat();
}

/* One poll: fetch everyone fresh within the staleness window and rebuild
   the whole snapshot from the result. Stale rows simply aren't selected,
   so this subsumes the old prune tick. */
function poll() {
  const supabase = createClient();
  supabase
    .from("user_presence")
    .select("user_id, room_id, queued, last_seen_at")
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
    hookActivity();
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
