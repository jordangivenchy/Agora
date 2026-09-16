/* Past discussions, listed. The index at /replays reads this on the
   server so the page arrives as words rather than a loading state — it
   is the page strangers land on from a shared link, and the one search
   engines read. The phone's own list (mobile/src/replay.ts) wants the
   same rows; the shapes match on purpose. */

import type { SupabaseClient } from "@supabase/supabase-js";

/** The fields a discussion can belong to, in the order the page offers them. */
export const REPLAY_FIELDS: { key: string; label: string; color: string }[] = [
  { key: "politics-law", label: "Politics & Law", color: "#4a9eff" },
  { key: "politics-ethics", label: "Ethics", color: "#fd79a8" },
  { key: "economics", label: "Economics", color: "#00b894" },
  { key: "culture", label: "Culture", color: "#e056b8" },
  { key: "sports", label: "Sports", color: "#fd9644" },
  { key: "science-tech", label: "Science & Tech", color: "#00cec9" },
  { key: "foreign-policy", label: "Foreign Policy", color: "#1976D2" },
  { key: "philosophy", label: "Philosophy", color: "#fdcb6e" },
];

export const fieldLabel = (key: string | null): string =>
  REPLAY_FIELDS.find((f) => f.key === key)?.label ?? "";

export interface ReplayListItem {
  id: string;
  motion: string;
  topic_key: string | null;
  thumbnail_url: string | null;
  started_at: string | null;
  ended_at: string | null;
  replay_views: number | null;
  host: { username: string; display_name: string | null; avatar_url: string | null } | null;
}

/** One page of past discussions, newest first. Only rooms with something
    to watch: a listing of empty pages helps nobody. */
export async function fetchReplays(
  supabase: SupabaseClient,
  { field = null, limit = 24, offset = 0 }: { field?: string | null; limit?: number; offset?: number } = {},
): Promise<ReplayListItem[]> {
  let q = supabase
    .from("debate_rooms")
    .select("id, motion, topic_key, thumbnail_url, started_at, ended_at, replay_views, host:users!host_id(username, display_name, avatar_url)")
    .eq("status", "ended")
    .eq("is_private", false)
    .not("recording_url", "is", null)
    .order("ended_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);
  if (field) q = q.eq("topic_key", field);
  const { data } = await q;
  return ((data ?? []) as unknown as (Omit<ReplayListItem, "host"> & { host: ReplayListItem["host"] | ReplayListItem["host"][] })[]).map((r) => ({
    ...r,
    host: Array.isArray(r.host) ? r.host[0] ?? null : r.host,
  }));
}

/** How many there are, for the line under the title and the last page. */
export async function countReplays(supabase: SupabaseClient, field: string | null = null): Promise<number> {
  let q = supabase
    .from("debate_rooms")
    .select("id", { count: "exact", head: true })
    .eq("status", "ended")
    .eq("is_private", false)
    .not("recording_url", "is", null);
  if (field) q = q.eq("topic_key", field);
  const { count } = await q;
  return count ?? 0;
}
