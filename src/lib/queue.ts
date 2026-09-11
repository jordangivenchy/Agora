/* The matchmaking queue as one store for the whole site. Any "Queue"
   button — a daily question, a headline, a post's conversation, the
   feed rail — opens the queue panel (components/QueueDock.tsx) with
   that question; joining and leaving go through here; and the panel,
   mounted by the chrome, keeps polling for a match wherever the person
   browses next. A match sends them into the room with a full load.
   On a fresh page the panel restores whatever the account is already
   waiting on (get_debate_topics says which; topic_queue says since
   when) and heartbeats those entries so they can be matched again. */

import { useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-browser";
import { sessionUser } from "@/lib/session";
import { setPresenceQueued } from "@/lib/presence";

export type Stance = "PRO" | "CON";

/** A question the panel can offer: a standing topic (id) or a headline (id null, made on join). */
export type QueueTopic = {
  id: string | null;
  question: string;
  topicKey: string;
  queueCount: number;
  proCount?: number;
  conCount?: number;
  sourceUrl?: string | null;
};

export type QueueEntry = {
  topicId: string;
  question: string;
  topicKey: string;
  stance: Stance;
  /** When this account joined, ms since the epoch. */
  since: number;
};

export type QueueState = {
  /** The panel is expanded (false: the pill, or nothing when there is nothing to show). */
  open: boolean;
  /** The question being offered, not yet joined. */
  preview: QueueTopic | null;
  entries: QueueEntry[];
  busy: boolean;
  error: string | null;
  /** A room to go to; set the moment a match lands. */
  matched: string | null;
};

const EMPTY: QueueState = { open: false, preview: null, entries: [], busy: false, error: null, matched: null };
let state: QueueState = EMPTY;
const listeners = new Set<() => void>();
let restored = false;
let client: SupabaseClient | null = null;
const supabase = () => (client ??= createClient());

function set(patch: Partial<QueueState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("agora:queue-changed"));
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
const readServer = () => EMPTY;
export function useQueue(): QueueState {
  return useSyncExternalStore(subscribe, () => state, readServer);
}
export function queueSnapshot(): QueueState { return state; }
export function isQueued(topicId: string | null): boolean {
  return !!topicId && state.entries.some((e) => e.topicId === topicId);
}
export function isQueuedFor(question: string): boolean {
  return state.entries.some((e) => e.question === question);
}
const friendly = (m: string) => m.replace(/^[a-z_]+:\s*/, "");

/** Offer a question in the panel. */
export function openQueue(topic: QueueTopic): void {
  set({ open: true, preview: topic, error: null });
}
export function expandQueue(): void { set({ open: true }); }
/** Down to the pill (or away, when nothing is waiting). The offer is dropped. */
export function collapseQueue(): void { set({ open: false, preview: null, error: null }); }

/** Join the offered question with a stance. A match opens the room at once. */
export async function joinQueue(stance: Stance): Promise<void> {
  const t = state.preview;
  if (!t || state.busy) return;
  const { data: auth } = await sessionUser(supabase());
  if (!auth.user) { window.location.href = "/login"; return; }
  set({ busy: true, error: null });
  const call = t.id
    ? supabase().rpc("queue_for_topic", { p_topic: t.id, p_stance: stance })
    : supabase().rpc("queue_for_headline", { p_question: t.question, p_topic_key: t.topicKey, p_stance: stance, p_source_url: t.sourceUrl ?? null });
  const { data, error } = await call;
  if (error) { set({ busy: false, error: friendly(error.message) }); return; }
  const res = data as { status?: string; room_id?: string; topic_id?: string } | null;
  if (res?.status === "matched" && res.room_id) { goToRoom(res.room_id); return; }
  const topicId = t.id ?? res?.topic_id ?? null;
  if (!topicId) { set({ busy: false, error: "Couldn't queue — try again." }); return; }
  const entry: QueueEntry = { topicId, question: t.question, topicKey: t.topicKey, stance, since: Date.now() };
  set({ busy: false, preview: null, entries: [...state.entries.filter((e) => e.topicId !== topicId), entry] });
  setPresenceQueued(true);
}

export async function leaveQueue(topicId: string): Promise<void> {
  if (state.busy) return;
  set({ busy: true });
  await supabase().rpc("leave_topic_queue", { p_topic: topicId });
  const entries = state.entries.filter((e) => e.topicId !== topicId);
  set({ busy: false, entries, open: entries.length > 0 || !!state.preview ? state.open : false });
  setPresenceQueued(entries.length > 0);
}

/** Into the matched room with the bar up, a full load. */
export function goToRoom(roomId: string): void {
  if (state.matched) return;
  set({ matched: roomId, open: true });
  setPresenceQueued(false);
  window.__agoraLeave?.();
  window.setTimeout(() => { window.location.href = `/agora/${roomId}`; }, 350);
}

/** One poll: heartbeats every entry and returns the room if a match landed. */
export async function pollQueue(): Promise<void> {
  if (!state.entries.length || state.matched) return;
  const { data } = await supabase().rpc("check_topic_match");
  if (typeof data === "string" && data) goToRoom(data);
}

/** On a fresh page: pick up whatever the account is already waiting on. */
export async function restoreQueue(): Promise<void> {
  if (restored) return;
  restored = true;
  const { data: auth } = await sessionUser(supabase());
  if (!auth.user) return;
  const [{ data: topics }, { data: rows }] = await Promise.all([
    supabase().rpc("get_debate_topics"),
    supabase().from("topic_queue").select("topic_id, created_at").is("matched_room_id", null),
  ]);
  const since = new Map<string, number>();
  for (const r of (rows ?? []) as { topic_id: string; created_at: string }[]) since.set(r.topic_id, Date.parse(r.created_at) || Date.now());
  const mine = ((topics ?? []) as { id: string; question: string; topic_key: string; am_queued: boolean; my_stance: string | null }[])
    .filter((t) => t.am_queued && !state.entries.some((e) => e.topicId === t.id));
  if (!mine.length) return;
  const entries: QueueEntry[] = mine.map((t) => ({
    topicId: t.id, question: t.question, topicKey: t.topic_key,
    stance: t.my_stance === "CON" ? "CON" : "PRO", since: since.get(t.id) ?? Date.now(),
  }));
  set({ entries: [...state.entries, ...entries] });
  setPresenceQueued(true);
  /* Heartbeat each (a row gone stale is re-made); a match waiting is taken. */
  for (const e of entries) {
    const { data } = await supabase().rpc("queue_for_topic", { p_topic: e.topicId, p_stance: e.stance });
    const res = data as { status?: string; room_id?: string } | null;
    if (res?.status === "matched" && res.room_id) { goToRoom(res.room_id); return; }
  }
}
