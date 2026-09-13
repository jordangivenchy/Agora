/* The matchmaking queue, the site's one store (lib/queue.ts) and its
   panel (components/QueueDock.tsx): any Queue button offers a question
   here — a standing topic or a headline — with a side and a wish;
   joined, it folds to a pill above the tab bar that travels with you,
   polling for a match; a match opens the room. On launch the entries
   the account is already waiting on are restored and heartbeated. */
import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "./supabase";
import { setPresenceQueued } from "./presence";
import { topicOf } from "./topics";
import { colors, fonts } from "./theme";

export type Stance = "PRO" | "CON";
export type Opponent = "anyone" | "disagree";
export type QueueTopic = { id: string | null; question: string; topicKey: string; queueCount: number; proCount?: number; conCount?: number; sourceUrl?: string | null };
export type QueueEntry = { topicId: string; question: string; topicKey: string; stance: Stance; opponent: Opponent; since: number };
export type QueueState = { open: boolean; preview: QueueTopic | null; entries: QueueEntry[]; busy: boolean; error: string | null; matched: string | null };

const EMPTY: QueueState = { open: false, preview: null, entries: [], busy: false, error: null, matched: null };
let state: QueueState = EMPTY;
const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();
let restored = false;

function set(patch: Partial<QueueState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  changeListeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useQueue(): QueueState { return useSyncExternalStore(subscribe, () => state, () => EMPTY); }
/** Cards refresh their counts whenever the queue changes. */
export function onQueueChanged(l: () => void): () => void { changeListeners.add(l); return () => { changeListeners.delete(l); }; }
export function isQueued(topicId: string | null): boolean { return !!topicId && state.entries.some((e) => e.topicId === topicId); }
export function isQueuedFor(question: string): boolean { return state.entries.some((e) => e.question === question); }
const friendly = (m: string) => m.replace(/^[a-z_]+:\s*/, "");

export function openQueue(topic: QueueTopic) { set({ open: true, preview: topic, error: null }); }
export function expandQueue() { set({ open: true }); }
export function collapseQueue() { set({ open: false, preview: null, error: null }); }

export async function joinQueue(stance: Stance, opponent: Opponent = "anyone"): Promise<void> {
  const t = state.preview;
  if (!t || state.busy) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { collapseQueue(); router.push("/sign-in"); return; }
  set({ busy: true, error: null });
  const call = t.id
    ? supabase.rpc("queue_for_topic", { p_topic: t.id, p_stance: stance, p_opponent: opponent })
    : supabase.rpc("queue_for_headline", { p_question: t.question, p_topic_key: t.topicKey, p_stance: stance, p_source_url: t.sourceUrl ?? null, p_opponent: opponent });
  const { data, error } = await call;
  if (error) { set({ busy: false, error: friendly(error.message) }); return; }
  const res = data as { status?: string; room_id?: string; topic_id?: string } | null;
  if (res?.status === "matched" && res.room_id) { goToRoom(res.room_id); return; }
  const topicId = t.id ?? res?.topic_id ?? null;
  if (!topicId) { set({ busy: false, error: "Couldn't queue — try again." }); return; }
  const entry: QueueEntry = { topicId, question: t.question, topicKey: t.topicKey, stance, opponent, since: Date.now() };
  set({ busy: false, preview: null, entries: [...state.entries.filter((e) => e.topicId !== topicId), entry] });
  setPresenceQueued(true);
}

export async function leaveQueue(topicId: string): Promise<void> {
  if (state.busy) return;
  set({ busy: true });
  await supabase.rpc("leave_topic_queue", { p_topic: topicId });
  const entries = state.entries.filter((e) => e.topicId !== topicId);
  set({ busy: false, entries, open: entries.length > 0 || !!state.preview ? state.open : false });
  setPresenceQueued(entries.length > 0);
}

export function goToRoom(roomId: string) {
  if (state.matched) return;
  set({ matched: roomId, open: true });
  setPresenceQueued(false);
  setTimeout(() => {
    set({ matched: null, open: false, entries: [], preview: null });
    router.push({ pathname: "/room/[id]", params: { id: roomId } });
  }, 350);
}

export async function pollQueue(): Promise<void> {
  if (!state.entries.length || state.matched) return;
  const { data } = await supabase.rpc("check_topic_match");
  if (typeof data === "string" && data) goToRoom(data);
}

export async function restoreQueue(): Promise<void> {
  if (restored) return;
  restored = true;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { restored = false; return; }
  const [{ data: topics }, { data: rows }] = await Promise.all([
    supabase.rpc("get_debate_topics"),
    supabase.from("topic_queue").select("topic_id, created_at, opponent").is("matched_room_id", null),
  ]);
  const since = new Map<string, number>();
  const wish = new Map<string, Opponent>();
  for (const r of (rows ?? []) as { topic_id: string; created_at: string; opponent?: string | null }[]) {
    since.set(r.topic_id, Date.parse(r.created_at) || Date.now());
    wish.set(r.topic_id, r.opponent === "disagree" ? "disagree" : "anyone");
  }
  const mine = ((topics ?? []) as { id: string; question: string; topic_key: string; am_queued: boolean; my_stance: string | null }[])
    .filter((t) => t.am_queued && !state.entries.some((e) => e.topicId === t.id));
  if (!mine.length) return;
  const entries: QueueEntry[] = mine.map((t) => ({ topicId: t.id, question: t.question, topicKey: t.topic_key, stance: t.my_stance === "CON" ? "CON" : "PRO", opponent: wish.get(t.id) ?? "anyone", since: since.get(t.id) ?? Date.now() }));
  set({ entries: [...state.entries, ...entries] });
  setPresenceQueued(true);
  for (const e of entries) {
    const { data } = await supabase.rpc("queue_for_topic", { p_topic: e.topicId, p_stance: e.stance, p_opponent: e.opponent });
    const res = data as { status?: string; room_id?: string } | null;
    if (res?.status === "matched" && res.room_id) { goToRoom(res.room_id); return; }
  }
}

const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/* The panel, drawn above the tab bar: solid near-black, the site's words. */
export function QueueDock({ bottom }: { bottom: number }) {
  const q = useQueue();
  const [stance, setStance] = useState<Stance>("PRO");
  const [opponent, setOpponent] = useState<Opponent>("anyone");
  const [now, tick] = useReducer(() => Date.now(), Date.now());
  useEffect(() => { void restoreQueue(); }, []);
  useEffect(() => {
    if (!q.entries.length || q.matched) return;
    const t = setInterval(() => { void pollQueue(); }, 2500);
    return () => clearInterval(t);
  }, [q.entries.length, q.matched]);
  useEffect(() => {
    if (!q.entries.length) return;
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [q.entries.length]);
  if (!q.preview && !q.entries.length && !q.matched) return null;

  const n = q.entries.length;
  const oldest = n ? Math.min(...q.entries.map((e) => e.since)) : 0;
  if (!q.open) {
    return (
      <Pressable onPress={expandQueue} style={{ position: "absolute", right: 12, bottom: bottom + 10, flexDirection: "row", alignItems: "center", gap: 8, height: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: "#111114", borderWidth: 1, borderColor: "#2e2e38" }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.gold }} />
        <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 12.5 }}>In queue · {n} question{n === 1 ? "" : "s"} · {mmss(now - oldest)}</Text>
        <Ionicons name="chevron-up" size={14} color={colors.muted} />
      </Pressable>
    );
  }
  const p = q.preview && !isQueued(q.preview.id) ? q.preview : null;
  const pf = p ? topicOf(p.topicKey) : null;
  const radio = (on: boolean, label: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: on ? colors.yellow : "#17171c", borderWidth: 1, borderColor: on ? colors.yellow : "#2e2e38" }}>
      <Text style={{ color: on ? colors.ink : "#c9c9d2", fontFamily: fonts.semi, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ position: "absolute", left: 10, right: 10, bottom: bottom + 8, maxHeight: 420, borderRadius: 16, backgroundColor: "#0e0e11", borderWidth: 1, borderColor: "#2e2e38", padding: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15 }}>Queue</Text>
        {n > 0 && <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.yellow }}><Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 11 }}>{n}</Text></View>}
        <View style={{ flex: 1 }} />
        <Pressable onPress={collapseQueue} hitSlop={8} accessibilityLabel={n ? "Minimize" : "Close"}><Ionicons name={n ? "remove" : "close"} size={18} color={colors.muted} /></Pressable>
      </View>
      <ScrollView bounces={false}>
        {q.matched && <Text style={{ color: colors.gold, fontFamily: fonts.semi, fontSize: 13, marginBottom: 8 }}>● Matched — opening your room…</Text>}
        {p && !q.matched && (
          <View style={{ gap: 10, marginBottom: n > 0 ? 12 : 0 }}>
            {pf && <Text style={{ color: pf.color, fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.5 }}>{pf.label.toUpperCase()}</Text>}
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15, lineHeight: 20 }}>{p.question}</Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>
              {p.queueCount > 0 ? `${p.queueCount} waiting to talk${typeof p.proCount === "number" && typeof p.conCount === "number" ? ` · ${p.proCount} for · ${p.conCount} against` : ""} — you'd be matched right away` : "No one waiting yet — you'd be first in line"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>I'd argue</Text>
              {radio(stance === "PRO", "For", () => setStance("PRO"))}
              {radio(stance === "CON", "Against", () => setStance("CON"))}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>Match me with</Text>
              {radio(opponent === "anyone", "Anyone", () => setOpponent("anyone"))}
              {radio(opponent === "disagree", "Someone who disagrees", () => setOpponent("disagree"))}
            </View>
            <Pressable onPress={() => void joinQueue(stance, opponent)} disabled={q.busy} style={{ height: 42, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: p.queueCount > 0 ? colors.yellow : colors.blue, opacity: q.busy ? 0.6 : 1 }}>
              <Text style={{ color: p.queueCount > 0 ? colors.ink : "#fff", fontFamily: fonts.bold, fontSize: 13.5 }}>{q.busy ? "Joining…" : p.queueCount > 0 ? "Match now" : "Join the queue"}</Text>
            </Pressable>
            {q.error && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 12 }}>{q.error}</Text>}
          </View>
        )}
        {q.entries.map((e) => {
          const f = topicOf(e.topicKey);
          return (
            <View key={e.topicId} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: "#1c1c22" }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 13 }}>{e.question}</Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, marginTop: 2 }}>
                  <Text style={{ color: f.color }}>{f.label}</Text> · {e.stance === "PRO" ? "For" : "Against"}{e.opponent === "disagree" ? " · the other side only" : ""} · <Text style={{ color: colors.gold }}>●</Text> waiting {mmss(now - e.since)}
                </Text>
              </View>
              <Pressable onPress={() => void leaveQueue(e.topicId)} disabled={q.busy || !!q.matched} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#17171c", borderWidth: 1, borderColor: "#2e2e38" }}>
                <Text style={{ color: "#c9c9d2", fontFamily: fonts.semi, fontSize: 12 }}>Leave</Text>
              </Pressable>
            </View>
          );
        })}
        {n > 0 && !q.matched && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, marginTop: 8 }}>You'll be brought into the room the moment someone takes the other side. Keep browsing — this stays with you.</Text>}
      </ScrollView>
    </View>
  );
}
