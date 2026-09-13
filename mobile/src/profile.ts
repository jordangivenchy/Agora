/* A person's page, the way the website reads it (lib/profileData.ts,
   components/ProfileView.tsx): the header from get_user_profile with
   the viewer's relationship, their rooms from the tables, their posts,
   comments and communities from the same RPCs, follow through the same
   calls. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostRow } from "./communities";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  follower_count: number;
  following_count: number;
  is_following: boolean;
  is_followed_by: boolean;
  is_friend: boolean;
  verified: boolean;
  banner_url: string | null;
  karma: number | null;
  live_room_id: string | null;
  live_room_motion: string | null;
  mutual_names: string[] | null;
}

export async function fetchProfile(supabase: SupabaseClient, username: string): Promise<Profile | null> {
  const { data: row } = await supabase.from("users").select("id").ilike("username", username).maybeSingle();
  if (!row) return null;
  return fetchProfileById(supabase, (row as { id: string }).id);
}

export async function fetchProfileById(supabase: SupabaseClient, id: string): Promise<Profile | null> {
  const { data, error } = await supabase.rpc("get_user_profile", { p_user: id });
  if (error) throw new Error(error.message);
  const p = Array.isArray(data) ? data[0] : data;
  return (p as Profile | undefined) ?? null;
}

export async function setFollowing(supabase: SupabaseClient, target: string, follow: boolean): Promise<void> {
  const { error } = await supabase.rpc(follow ? "follow_user" : "unfollow_user", { p_target: target });
  if (error) throw new Error(error.message);
}

/* Rooms this person hosted or debated in, newest first. */
export interface DebateRow {
  id: string;
  motion: string | null;
  topic_key: string | null;
  status: string;
  created_at: string;
  scheduled_start: string | null;
  viewer_count: number | null;
  thumbnail_url: string | null;
  recording_url: string | null;
  role: "host" | "debater";
  host_id?: string | null;
  host_username?: string | null;
  host_display_name?: string | null;
  host_avatar_url?: string | null;
}
type HostedRow = Omit<DebateRow, "role">;

export async function fetchDebates(supabase: SupabaseClient, uid: string): Promise<DebateRow[]> {
  const [{ data: parts }, { data: hosted }] = await Promise.all([
    supabase
      .from("debate_participants")
      .select("role, room:debate_rooms(id, motion, topic_key, status, created_at, scheduled_start, viewer_count, thumbnail_url, recording_url, host_id)")
      .eq("user_id", uid)
      .eq("role", "debater"),
    supabase
      .from("debate_rooms")
      .select("id, motion, topic_key, status, created_at, scheduled_start, viewer_count, thumbnail_url, recording_url")
      .eq("host_id", uid)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  const seen = new Map<string, DebateRow>();
  for (const r of (hosted ?? []) as HostedRow[]) seen.set(r.id, { ...r, role: "host" });
  const hostIds = new Set<string>();
  for (const p of (parts ?? []) as unknown as { role: string; room: (HostedRow & { host_id: string | null }) | (HostedRow & { host_id: string | null })[] | null }[]) {
    const room = Array.isArray(p.room) ? p.room[0] : p.room;
    if (room && !seen.has(room.id)) {
      seen.set(room.id, { ...room, role: "debater" });
      if (room.host_id) hostIds.add(room.host_id);
    }
  }
  if (hostIds.size) {
    const { data: hostRows } = await supabase.from("users").select("id, username, display_name, avatar_url").in("id", [...hostIds]);
    const hosts = new Map(((hostRows ?? []) as { id: string; username: string; display_name: string | null; avatar_url: string | null }[]).map((h) => [h.id, h]));
    for (const row of seen.values()) {
      if (row.role === "debater" && row.host_id) {
        const h = hosts.get(row.host_id);
        row.host_username = h?.username ?? null;
        row.host_display_name = h?.display_name ?? null;
        row.host_avatar_url = h?.avatar_url ?? null;
      }
    }
  }
  return [...seen.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function fetchUserPosts(supabase: SupabaseClient, uid: string): Promise<PostRow[]> {
  const { data, error } = await supabase.rpc("get_community_posts", { p_community: null, p_sort: "new", p_limit: 60, p_author: uid });
  if (error) throw new Error(error.message);
  return (data ?? []) as PostRow[];
}

export interface UserComment {
  id: string;
  body: string;
  image_url: string | null;
  created_at: string;
  score: number;
  post_id: string;
  post_title: string;
  community_id: string;
  community_name: string;
}
export async function fetchUserComments(supabase: SupabaseClient, uid: string): Promise<UserComment[]> {
  const { data, error } = await supabase.rpc("get_user_comments", { p_author: uid, p_limit: 30, p_offset: 0 });
  if (error) return [];
  return (data ?? []) as UserComment[];
}

export interface UserCommunity { id: string; name: string; color: string | null; avatar_url: string | null; role: string; member_count: number }
export async function fetchUserCommunities(supabase: SupabaseClient, uid: string): Promise<UserCommunity[]> {
  const { data, error } = await supabase.rpc("get_user_communities", { p_user: uid });
  if (error) return [];
  return (data ?? []) as UserCommunity[];
}
