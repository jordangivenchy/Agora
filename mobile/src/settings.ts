/* Settings, the way the site's page reads and writes them
   (lib/settingsData.ts, components/SettingsPage.tsx): the account's
   profile row, its user_settings row, its block list; the per-type
   notification and email preferences through the same RPCs. */
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

export interface SettingsData { profile: ProfileRow; settings: SettingsRow; blocked: BlockedUser[] }

export async function fetchSettings(supabase: SupabaseClient, user: User): Promise<SettingsData> {
  const [profRes, setRes, blockRes] = await Promise.all([
    supabase.from("users").select("id, username, display_name, avatar_url, bio, username_changed_at, created_at, is_moderator").eq("id", user.id).maybeSingle(),
    supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_blocks").select("blocked_id").eq("blocker_id", user.id),
  ]);
  if (profRes.error || !profRes.data) throw new Error(profRes.error?.message || "Profile not found");
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
    const { data } = await supabase.from("users").select("id, username, display_name, avatar_url").in("id", ids);
    blocked = (data ?? []) as BlockedUser[];
  }
  return { profile, settings, blocked };
}

export async function saveSettings(supabase: SupabaseClient, uid: string, settings: SettingsRow): Promise<string | null> {
  const { error } = await supabase.from("user_settings").upsert({ user_id: uid, ...settings }, { onConflict: "user_id" });
  return error ? "Couldn't save — check your connection and try again." : null;
}

/* The preferences catalogue: mirrors notification_types() in SQL. */
export type PrefGroup = { title: string; items: { type: string; label: string; sub: string }[] };

export const PREF_GROUPS: PrefGroup[] = [
  {
    title: "Discussions",
    items: [
      { type: "followed_live", label: "Someone you follow goes live", sub: "The moment their amphitheater opens" },
      { type: "followed_scheduled", label: "Someone you follow schedules a discussion", sub: "So you can set a reminder early" },
      { type: "room_live", label: "Reminders you set", sub: "When a discussion you asked about goes live" },
      { type: "room_starting_soon", label: "Starting soon", sub: "30 minutes before a discussion you set a reminder for" },
      { type: "room_invite", label: "Room invites", sub: "When a friend invites you to a room" },
      { type: "debate_replay_ready", label: "Replay ready", sub: "When a discussion you hosted or spoke in is recorded" },
      { type: "discussion_opened", label: "Discussion opened", sub: "When someone starts the thread on your conversation" },
      { type: "community_debate", label: "Community discussions", sub: "When a discussion starts in a community you joined" },
    ],
  },
  {
    title: "Community",
    items: [
      { type: "community_post", label: "Community posts", sub: "When someone posts in a community you've joined" },
      { type: "post_comment", label: "Comments on your posts", sub: "Grouped when several land at once" },
      { type: "post_reply", label: "Replies to your comments", sub: "When someone answers you in a thread" },
      { type: "post_upvotes", label: "Post milestones", sub: "When a post hits 5, 25 or 100 upvotes" },
      { type: "comment_upvotes", label: "Comment milestones", sub: "When a comment hits 5 or 25 upvotes" },
      { type: "repost", label: "Reposts", sub: "When someone shares your post to another community" },
      { type: "join_request", label: "Applications", sub: "When someone applies to a community you moderate" },
      { type: "join_approved", label: "Application approved", sub: "When a community you applied to lets you in" },
    ],
  },
  {
    title: "Social",
    items: [
      { type: "new_follower", label: "Friend requests", sub: "When someone wants to be your friend" },
      { type: "friend_accepted", label: "Accepted requests", sub: "When a request you sent is accepted" },
      { type: "mention", label: "Mentions", sub: "When someone @mentions you in a post or comment" },
    ],
  },
];

export type EmailPrefs = { types: Record<string, boolean>; digest: "off" | "weekly"; unsubscribed: boolean };

export type ConsentCategory = "analytics" | "debate_analysis" | "personalization" | "coaching";
export type Consent = Record<ConsentCategory, boolean>;
export const DEFAULT_CONSENT: Consent = { analytics: true, debate_analysis: true, personalization: true, coaching: true };
export const CONSENT_CATEGORIES: { key: ConsentCategory; title: string; blurb: string; ai?: boolean }[] = [
  { key: "analytics", title: "Activity analytics", blurb: "What you view, watch, like, and follow in the app — to personalize your feed." },
  { key: "debate_analysis", title: "In-discussion analysis", blurb: "Agora analyzes how you argue and the positions you express on stage, to build your profile and coaching. The listening indicator always shows when this is active.", ai: true },
  { key: "personalization", title: "Personalized recommendations", blurb: "Use your profile to rank rooms, topics, and people for you — with a visible reason for each.", ai: true },
  { key: "coaching", title: "Persona notes & coach", blurb: "Turn your profile into specific, constructive coaching on how you argue and learn.", ai: true },
];

export const MIN_PASSWORD_LENGTH = 6;
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return "Passwords don't match.";
  return null;
}
