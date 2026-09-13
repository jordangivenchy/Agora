/* Search, the way the site's panel does it (components/search/
   SearchPage.tsx): suggestions from search_suggest, results from
   search_all (visibility enforced inside, so it works signed out),
   recent searches from search_history when signed in and from storage
   otherwise. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostRow } from "./communities";
import type { SquareRoom } from "./roomCard";

export type SearchKind = "all" | "debate" | "post" | "comment" | "community" | "person";
export const SEARCH_TABS: { id: SearchKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "debate", label: "Discussions" },
  { id: "post", label: "Posts" },
  { id: "comment", label: "Comments" },
  { id: "community", label: "Communities" },
  { id: "person", label: "People" },
];
export const SEARCH_PAGE = 20;
export const INSTANT_LIMIT = 12;
const RECENT_KEY = "agora:recent-searches";
const RECENT_MAX = 8;

export type DebatePayload = SquareRoom & { created_at: string; ended_at: string | null; recording_url: string | null };
export type CommentPayload = {
  id: string; post_id: string; post_title: string; community_id: string; community_name: string;
  body: string; excerpt: string | null; created_at: string;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null } | null;
};
export type CommunityPayload = { id: string; name: string; description: string | null; avatar_url: string | null; color: string | null; is_private: boolean; members: number; joined: boolean };
export type PersonPayload = { id: string; username: string; display_name: string | null; avatar_url: string | null; verified: boolean; bio: string | null; is_following: boolean; followers: number };
export type SearchPost = PostRow & { author_avatar_url?: string | null; community_color?: string | null; community_avatar_url?: string | null };

export type SearchRow =
  | { kind: "debate"; id: string; rank: number; created_at: string; payload: DebatePayload }
  | { kind: "post"; id: string; rank: number; created_at: string; payload: SearchPost }
  | { kind: "comment"; id: string; rank: number; created_at: string; payload: CommentPayload }
  | { kind: "community"; id: string; rank: number; created_at: string; payload: CommunityPayload }
  | { kind: "person"; id: string; rank: number; created_at: string; payload: PersonPayload };

export type SuggestKind = "person" | "community" | "debate";
export type Suggest = { kind: SuggestKind; id: string; label: string; sublabel: string | null; avatar_url: string | null; href_hint: string | null };
export const KIND_LABEL: Record<SuggestKind, string> = { person: "Person", community: "Community", debate: "Discussion" };

export async function searchSuggest(supabase: SupabaseClient, q: string): Promise<Suggest[]> {
  const { data, error } = await supabase.rpc("search_suggest", { p_q: q, p_limit: 6 });
  if (error) return [];
  return (data ?? []) as Suggest[];
}

export type SearchStatus = "ok" | "warming" | "error";
export async function searchAll(supabase: SupabaseClient, q: string, kind: SearchKind, limit: number, offset: number): Promise<{ rows: SearchRow[]; status: SearchStatus }> {
  const { data, error } = await supabase.rpc("search_all", { p_q: q, p_kind: kind, p_limit: limit, p_offset: offset });
  if (error) {
    const m = error.message ?? "";
    return { rows: [], status: /does not exist|not find|schema cache|404/i.test(m) ? "warming" : "error" };
  }
  return { rows: (data ?? []) as SearchRow[], status: "ok" };
}

export async function readRecent(supabase: SupabaseClient, uid: string | null): Promise<string[]> {
  if (uid) {
    const { data, error } = await supabase.from("search_history").select("query").eq("user_id", uid).order("created_at", { ascending: false }).limit(40);
    if (!error) {
      const seen = new Set<string>();
      const list: string[] = [];
      for (const r of (data ?? []) as { query: string }[]) {
        const k = r.query.trim().toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        list.push(r.query.trim());
        if (list.length >= RECENT_MAX) break;
      }
      return list;
    }
  }
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export async function recordSearch(supabase: SupabaseClient, uid: string | null, q: string, prev: string[]): Promise<string[]> {
  const next = [q, ...prev.filter((p) => p.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
  if (uid) void supabase.from("search_history").insert({ user_id: uid, query: q }).then(() => undefined, () => undefined);
  else AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => undefined);
  return next;
}

export async function clearRecent(supabase: SupabaseClient, uid: string | null): Promise<void> {
  AsyncStorage.setItem(RECENT_KEY, "[]").catch(() => undefined);
  if (uid) await supabase.from("search_history").delete().eq("user_id", uid);
}

export async function removeRecent(supabase: SupabaseClient, uid: string | null, q: string, prev: string[]): Promise<string[]> {
  const next = prev.filter((p) => p !== q);
  AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => undefined);
  if (uid) await supabase.from("search_history").delete().eq("user_id", uid).eq("query", q);
  return next;
}

export async function fetchTrendingNow(supabase: SupabaseClient): Promise<SquareRoom[]> {
  const { data } = await supabase
    .from("debate_rooms")
    .select("id, motion, topic_key, status, format, scheduled_start, viewer_count, thumbnail_url, host:users!host_id(id, username, display_name, avatar_url)")
    .in("status", ["live", "scheduled"])
    .order("status", { ascending: true })
    .order("viewer_count", { ascending: false, nullsFirst: false })
    .limit(3);
  return ((data ?? []) as unknown as SquareRoom[]).map((r) => ({ ...r, community: null }));
}

/* Query-term highlighting (lib/highlight.ts): runs flagged as hits. */
export type Segment = { text: string; hit: boolean };
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of fold(query).split(/\s+/)) {
    const t = raw.replace(/[^\p{L}\p{N}]/gu, "");
    if (!t || t === "or" || t === "and" || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.sort((a, b) => b.length - a.length);
}

export function highlightSegments(text: string, query: string): Segment[] {
  const terms = queryTerms(query);
  if (!text) return [];
  if (terms.length === 0) return [{ text, hit: false }];
  const chars = Array.from(text);
  const folded = chars.map((c) => fold(c));
  const flat = folded.join("");
  const origIndex: number[] = [];
  folded.forEach((f, i) => { for (let k = 0; k < f.length; k++) origIndex.push(i); });
  const hits = new Array<boolean>(chars.length).fill(false);
  const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = flat.indexOf(term, from);
      if (at < 0) break;
      if (!isWordChar(flat[at - 1]) || term.length >= 3) for (let k = at; k < at + term.length; k++) hits[origIndex[k]] = true;
      from = at + 1;
    }
  }
  const segs: Segment[] = [];
  let cur = "";
  let curHit = hits[0];
  chars.forEach((c, i) => {
    if (hits[i] !== curHit) {
      if (cur) segs.push({ text: cur, hit: curHit });
      cur = "";
      curHit = hits[i];
    }
    cur += c;
  });
  if (cur) segs.push({ text: cur, hit: curHit });
  return segs;
}

export function excerptAround(text: string, query: string, radius = 90): string {
  const terms = queryTerms(query);
  const f = fold(text);
  let at = -1;
  for (const t of terms) {
    const i = f.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.length > radius * 2 ? text.slice(0, radius * 2).trimEnd() + "…" : text;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}
