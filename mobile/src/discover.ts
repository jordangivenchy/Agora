/* Explore and Trending, the way the website reads them (ExplorePage.tsx,
   TrendingPage.tsx, app/(chrome)/explore/page.tsx): rooms from the
   table under the viewer's row security, the figures from the same
   counts. News comes through fetchNews in home.ts. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Person } from "./home";

export interface ExploreRoom {
  id: string;
  motion: string;
  topic_key: string;
  status: string;
  format: string;
  language: string | null;
  scheduled_start: string | null;
  viewer_count: number | null;
  thumbnail_url: string | null;
  host: Person | Person[] | null;
  community: { id: string; name: string; color: string | null } | { id: string; name: string; color: string | null }[] | null;
}

export async function fetchExploreRooms(supabase: SupabaseClient): Promise<ExploreRoom[]> {
  const { data, error } = await supabase
    .from("debate_rooms")
    .select("id, motion, topic_key, status, format, language, scheduled_start, viewer_count, thumbnail_url, host:users!host_id(id, username, display_name, avatar_url), community:communities!community_id(id, name, color)")
    .in("status", ["live", "created", "scheduled"])
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ExploreRoom[];
}

export interface ExploreStats { activeRooms: number; members: number; watching: number }

export async function fetchExploreStats(supabase: SupabaseClient): Promise<ExploreStats> {
  const [{ count: activeRooms }, { count: members }, { data: live }] = await Promise.all([
    supabase.from("debate_rooms").select("id", { count: "exact", head: true }).in("status", ["live", "created", "scheduled"]),
    supabase.from("users").select("id", { count: "exact", head: true }),
    supabase.from("debate_rooms").select("viewer_count").eq("status", "live"),
  ]);
  const watching = ((live ?? []) as { viewer_count: number | null }[]).reduce((s, r) => s + (r.viewer_count ?? 0), 0);
  return { activeRooms: activeRooms ?? 0, members: members ?? 0, watching };
}

export interface TrendingRoom {
  id: string;
  motion: string;
  topic_key: string | null;
  viewer_count: number | null;
  replay_views: number | null;
  started_at: string | null;
  ended_at: string | null;
  status: string;
  created_at: string;
  thumbnail_url: string | null;
  recording_url: string | null;
  host: Person | Person[] | null;
}

/* Live first, then open lobbies, then replays; an unrecorded ended room
   is a dead end dressed as a video, so it stays out. */
export async function fetchTrendingRooms(supabase: SupabaseClient): Promise<TrendingRoom[]> {
  const { data, error } = await supabase
    .from("debate_rooms")
    .select("id, motion, topic_key, viewer_count, replay_views, status, created_at, started_at, ended_at, thumbnail_url, recording_url, host:users!host_id(id, username, display_name, avatar_url)")
    .in("status", ["live", "created", "ended"])
    .eq("is_private", false)
    .or("status.neq.ended,recording_url.not.is.null")
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw new Error(error.message);
  const rank = (s: string) => (s === "live" ? 0 : s === "created" ? 1 : 2);
  return ((data ?? []) as unknown as TrendingRoom[]).sort((a, b) => rank(a.status) - rank(b.status));
}

export const TRENDING_CHIPS: { label: string; key: string | null }[] = [
  { label: "All", key: null },
  { label: "Politics", key: "politics-law" },
  { label: "Economics", key: "economics" },
  { label: "Science & Tech", key: "science-tech" },
  { label: "Philosophy", key: "philosophy" },
  { label: "Culture", key: "culture" },
];

export const fmtCount = (n: number): string => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n));

export function agoDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)} week${days >= 14 ? "s" : ""} ago`;
}

export function roomDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (mins < 1) return null;
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/* NewsData timestamps arrive as "YYYY-MM-DD HH:MM:SS" in UTC. */
export function newsTimeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return "";
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function outletIcon(domain: string, size = 64): string {
  const d = domain.trim().toLowerCase().replace(/^www\./, "");
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=${size}`;
}

/* NewsData categories → our fields (world desk → Foreign Policy), as the site maps them. */
export function topicFor(category: string | null | undefined): string {
  switch (category) {
    case "politics": return "politics-law";
    case "business": return "economics";
    case "science":
    case "technology": return "science-tech";
    case "sports": return "sports";
    case "entertainment": return "culture";
    default: return "foreign-policy";
  }
}
