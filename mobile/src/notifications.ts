/* Notifications, the site's rows and words (lib/notifications.ts):
   get_notifications keyset-paginated, one sentence per type, where a
   tap goes, the filters; mark read through the same RPCs. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IconName } from "./topics";

export type NotifRow = {
  id: string;
  type: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_display_name: string | null;
  actor_avatar_url: string | null;
  room_id: string | null;
  room_motion: string | null;
  room_status: string | null;
  room_scheduled_start: string | null;
  post_id: string | null;
  post_title: string | null;
  community_name: string | null;
  comment_id: string | null;
  comment_excerpt: string | null;
  meta: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

export type NotifFilter = "all" | "mentions" | "debates" | "posts";
export const NOTIF_FILTERS: { id: NotifFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mentions", label: "Mentions" },
  { id: "debates", label: "Discussions" },
  { id: "posts", label: "Posts" },
];
export const NOTIF_PAGE = 30;

const DEBATE_TYPES = new Set(["room_live", "room_starting_soon", "room_invite", "followed_live", "followed_scheduled", "debate_replay_ready", "discussion_opened", "community_debate"]);
const POST_TYPES = new Set(["community_post", "post_comment", "post_reply", "post_upvotes", "comment_upvotes", "repost", "join_request", "join_approved"]);
const MENTION_TYPES = new Set(["mention", "new_follower", "friend_accepted"]);

export function matchesFilter(type: string, filter: NotifFilter): boolean {
  if (filter === "all") return true;
  if (filter === "mentions") return MENTION_TYPES.has(type);
  if (filter === "debates") return DEBATE_TYPES.has(type);
  return POST_TYPES.has(type);
}

export function notifIcon(type: string): IconName {
  switch (type) {
    case "post_reply":
    case "post_comment": return "chatbubble-outline";
    case "post_upvotes":
    case "comment_upvotes": return "arrow-up-outline";
    case "repost": return "repeat-outline";
    case "followed_scheduled": return "calendar-outline";
    case "followed_live":
    case "room_live": return "flash-outline";
    case "debate_replay_ready": return "play-outline";
    case "discussion_opened": return "chatbox-outline";
    case "new_follower": return "person-outline";
    case "friend_accepted": return "people-outline";
    case "room_invite": return "paper-plane-outline";
    case "room_starting_soon": return "notifications-outline";
    case "community_post": return "pencil-outline";
    case "community_debate": return "business-outline";
    case "mention": return "at-outline";
    case "join_request": return "person-add-outline";
    case "join_approved": return "checkmark-outline";
    default: return "notifications-outline";
  }
}

export function actorLabel(n: Pick<NotifRow, "actor_display_name" | "actor_username">, fallback = "Someone"): string {
  return n.actor_display_name?.trim() || n.actor_username || fallback;
}

function metaCount(n: NotifRow): number {
  const c = n.meta?.count;
  return typeof c === "number" && c > 1 ? c : 1;
}
function metaMilestone(n: NotifRow): number | null {
  const m = n.meta?.milestone;
  return typeof m === "number" ? m : typeof m === "string" && /^\d+$/.test(m) ? Number(m) : null;
}
export function actorPhrase(n: NotifRow, fallback = "Someone"): string {
  const who = actorLabel(n, fallback);
  const others = metaCount(n) - 1;
  if (others <= 0) return who;
  return `${who} and ${others} ${others === 1 ? "other" : "others"}`;
}

export function formatScheduledStart(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  if (d.toDateString() === now.toDateString()) return `today ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
  const days = (d.getTime() - now.getTime()) / 86_400_000;
  if (days > 0 && days < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

const q = (s: string | null | undefined, fallback: string) => `“${s ?? fallback}”`;

export function notifText(n: NotifRow, now: Date = new Date()): string {
  const motion = q(n.room_motion, "a discussion");
  const post = q(n.post_title, "your post");
  switch (n.type) {
    case "new_follower": return `${actorLabel(n)} wants to be your friend`;
    case "friend_accepted": return `${actorLabel(n)} accepted your friend request — you're now friends`;
    case "room_live": return `${actorLabel(n, "A speaker")} is live: ${motion}`;
    case "followed_live": return `${actorLabel(n, "Someone you follow")} went live: ${motion}`;
    case "followed_scheduled": {
      const when = formatScheduledStart((n.meta?.scheduled_start as string | undefined) ?? n.room_scheduled_start, now);
      return `${actorLabel(n, "Someone you follow")} scheduled ${motion}${when ? ` for ${when}` : ""}`;
    }
    case "room_starting_soon": return `Starting soon: ${motion}`;
    case "room_invite": return `${actorLabel(n, "A friend")} invited you to ${q(n.room_motion, "their room")}`;
    case "debate_replay_ready": return `Replay of ${motion} is ready`;
    case "discussion_opened": return `${actorLabel(n)} started the discussion on ${motion}`;
    case "community_post": return `${actorLabel(n)} posted in ${n.community_name ?? "a community you joined"}: ${q(n.post_title, "a new thread")}`;
    case "community_debate": return `New discussion in ${n.community_name ?? "your community"}: ${motion}`;
    case "mention": return `${actorLabel(n)} mentioned you in ${q(n.post_title, "a thread")}`;
    case "post_comment": return `${actorPhrase(n)} commented on ${post}`;
    case "post_reply": return `${actorPhrase(n)} replied to your comment on ${post}`;
    case "repost": return `${actorPhrase(n)} reposted ${post}`;
    case "post_upvotes": return `Your post ${post} hit ${metaMilestone(n) ?? "a new"} upvotes`;
    case "comment_upvotes": return `Your comment on ${post} hit ${metaMilestone(n) ?? "a new"} upvotes`;
    case "join_request": return `${actorPhrase(n)} applied to join ${(n.meta?.community_name as string | undefined) ?? "your community"}`;
    case "join_approved": return `You're in — your application to ${(n.meta?.community_name as string | undefined) ?? "the community"} was approved`;
    default: return "New activity";
  }
}

export function notifDetail(n: NotifRow): string | null {
  if ((n.type === "post_comment" || n.type === "post_reply") && n.comment_excerpt && metaCount(n) === 1) return n.comment_excerpt;
  return null;
}

/** Where a tap goes in the app. Communities are named, not id'd, in the row; the screen resolves them. */
export type NotifTarget =
  | { kind: "post"; id: string }
  | { kind: "room"; id: string; ended: boolean }
  | { kind: "user"; username: string }
  | { kind: "community"; name: string }
  | null;

