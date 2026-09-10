/* The profile page's first view, fetched in one go: the header
   (get_user_profile, with the viewer's relationship to it) and the
   rooms of the default tab. The route (app/users/[username]/page.tsx)
   runs this on the server so the page arrives complete behind a single
   loading screen; ProfileView runs the same functions in the browser
   for reloads (after a follow, an edit) and for the in-room drawer. */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  username_changed_at: string | null;
  follower_count: number;
  following_count: number;
  is_following: boolean;
  is_friend: boolean;
  verified: boolean;
  /* Added by migration 20260843 — optional so the page tolerates a
     live get_user_profile that predates it. */
  banner_url?: string | null;
  social_links?: unknown;
  karma?: number | null;
  live_room_id?: string | null;
  live_room_motion?: string | null;
  mutual_names?: string[] | null;
}

export type DebateRow = {
  id: string;
  motion: string | null;
  topic_key: string | null;
  status: string;
  created_at: string;
  scheduled_start: string | null;
  viewer_count: number | null;
  thumbnail_url?: string | null;
  recording_url?: string | null;
  role: string;
  /** For rooms this user debated in (not hosted): who hosted them. */
  host_username?: string | null;
  host_display_name?: string | null;
  host_avatar_url?: string | null;
  host_id?: string | null;
};

/** What the route hands ProfileView so it renders at once. */
export type ProfileInitial = {
  /** null: no one by that name. */
  profile: Profile | null;
  viewerId: string | null;
  viewerIsMod: boolean;
  debates: DebateRow[] | null;
};

export async function fetchProfile(supabase: SupabaseClient, rawUsername: string): Promise<Profile | null> {
  const uname = decodeURIComponent(rawUsername);
  const { data: row } = await supabase.from("users").select("id").ilike("username", uname).maybeSingle();
  if (!row) return null;
  const { data } = await supabase.rpc("get_user_profile", { p_user: row.id });
  const p = Array.isArray(data) ? data[0] : data;
  return (p as Profile | null) ?? null;
}

/* Rooms this user hosted or debated in, newest first, with the hosts
   of the debated-in ones named so a row can say "hosted by @x". */
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
  for (const r of (hosted ?? []) as Omit<DebateRow, "role">[]) {
    seen.set(r.id, { ...r, role: "host" });
  }
  const hostIds = new Set<string>();
  for (const p of (parts ?? []) as unknown as {
    role: string;
    room: (Omit<DebateRow, "role"> & { host_id: string | null }) | null;
  }[]) {
    if (p.room && !seen.has(p.room.id)) {
      seen.set(p.room.id, { ...p.room, role: "debater" });
      if (p.room.host_id) hostIds.add(p.room.host_id);
    }
  }
  if (hostIds.size > 0) {
    const { data: hostRows } = await supabase
      .from("users")
      .select("id, username, display_name, avatar_url")
      .in("id", [...hostIds]);
    type HostRow = { id: string; username: string; display_name: string | null; avatar_url: string | null };
    const hosts = new Map((hostRows ?? []).map((h: HostRow) => [h.id, h]));
    for (const row of seen.values()) {
      const hid = (row as DebateRow & { host_id?: string | null }).host_id;
      if (row.role === "debater" && hid) {
        const h = hosts.get(hid);
        row.host_id = hid;
        row.host_username = h?.username ?? null;
        row.host_display_name = h?.display_name ?? null;
        row.host_avatar_url = h?.avatar_url ?? null;
      }
    }
  }
  return [...seen.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/* Everything the route needs, as the viewer. */
export async function fetchProfileInitial(supabase: SupabaseClient, rawUsername: string): Promise<ProfileInitial> {
  const [profile, { data: auth }] = await Promise.all([
    fetchProfile(supabase, rawUsername),
    supabase.auth.getUser(),
  ]);
  const viewerId = auth.user?.id ?? null;
  const [debates, me] = await Promise.all([
    profile ? fetchDebates(supabase, profile.id) : Promise.resolve(null),
    viewerId
      ? supabase.from("users").select("is_moderator").eq("id", viewerId).maybeSingle()
      : Promise.resolve({ data: null as { is_moderator?: boolean } | null }),
  ]);
  return { profile, viewerId, viewerIsMod: !!me.data?.is_moderator, debates };
}
