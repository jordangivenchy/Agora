"use client";

/* Global online-presence store, backed by the user_presence table instead
   of a realtime presence channel. The old channel trusted a client-chosen
   payload ({ user_id }), so anyone could impersonate anyone's online
   status; the table is written only through touch_presence(), which takes
   identity from auth.uid() — spoof-proof by construction.

   Mechanics: signed-in tabs heartbeat touch_presence(room) every 45s (and
   on route changes); everyone reads the table once, then follows realtime
   change events. A row older than 90s counts as offline, enforced by a
   local prune tick, so vanished tabs go dark without any server sweep.

   Consumers read a snapshot map keyed by user id via
   useSyncExternalStore-compatible subscribe/get functions. */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-browser";

export interface PresenceInfo {
  room_id: string | null;
}

const STALE_MS = 90_000;
const HEARTBEAT_MS = 45_000;

type Row = { user_id: string; room_id: string | null; last_seen_at: string };

let channel: RealtimeChannel | null = null;
let selfId: string | null = null;
let selfRoom: string | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let pruner: ReturnType<typeof setInterval> | null = null;

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
  const supabase = createClient();
  supabase.rpc("touch_presence", { p_room: selfRoom }).then(undefined, () => {});
}

/** Boot (or update) presence. Safe to call repeatedly — PresenceBoot calls
    this on auth and route changes. Signed-out users still subscribe (to
    read who's online) but never write. */
export function ensurePresence(userId: string | null, roomId: string | null) {
  const roomChanged = roomId !== selfRoom || userId !== selfId;
  selfId = userId;
  selfRoom = roomId;

  const supabase = createClient();

  if (!channel) {
    channel = supabase
      .channel("presence-table")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_presence" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<Row>;
            if (old.user_id) rows.delete(old.user_id);
          } else {
            ingest(payload.new as Row);
          }
          rebuildSnapshot();
        }
      )
      .subscribe();

    // Seed with everyone currently fresh.
    supabase
      .from("user_presence")
      .select("user_id, room_id, last_seen_at")
      .gt("last_seen_at", new Date(Date.now() - STALE_MS).toISOString())
      .then(({ data }) => {
        (data ?? []).forEach((r) => ingest(r as Row));
        rebuildSnapshot();
      });

    pruner = setInterval(rebuildSnapshot, 30_000);
  }

  if (selfId) {
    if (!heartbeat) heartbeat = setInterval(beat, HEARTBEAT_MS);
    if (roomChanged) beat();
  } else if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }

  // Void the unused pruner reference lint-wise; teardown happens on unload.
  void pruner;
}

export function subscribePresence(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPresenceSnapshot(): ReadonlyMap<string, PresenceInfo> {
  return snapshot;
}
