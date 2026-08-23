/* Notification rendering — one place that knows every type's icon, copy,
   and destination. Shared by the bell dropdown and /notifications, and
   pure so the copy is unit-tested. Rows come from get_notifications()
   (20260852_notifications_v2.sql). */

import type { IconName } from "@/components/icons";
import { pathFor } from "@/lib/routes";
import { roomPath } from "@/lib/urls";
import { displayName } from "@/lib/names";

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

export const DEBATE_TYPES = new Set([
  "room_live", "room_starting_soon", "room_invite", "followed_live", "followed_scheduled",
  "debate_replay_ready", "discussion_opened", "community_debate",
]);
export const POST_TYPES = new Set([
  "community_post", "post_comment", "post_reply", "post_upvotes", "comment_upvotes", "repost",
]);
export const MENTION_TYPES = new Set(["mention", "new_follower", "friend_accepted"]);

export function matchesFilter(type: string, filter: NotifFilter): boolean {
  if (filter === "all") return true;
  if (filter === "mentions") return MENTION_TYPES.has(type);
  if (filter === "debates") return DEBATE_TYPES.has(type);
  return POST_TYPES.has(type);
}

export function notifIcon(type: string): IconName {
  switch (type) {
    case "post_reply":
    case "post_comment": return "message-circle";
    case "post_upvotes":
    case "comment_upvotes": return "arrow-up";
    case "repost": return "repeat";
    case "followed_scheduled": return "calendar";
    case "followed_live":
    case "room_live": return "zap";
    case "debate_replay_ready": return "play";
    case "discussion_opened": return "message-square";
    case "new_follower": return "user";
    case "friend_accepted": return "handshake";
    case "room_invite": return "send";
    case "room_starting_soon": return "bell";
    case "community_post": return "pencil";
    case "community_debate": return "landmark";
    case "mention": return "at-sign";
    default: return "bell";
  }
}

/* Actor label: "@handle" when that's all we have, the display name
   otherwise — the bell's existing convention. */
export function actorLabel(n: Pick<NotifRow, "actor_display_name" | "actor_username">, fallback = "Someone"): string {
  return displayName({ display_name: n.actor_display_name, username: n.actor_username }) || fallback;
}

function metaCount(n: NotifRow): number {
  const c = n.meta?.count;
  return typeof c === "number" && c > 1 ? c : 1;
}

function metaMilestone(n: NotifRow): number | null {
  const m = n.meta?.milestone;
  return typeof m === "number" ? m : typeof m === "string" && /^\d+$/.test(m) ? Number(m) : null;
}

/* "@x", "@x and 1 other", "@x and 4 others" — from the coalesced count. */
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
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `today ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
  const days = (d.getTime() - now.getTime()) / 86_400_000;
  if (days > 0 && days < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

const q = (s: string | null | undefined, fallback: string) => `“${s ?? fallback}”`;

/** Plain-text sentence for a notification (also used for OS/push bodies). */
export function notifText(n: NotifRow, now: Date = new Date()): string {
  const motion = q(n.room_motion, "a debate");
  const post = q(n.post_title, "your post");
  switch (n.type) {
    case "new_follower":
      return `${actorLabel(n)} wants to be your friend`;
    case "friend_accepted":
      return `${actorLabel(n)} accepted your friend request — you're now friends`;
    case "room_live":
      return `${actorLabel(n, "A speaker")} is live: ${motion}`;
    case "followed_live":
      return `${actorLabel(n, "Someone you follow")} went live: ${motion}`;
    case "followed_scheduled": {
      const when = formatScheduledStart(
        (n.meta?.scheduled_start as string | undefined) ?? n.room_scheduled_start, now);
      return `${actorLabel(n, "Someone you follow")} scheduled ${motion}${when ? ` for ${when}` : ""}`;
    }
    case "room_starting_soon":
      return `Starting soon: ${motion}`;
    case "room_invite":
      return `${actorLabel(n, "A friend")} invited you to ${q(n.room_motion, "their room")}`;
    case "debate_replay_ready":
      return `Replay of ${motion} is ready`;
    case "discussion_opened":
      return `${actorLabel(n)} started the discussion on ${motion}`;
    case "community_post":
      return `${actorLabel(n)} posted in ${n.community_name ?? "a community you joined"}: ${q(n.post_title, "a new thread")}`;
    case "community_debate":
      return `New debate in ${n.community_name ?? "your community"}: ${motion}`;
    case "mention":
      return `${actorLabel(n)} mentioned you in ${q(n.post_title, "a thread")}`;
    case "post_comment":
      return `${actorPhrase(n)} commented on ${post}`;
    case "post_reply":
      return `${actorPhrase(n)} replied to your comment on ${post}`;
    case "repost":
      return `${actorPhrase(n)} reposted ${post}`;
    case "post_upvotes": {
      const m = metaMilestone(n);
      return `Your post ${post} hit ${m ?? "a new"} upvotes`;
    }
    case "comment_upvotes": {
      const m = metaMilestone(n);
      return `Your comment on ${post} hit ${m ?? "a new"} upvotes`;
    }
    default:
      return "New activity";
  }
}