export function notifTarget(n: NotifRow): NotifTarget {
  switch (n.type) {
    case "post_comment":
    case "post_reply":
    case "comment_upvotes":
    case "post_upvotes":
    case "repost":
    case "community_post":
    case "mention":
      return n.post_id ? { kind: "post", id: n.post_id } : null;
    case "discussion_opened":
      if (n.post_id) return { kind: "post", id: n.post_id };
      return n.room_id ? { kind: "room", id: n.room_id, ended: n.room_status === "ended" } : null;
    case "room_live":
    case "followed_live":
    case "followed_scheduled":
    case "room_starting_soon":
    case "room_invite":
    case "community_debate":
    case "debate_replay_ready":
      return n.room_id ? { kind: "room", id: n.room_id, ended: n.room_status === "ended" || n.type === "debate_replay_ready" } : null;
    case "new_follower":
    case "friend_accepted":
      return n.actor_username ? { kind: "user", username: n.actor_username } : null;
    case "join_request":
    case "join_approved": {
      const name = n.meta?.community_name as string | undefined;
      return name ? { kind: "community", name } : null;
    }
    default:
      return null;
  }
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  if (now.getTime() - d.getTime() < 7 * 86_400_000) return "This week";
  return "Earlier";
}

export async function fetchNotifications(supabase: SupabaseClient, before: string | null, limit = NOTIF_PAGE): Promise<NotifRow[]> {
  const { data } = await supabase.rpc("get_notifications", { p_limit: limit, p_before: before });
  return (data ?? []) as NotifRow[];
}
export async function markRead(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.rpc("mark_notification_read", { p_id: id });
}
export async function markAllRead(supabase: SupabaseClient): Promise<void> {
  await supabase.rpc("mark_all_notifications_read");
}

/* The bell's count, kept fresh by realtime across the app. */
import { useEffect, useState } from "react";
import { supabase as client } from "./supabase";

let unreadCount = 0;
const listeners = new Set<(n: number) => void>();
let watching: string | null = null;
let channel: ReturnType<typeof client.channel> | null = null;

async function refreshUnread() {
  const rows = await fetchNotifications(client, null, NOTIF_PAGE);
  unreadCount = rows.filter((n) => !n.read_at).length;
  listeners.forEach((l) => l(unreadCount));
}

export function watchUnread(uid: string | null) {
  if (watching === uid) return;
  watching = uid;
  if (channel) { void client.removeChannel(channel); channel = null; }
  if (!uid) { unreadCount = 0; listeners.forEach((l) => l(0)); return; }
  void refreshUnread();
  channel = client
    .channel("notif-bell-app")
    .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, () => void refreshUnread())
    .subscribe();
}

export function bumpUnread() { void refreshUnread(); }

export function useUnread(): number {
  const [n, setN] = useState(unreadCount);
  useEffect(() => {
    listeners.add(setN);
    setN(unreadCount);
    return () => { listeners.delete(setN); };
  }, []);
  return n;
}
