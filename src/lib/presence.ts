"use client";

/* Global online-presence store, backed by one Supabase Realtime presence
   channel shared by every signed-in tab. Each client tracks
   { user_id, room_id } (room when they're on a room page). Consumers read
   a snapshot map keyed by user id via useSyncExternalStore-compatible
   subscribe/get functions. */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-browser";

export interface PresenceInfo {
  room_id: string | null;
}

let channel: RealtimeChannel | null = null;
let selfId: string | null = null;
let selfRoom: string | null = null;
let joined = false;

/* Immutable snapshot (useSyncExternalStore requires stable references). */
let snapshot: ReadonlyMap<string, PresenceInfo> = new Map();
const listeners = new Set<() => void>();

function rebuildSnapshot() {
  if (!channel) return;
  const next = new Map<string, PresenceInfo>();
  const state = channel.presenceState<{ user_id: string; room_id: string | null }>();
  for (const metas of Object.values(state)) {
    for (const m of metas) {
      if (!m.user_id) continue;
      // A user may be present from several tabs; any non-null room wins.
      const cur = next.get(m.user_id);
      if (!cur || (!cur.room_id && m.room_id)) next.set(m.user_id, { room_id: m.room_id ?? null });
    }
  }
  snapshot = next;
  listeners.forEach((l) => l());
}

function track() {
  if (!channel || !joined || !selfId) return;
  channel.track({ user_id: selfId, room_id: selfRoom });
}

/** Boot (or update) presence. Safe to call repeatedly — PresenceBoot calls
    this on auth and route changes. Signed-out users still join (to read
    who's online) but track nothing. */
export function ensurePresence(userId: string | null, roomId: string | null) {
  selfId = userId;
  selfRoom = roomId;
  if (!channel) {
    const supabase = createClient();
    channel = supabase.channel("presence:online", {
      config: { presence: { key: userId ?? `anon-${Math.random().toString(36).slice(2)}` } },
    });
    channel
      .on("presence", { event: "sync" }, rebuildSnapshot)
      .on("presence", { event: "join" }, rebuildSnapshot)
      .on("presence", { event: "leave" }, rebuildSnapshot)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          joined = true;
          track();
        }
      });
    return;
  }
  track();
}

export function subscribePresence(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPresenceSnapshot(): ReadonlyMap<string, PresenceInfo> {
  return snapshot;
}