/** Secondary line under the sentence, when there's something worth quoting. */
export function notifDetail(n: NotifRow): string | null {
  if ((n.type === "post_comment" || n.type === "post_reply") && n.comment_excerpt && metaCount(n) === 1) {
    return n.comment_excerpt;
  }
  return null;
}

/** Where a click goes. Rooms use the same pretty URL live or ended
    (amphitheater vs replay is decided by the room page). */
export function notifHref(n: NotifRow): string | null {
  switch (n.type) {
    case "post_comment":
    case "post_reply": {
      const replyId = typeof n.meta?.reply_id === "string" ? (n.meta.reply_id as string) : n.comment_id;
      return n.post_id ? pathFor.post(n.post_id, metaCount(n) === 1 ? replyId : null) : null;
    }
    case "comment_upvotes":
      return n.post_id ? pathFor.post(n.post_id, n.comment_id) : null;
    case "post_upvotes":
    case "repost":
    case "community_post":
    case "mention":
      return n.post_id ? pathFor.post(n.post_id) : null;
    case "discussion_opened":
      if (n.post_id) return pathFor.post(n.post_id);
      return n.room_id ? roomPath({ id: n.room_id, motion: n.room_motion }) : null;
    case "room_live":
    case "followed_live":
    case "followed_scheduled":
    case "room_starting_soon":
    case "room_invite":
    case "community_debate":
    case "debate_replay_ready":
      return n.room_id ? roomPath({ id: n.room_id, motion: n.room_motion }) : null;
    case "new_follower":
    case "friend_accepted":
      return n.actor_id ? `/?profile=${n.actor_id}` : null;
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

/* Preferences UI catalogue — mirrors notification_types() in SQL. */
export type PrefGroup = { title: string; items: { type: string; label: string; sub: string }[] };

export const PREF_GROUPS: PrefGroup[] = [
  {
    title: "Debates",
    items: [
      { type: "followed_live", label: "Someone you follow goes live", sub: "The moment their amphitheater opens" },
      { type: "followed_scheduled", label: "Someone you follow schedules a debate", sub: "So you can set a reminder early" },
      { type: "room_live", label: "Reminders you set", sub: "When a debate you asked about goes live" },
      { type: "room_starting_soon", label: "Starting soon", sub: "30 minutes before a debate you set a reminder for" },
      { type: "room_invite", label: "Room invites", sub: "When a friend invites you to a room" },
      { type: "debate_replay_ready", label: "Replay ready", sub: "When a debate you hosted or spoke in is recorded" },
      { type: "discussion_opened", label: "Discussion opened", sub: "When someone starts the thread on your debate" },
      { type: "community_debate", label: "Community debates", sub: "When a debate starts in a community you joined" },
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
