/* Server-side helpers shared by the email cron routes: which types email
   by default (mirrors email_default_types() in 20260854), the unsubscribe
   token (mirrors email_unsub_token(): HMAC-SHA256 of the user id keyed by
   reminder_webhook_secret), and the raw-row → NotifRow adapter so the cron
   can reuse notifText / notifHref. */

import { createHmac } from "node:crypto";
import type { NotifRow } from "@/lib/notifications";

export const EMAIL_DEFAULT_TYPES = new Set([
  "followed_live", "followed_scheduled", "room_invite", "mention",
  "post_reply", "debate_replay_ready", "friend_accepted",
]);

export type EmailSettings = {
  email_prefs: Record<string, boolean> | null;
  email_digest: string | null;
  email_unsubscribed_at: string | null;
  last_digest_at: string | null;
};

export function emailEnabledFor(settings: EmailSettings | undefined, type: string): boolean {
  const explicit = settings?.email_prefs?.[type];
  if (typeof explicit === "boolean") return explicit;
  return EMAIL_DEFAULT_TYPES.has(type);
}

export function unsubToken(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex");
}

export function unsubUrl(origin: string, userId: string, secret: string): string {
  return `${origin}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubToken(userId, secret)}`;
}

/* Shape returned by the cron's joined select over notifications. */
export type RawNotif = {
  id: string;
  user_id: string;
  type: string;
  actor_id: string | null;
  room_id: string | null;
  post_id: string | null;
  comment_id: string | null;
  meta: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
  actor: { username: string; display_name: string | null; avatar_url: string | null } | null;
  room: { motion: string; status: string; scheduled_start: string | null; community: { name: string } | null } | null;
  post: { title: string | null; community: { name: string } | null } | null;
  comment: { body: string | null } | null;
};

export const RAW_NOTIF_SELECT =
  "id, user_id, type, actor_id, room_id, post_id, comment_id, meta, read_at, created_at, " +
  "actor:users!notifications_actor_id_fkey(username, display_name, avatar_url), " +
  "room:debate_rooms(motion, status, scheduled_start, community:communities(name)), " +
  "post:community_posts(title, community:communities(name)), " +
  "comment:community_comments(body)";

export function toNotifRow(r: RawNotif): NotifRow {
  const excerpt = typeof r.meta?.excerpt === "string" ? (r.meta.excerpt as string) : null;
  return {
    id: r.id,
    type: r.type,
    actor_id: r.actor_id,
    actor_username: r.actor?.username ?? null,
    actor_display_name: r.actor?.display_name ?? null,
    actor_avatar_url: r.actor?.avatar_url ?? null,
    room_id: r.room_id,
    room_motion: r.room?.motion ?? null,
    room_status: r.room?.status ?? null,
    room_scheduled_start: r.room?.scheduled_start ?? null,
    post_id: r.post_id,
    post_title: r.post?.title ?? null,
    community_name: r.post?.community?.name ?? r.room?.community?.name ?? null,
    comment_id: r.comment_id,
    comment_excerpt: excerpt ?? (r.comment?.body ? r.comment.body.slice(0, 140) : null),
    meta: r.meta,
    read_at: r.read_at,
    created_at: r.created_at,
  };
}
