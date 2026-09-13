/* Friends, as the site's panel reads them (components/friends/
   FriendsSection.tsx): mutual follows from get_friends, the pinned ones
   from user_favorites, the people who follow you back-less as "add
   back", and a name search to add more. */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Friend {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  since?: string | null;
}

export async function fetchFriends(supabase: SupabaseClient, uid: string): Promise<{ friends: Friend[]; favorites: Set<string>; followsMe: Friend[] }> {
  const [friendsRes, favRes, followersRes] = await Promise.all([
    supabase.rpc("get_friends"),
    supabase.from("user_favorites").select("favorite_id"),
    supabase.from("user_follows").select("follower:users!follower_id(id, username, display_name, avatar_url)").eq("following_id", uid),
  ]);
  const friends = (friendsRes.data ?? []) as Friend[];
  const ids = new Set(friends.map((f) => f.id));
  const followsMe = ((followersRes.data ?? []) as unknown as { follower: Friend | Friend[] | null }[])
    .map((r) => (Array.isArray(r.follower) ? r.follower[0] ?? null : r.follower))
    .filter((u): u is Friend => !!u && !ids.has(u.id));
  return {
    friends,
    favorites: new Set(((favRes.data ?? []) as { favorite_id: string }[]).map((f) => f.favorite_id)),
    followsMe,
  };
}

export async function searchPeople(supabase: SupabaseClient, q: string, me: string): Promise<Friend[]> {
  const { data } = await supabase.from("users").select("id, username, display_name, avatar_url").ilike("username", `${q}%`).neq("id", me).limit(8);
  return (data ?? []) as Friend[];
}

export async function setFavoriteFriend(supabase: SupabaseClient, uid: string, target: string, on: boolean): Promise<void> {
  const { error } = on
    ? await supabase.from("user_favorites").insert({ user_id: uid, favorite_id: target })
    : await supabase.from("user_favorites").delete().eq("user_id", uid).eq("favorite_id", target);
  if (error) throw new Error(error.message);
}
