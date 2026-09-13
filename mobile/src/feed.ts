/* Your feed, from the site's ranked stream (get_home_feed): live and
   scheduled rooms, replays, posts, reposts and comments from the people
   you follow and the communities you're in; who to follow from the
   same suggestions. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostRow } from "./communities";
import type { Person } from "./home";

export type FeedFilter = "all" | "following" | "communities" | "popular";
export const FEED_FILTERS: { id: FeedFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "following", label: "Following" },
  { id: "communities", label: "My communities" },
  { id: "popular", label: "Popular" },
];
export const FEED_PAGE = 30;

export interface FeedRoom {
  id: string;
  motion: string;
  topic_key: string;
  status: string;
  format: string;
  scheduled_start: string | null;
  viewer_count: number | null;
  thumbnail_url: string | null;
  recording_url: string | null;
  host: (Person & { id: string }) | null;
  community: { id: string; name: string; color: string | null } | null;
  speakers: number;
  reminder_count: number;
  am_set: boolean;
  created_at: string;
}
export type FeedPost = PostRow & { author_avatar_url?: string | null; community_color?: string | null; community_avatar_url?: string | null };
export interface FeedComment {
  id: string;
  post_id: string;
  post_title: string;
  body: string;
  created_at: string;
  community_name: string;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null };
}
export type FeedItem =
  | { kind: "live" | "scheduled" | "replay"; item_id: string; score: number; created_at: string; reason: string; payload: FeedRoom }
  | { kind: "post" | "repost"; item_id: string; score: number; created_at: string; reason: string; payload: FeedPost }
  | { kind: "comment"; item_id: string; score: number; created_at: string; reason: string; payload: FeedComment };

export async function fetchFeed(supabase: SupabaseClient, filter: FeedFilter, before: string | null): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc("get_home_feed", { p_filter: filter, p_limit: FEED_PAGE, p_before: before });
  if (error) throw new Error(error.message.includes("does not exist") ? "The feed isn't set up on this database yet." : "Couldn't load your feed — try again.");
  return (data ?? []) as FeedItem[];
}

export interface Suggestion {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  verified: boolean;
  reason: string;
  mutual_count: number;
  debates_30d: number;
}
export async function fetchSuggestions(supabase: SupabaseClient, limit = 8): Promise<Suggestion[]> {
  const { data, error } = await supabase.rpc("get_people_suggestions", { p_limit: limit });
  if (error) return [];
  return (data ?? []) as Suggestion[];
}

/* "in 25 min", "in 3h · 7:00 PM", "Sat, Sep 13, 7:00 PM". */
export function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hours = (d.getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return "starting now";
  if (hours < 1) return `in ${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `in ${Math.round(hours)}h · ` + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
