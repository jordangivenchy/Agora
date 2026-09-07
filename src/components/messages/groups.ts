/* Group chats: shared types, phrasing, and the modal styles the group
   surfaces share. Rows come from get_group_threads / get_group_members
   (migration 20260893). */

import type { CSSProperties } from "react";
import { YELLOW, YELLOW_INK } from "./DmThread";

export interface GroupMember {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface GroupMemberRow extends GroupMember {
  joined_at: string;
  is_owner: boolean;
}

/* One group row from get_group_threads. `members` holds up to four
   profiles, other people first, for the avatar cluster. */
export interface GroupRow {
  chat_id: string;
  name: string;
  created_by: string;
  member_count: number;
  members: GroupMember[];
  last_content: string | null;
  last_image_url: string | null;
  last_kind: "text" | "system" | null;
  last_sender_id: string | null;
  last_sender_username: string | null;
  last_sender_name: string | null;
  last_from_me: boolean | null;
  last_at: string;
  unread: number;
}

export interface GroupMsg {
  id: string;
  chat_id: string;
  sender_id: string | null;
  kind: "text" | "system";
  content: string;
  image_url: string | null;
  reply_to: string | null;
  created_at: string;
}

export const GROUP_MSG_SELECT = "id, chat_id, sender_id, kind, content, image_url, reply_to, created_at";
export const GROUP_NAME_MAX = 60;

/* System rows are stored as the verb phrase ("added @red", "left"); the
   actor's name goes in front: "Jordan added @red", "You left". */
export function systemLine(content: string, actor: string): string {
  return `${actor} ${content}`;
}

/* Rail preview: "Jordan: hi" / "You: hi" / "Red added @chris" / "Photo". */
export function groupPreview(g: GroupRow): string {
  if (!g.last_kind) return "New group";
  const who = g.last_from_me
    ? "You"
    : (g.last_sender_name?.trim() || g.last_sender_username || "Someone");
  if (g.last_kind === "system") return `${who} ${g.last_content ?? ""}`.trim();
  const text = (g.last_content ?? "").trim();
  const body =
    text ||
    (g.last_image_url ? (/giphy\.com|\.gif(\?|$)/i.test(g.last_image_url) ? "GIF" : "Photo") : "");
  return `${who}: ${body}`;
}

/* Membership RPC errors → sentences. */
export function groupErrorText(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("not_friends")) return "You can only add friends — you both need to follow each other.";
  if (m.includes("need_members")) return "Pick at least one friend.";
  if (m.includes("bad_name")) return `Give the group a name (up to ${GROUP_NAME_MAX} characters).`;
  if (m.includes("too_many_members")) return "Groups top out at 50 people.";
  if (m.includes("group_rate_limit")) return "That's a lot of new groups — try again in a bit.";
  if (m.includes("owner_only")) return "Only the group's owner can do that.";
  if (m.includes("not_a_member")) return "You're not in this group any more.";
  if (m.includes("dm_rate_limited")) return "Slow down — max 20 messages a minute.";
  return m ? `Something went wrong — ${m}` : "Something went wrong — try again.";
}

/* ── Shared modal chrome (same solid card as the invite panel) ────── */
export const modalOverlay: CSSProperties = { background: "rgba(0,0,0,0.82)" };
export const modalCard: CSSProperties = {
  maxWidth: 440,
  background: "#000",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 20,
  padding: "20px 24px 22px",
  boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
  fontFamily: "'DM Sans', sans-serif",
};
export const modalTitle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "#f5f5f0",
  fontFamily: "'Space Grotesk', sans-serif",
};
export const modalClose: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  color: "rgba(238,238,245,0.6)",
  background: "#0b0b0d",
  border: "1px solid rgba(255,255,255,0.14)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
};
export const modalLabel: CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "rgba(255,255,255,0.4)",
  marginBottom: 8,
};
export const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 38,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "#0b0b0d",
  color: "white",
  fontSize: 13.5,
  padding: "0 12px",
  outline: "none",
  fontFamily: "inherit",
};
export const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 8px",
  borderRadius: 12,
  background: "#0b0b0d",
  border: "1px solid rgba(255,255,255,0.08)",
};
const pillBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  height: 32,
  padding: "0 14px",
  borderRadius: 999,
  fontSize: 12.5,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};
export const pillDark: CSSProperties = {
  ...pillBase,
  background: "#0b0b0d",
  border: "1px solid rgba(255,255,255,0.14)",
  color: "#c9c9d2",
};
export const pillYellow: CSSProperties = {
  ...pillBase,
  background: YELLOW,
  border: `1px solid ${YELLOW}`,
  color: YELLOW_INK,
};
export const pillQuiet: CSSProperties = {
  ...pillBase,
  background: "#0b0b0d",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "rgba(238,238,245,0.45)",
  cursor: "default",
};
export const errorNote: CSSProperties = {
  margin: 0,
  fontSize: 12,
  padding: "8px 10px",
  borderRadius: 10,
  background: "#1a0b0b",
  border: "1px solid rgba(255,120,120,0.3)",
  color: "#ff9d92",
  lineHeight: 1.45,
};
