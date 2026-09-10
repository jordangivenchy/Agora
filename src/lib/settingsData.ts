/* The settings page's first view — the account, its profile row, its
   settings and its block list — fetched by the route on the server so
   the page arrives complete behind its loading screen. SettingsPage
   starts from it and refreshes in the browser as before (the same
   function, the same shapes). */

import type { SupabaseClient, User } from "@supabase/supabase-js";

export type SettingsRow = {
  join_muted: boolean;
  join_camera_off: boolean;
  record_debates: boolean;
  reduce_motion: boolean;
  show_debate_history: boolean;
  notify_follows: boolean;
  notify_room_live: boolean;
  notify_community_posts: boolean;
};

export const DEFAULT_SETTINGS: SettingsRow = {
  join_muted: false,
  join_camera_off: false,
  record_debates: true,
  reduce_motion: false,
  show_debate_history: true,
  notify_follows: true,
  notify_room_live: true,
  notify_community_posts: true,
};

export type ProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  email: string;
  username_changed_at: string | null;
  created_at: string;
  is_moderator: boolean;
};

export type BlockedUser = { id: string; username: string; display_name?: string | null; avatar_url: string | null };

export type SettingsInitial =
  | { status: "login" }
  | { status: "error"; message: string }
  | { status: "ok"; authUser: User; profile: ProfileRow; settings: SettingsRow; blocked: BlockedUser[] };

export async function fetchSettingsInitial(supabase: SupabaseClient): Promise<SettingsInitial> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { status: "login" };

  const [profRes, setRes, blockRes] = await Promise.all([
    supabase.from("users")
      .select("id, username, display_name, avatar_url, bio, username_changed_at, created_at, is_moderator")
      .eq("id", user.id).maybeSingle(),
    supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_blocks").select("blocked_id").eq("blocker_id", user.id),
  ]);
  if (profRes.error || !profRes.data) return { status: "error", message: profRes.error?.message || "Profile not found" };
  // users.email is not client-readable (column grants); the auth user is
  // the authoritative source for the account email anyway.
  const profile: ProfileRow = { ...(profRes.data as Omit<ProfileRow, "email">), email: user.email ?? "" };

  let settings = DEFAULT_SETTINGS;
  if (setRes.data) {
    const r = setRes.data as SettingsRow & Record<string, unknown>;
    settings = {
      join_muted: r.join_muted,
      join_camera_off: r.join_camera_off,
      record_debates: (r.record_debates as boolean | undefined) ?? true,
      reduce_motion: r.reduce_motion,
      show_debate_history: r.show_debate_history,
      notify_follows: r.notify_follows ?? true,
      notify_room_live: r.notify_room_live ?? true,
      notify_community_posts: (r.notify_community_posts as boolean | undefined) ?? true,
    };
  }

  const ids = (blockRes.data ?? []).map((b: { blocked_id: string }) => b.blocked_id);
  let blocked: BlockedUser[] = [];
  if (ids.length) {
    const { data: blockedUsers } = await supabase
      .from("users").select("id, username, display_name, avatar_url").in("id", ids);
    blocked = (blockedUsers ?? []) as BlockedUser[];
  }
  return { status: "ok", authUser: user, profile, settings, blocked };
}
