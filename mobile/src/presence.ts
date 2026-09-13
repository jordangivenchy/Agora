/* Presence, the site's table-backed store (lib/presence.ts): while the
   app is up front and signed in, touch_presence(room, queued) every
   45s; everyone polls user_presence for rows fresh within 90s. A row
   is cleared when the app goes to the background (a call keeps it). */
import { AppState, type AppStateStatus } from "react-native";
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface PresenceInfo { room_id: string | null; queued: boolean }

const STALE_MS = 90_000;
const HEARTBEAT_MS = 45_000;
const POLL_MS = 45_000;

let selfId: string | null = null;
let selfRoom: string | null = null;
let selfQueued = false;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let booted = false;
let foreground = true;

const rows = new Map<string, { room_id: string | null; queued: boolean; lastSeen: number }>();
let snapshot: ReadonlyMap<string, PresenceInfo> = new Map();
const listeners = new Set<() => void>();

function rebuild() {
  const cutoff = Date.now() - STALE_MS;
  const next = new Map<string, PresenceInfo>();
  for (const [id, r] of rows) {
    if (r.lastSeen >= cutoff) next.set(id, { room_id: r.room_id, queued: r.queued });
    else rows.delete(id);
  }
  snapshot = next;
  listeners.forEach((l) => l());
}

async function beat() {
  if (!selfId || (!foreground && !selfRoom)) return;
  const id = selfId, room = selfRoom, queued = selfQueued;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const { error } = await supabase.rpc("touch_presence", { p_room: room, p_queued: queued });
  if (!error) {
    rows.set(id, { room_id: room, queued, lastSeen: Date.now() });
    rebuild();
  }
}

function poll() {
  if (!foreground) return;
  void supabase
    .from("user_presence")
    .select("user_id, room_id, queued, last_seen_at")
    .gt("last_seen_at", new Date(Date.now() - STALE_MS).toISOString())
    .then(({ data }) => {
      if (data) {
        rows.clear();
        for (const r of data as { user_id: string; room_id: string | null; queued: boolean | null; last_seen_at: string }[]) {
          rows.set(r.user_id, { room_id: r.room_id ?? null, queued: !!r.queued, lastSeen: new Date(r.last_seen_at).getTime() });
        }
      }
      rebuild();
    });
}

function onAppState(state: AppStateStatus) {
  const was = foreground;
  foreground = state === "active";
  if (foreground && !was) { poll(); void beat(); }
  else if (!foreground && was && selfId && !selfRoom) {
    void supabase.rpc("clear_presence").then(() => { if (selfId) rows.delete(selfId); rebuild(); }, () => undefined);
  }
}

/** Boot or update: who we are and which room we are in. Safe to call often. */
export function ensurePresence(userId: string | null, roomId: string | null) {
  const changed = roomId !== selfRoom || userId !== selfId;
  selfId = userId;
  selfRoom = roomId;
  if (!booted) {
    booted = true;
    foreground = AppState.currentState === "active";
    AppState.addEventListener("change", onAppState);
    poll();
    pollTimer = setInterval(poll, POLL_MS + Math.round((Math.random() * 2 - 1) * 5000));
  }
  if (selfId) {
    if (!heartbeat) heartbeat = setInterval(() => void beat(), HEARTBEAT_MS);
    if (changed) void beat();
  } else if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  void pollTimer;
}

export function setPresenceQueued(queued: boolean) {
  if (queued === selfQueued) return;
  selfQueued = queued;
  if (selfId) void beat();
}

export function usePresence(): ReadonlyMap<string, PresenceInfo> {
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    const l = () => setSnap(snapshot);
    listeners.add(l);
    setSnap(snapshot);
    return () => { listeners.delete(l); };
  }, []);
  return snap;
}
