/* Messages, the site's rows and calls (components/messages/*): direct
   messages and group chats from the same tables and RPCs, so the app
   and the site read the same conversations. */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Dm {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  image_url: string | null;
  created_at: string;
  reply_to: string | null;
  read_at: string | null;
  community_id?: string | null;
}
export interface Peer { id: string; username: string; display_name?: string | null; avatar_url: string | null }
export interface Thread {
  peer_id: string; peer_username: string; peer_display_name: string | null; peer_avatar_url: string | null;
  last_content: string; last_at: string; last_from_me: boolean; unread: number;
}
export interface GroupMember { id: string; username: string; display_name: string | null; avatar_url: string | null }
export interface GroupMemberRow extends GroupMember { joined_at: string; is_owner: boolean }
export interface GroupRow {
  chat_id: string; name: string; created_by: string; member_count: number; members: GroupMember[];
  last_content: string | null; last_image_url: string | null; last_kind: "text" | "system" | null;
  last_sender_id: string | null; last_sender_username: string | null; last_sender_name: string | null;
  last_from_me: boolean | null; last_at: string; unread: number;
}
export interface GroupMsg { id: string; chat_id: string; sender_id: string | null; kind: "text" | "system"; content: string; image_url: string | null; reply_to: string | null; created_at: string }
export interface Reaction { user_id: string; emoji: string }

export const DM_SELECT = "id, sender_id, recipient_id, content, image_url, created_at, reply_to, read_at, community_id";
export const GROUP_MSG_SELECT = "id, chat_id, sender_id, kind, content, image_url, reply_to, created_at";
export const UNSEND_WINDOW_MS = 2 * 60 * 1000;
export const GROUP_NAME_MAX = 60;
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

export const displayName = (u: { display_name?: string | null; username?: string | null } | null | undefined) => u?.display_name?.trim() || u?.username || "";

export function relTime(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const isGif = (url: string) => /giphy\.com/i.test(url) || /\.gif(\?|$)/i.test(url);
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
export const systemLine = (content: string, actor: string) => `${actor} ${content}`;
export function groupPreview(g: GroupRow): string {
  if (!g.last_kind) return "New group";
  const who = g.last_from_me ? "You" : g.last_sender_name?.trim() || g.last_sender_username || "Someone";
  if (g.last_kind === "system") return `${who} ${g.last_content ?? ""}`.trim();
  const text = (g.last_content ?? "").trim();
  const body = text || (g.last_image_url ? (isGif(g.last_image_url) ? "GIF" : "Photo") : "");
  return `${who}: ${body}`;
}
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

/* ── The inbox ── */
export async function fetchThreads(supabase: SupabaseClient): Promise<Thread[]> {
  const { data } = await supabase.rpc("get_dm_threads");
  return (data ?? []) as Thread[];
}
export async function fetchGroups(supabase: SupabaseClient): Promise<GroupRow[]> {
  const { data } = await supabase.rpc("get_group_threads");
  return (data ?? []) as GroupRow[];
}
export async function resolvePeer(supabase: SupabaseClient, username: string): Promise<Peer | null> {
  const { data } = await supabase.from("users").select("id, username, display_name, avatar_url").ilike("username", username.replace(/[\\%_]/g, "\\$&")).maybeSingle();
  return (data as Peer | null) ?? null;
}

/* ── Direct messages ── */
export async function fetchDms(supabase: SupabaseClient, peerId: string): Promise<Dm[]> {
  const { data } = await supabase.from("direct_messages").select(DM_SELECT).or(`sender_id.eq.${peerId},recipient_id.eq.${peerId}`).order("created_at", { ascending: true }).limit(200);
  return (data ?? []) as Dm[];
}
export async function fetchDmReactions(supabase: SupabaseClient, ids: string[]): Promise<Map<string, Reaction[]>> {
  const map = new Map<string, Reaction[]>();
  if (!ids.length) return map;
  const { data } = await supabase.from("dm_reactions").select("message_id, user_id, emoji").in("message_id", ids);
  for (const r of (data ?? []) as (Reaction & { message_id: string })[]) {
    const list = map.get(r.message_id) ?? [];
    list.push({ user_id: r.user_id, emoji: r.emoji });
    map.set(r.message_id, list);
  }
  return map;
}
export const markDmRead = (supabase: SupabaseClient, peerId: string) => supabase.rpc("mark_dm_read", { p_peer: peerId });
export async function sendDm(supabase: SupabaseClient, me: string, peerId: string, text: string, imageUrl: string | null, replyTo: string | null): Promise<{ dm?: Dm; error?: string }> {
  const { data, error } = await supabase.from("direct_messages").insert({ sender_id: me, recipient_id: peerId, content: text, image_url: imageUrl, reply_to: replyTo }).select(DM_SELECT).single();
  if (error) return { error: error.code === "42501" ? "You can only message friends — you both need to follow each other." : `Couldn't send — ${error.message || "try again."}` };
  return { dm: data as Dm };
}
export async function setDmReaction(supabase: SupabaseClient, me: string, messageId: string, emoji: string, on: boolean): Promise<boolean> {
  const { error } = on
    ? await supabase.from("dm_reactions").insert({ message_id: messageId, user_id: me, emoji })
    : await supabase.from("dm_reactions").delete().match({ message_id: messageId, user_id: me, emoji });
  return !error;
}
export async function unsendDm(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await supabase.from("direct_messages").delete().eq("id", id).select("id");
  return !!data && data.length > 0;
}
export const dmDeleteForMe = (supabase: SupabaseClient, id: string) => supabase.rpc("dm_delete_for_me", { p_id: id });
export const dmDeleteThread = (supabase: SupabaseClient, peerId: string) => supabase.rpc("dm_delete_thread_for_me", { p_peer: peerId });

/* Community invites riding on a message. */
export interface InviteMeta { name: string; color: string | null; avatar_url: string | null; is_private: boolean; description: string | null; kind: string; members: number; joined: boolean }
export async function fetchInviteMeta(supabase: SupabaseClient, me: string, ids: string[]): Promise<Map<string, InviteMeta>> {
  const out = new Map<string, InviteMeta>();
  if (!ids.length) return out;
  const [{ data: boards }, { data: mine }, counts] = await Promise.all([
    supabase.from("communities").select("id, name, color, avatar_url, is_private, description, kind").in("id", ids),
    supabase.from("community_members").select("community_id").eq("user_id", me).in("community_id", ids),
    Promise.all(ids.map((id) => supabase.from("community_members").select("community_id", { count: "exact", head: true }).eq("community_id", id).then(({ count }) => [id, count ?? 0] as const))),
  ]);
  const joined = new Set(((mine ?? []) as { community_id: string }[]).map((r) => r.community_id));
  const members = new Map(counts);
  for (const b of (boards ?? []) as { id: string; name: string; color: string | null; avatar_url: string | null; is_private: boolean; description: string | null; kind: string }[]) {
    out.set(b.id, { name: b.name, color: b.color, avatar_url: b.avatar_url, is_private: b.is_private, description: b.description, kind: b.kind, members: members.get(b.id) ?? 0, joined: joined.has(b.id) });
  }
  return out;
}
export const acceptInvite = (supabase: SupabaseClient, communityId: string) => supabase.rpc("accept_community_invite", { p_community: communityId });

/* ── Groups ── */
export async function fetchGroupMessages(supabase: SupabaseClient, chatId: string): Promise<GroupMsg[]> {
  const { data } = await supabase.from("group_messages").select(GROUP_MSG_SELECT).eq("chat_id", chatId).order("created_at", { ascending: true }).limit(300);
  return (data ?? []) as GroupMsg[];
}
export async function fetchGroupMembers(supabase: SupabaseClient, chatId: string): Promise<GroupMemberRow[]> {
  const { data } = await supabase.rpc("get_group_members", { p_chat: chatId });
  return (data ?? []) as GroupMemberRow[];
}
export const markGroupRead = (supabase: SupabaseClient, chatId: string) => supabase.rpc("mark_group_read", { p_chat: chatId });
export async function sendGroupMessage(supabase: SupabaseClient, me: string, chatId: string, text: string, imageUrl: string | null, replyTo: string | null): Promise<{ msg?: GroupMsg; error?: string }> {
  const { data, error } = await supabase.from("group_messages").insert({ chat_id: chatId, sender_id: me, content: text, image_url: imageUrl, reply_to: replyTo }).select(GROUP_MSG_SELECT).single();
  if (error) return { error: error.code === "42501" ? "You're not in this group any more." : groupErrorText(error.message) };
  return { msg: data as GroupMsg };
}
export async function unsendGroupMessage(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await supabase.from("group_messages").delete().eq("id", id).select("id");
  return !!data && data.length > 0;
}
export async function fetchGroupCandidates(supabase: SupabaseClient, chatId?: string): Promise<GroupMember[]> {
  const { data } = await supabase.rpc("get_group_chat_candidates", chatId ? { p_chat: chatId } : {});
  return (data ?? []) as GroupMember[];
}
export async function createGroup(supabase: SupabaseClient, name: string, members: string[]): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.rpc("create_group_chat", { p_name: name, p_members: members });
  if (error || !data) return { error: groupErrorText(error?.message) };
  return { id: data as string };
}
export const renameGroup = (supabase: SupabaseClient, chatId: string, name: string) => supabase.rpc("rename_group_chat", { p_chat: chatId, p_name: name });
export const addGroupMembers = (supabase: SupabaseClient, chatId: string, members: string[]) => supabase.rpc("add_group_members", { p_chat: chatId, p_members: members });
export const removeGroupMember = (supabase: SupabaseClient, chatId: string, userId: string) => supabase.rpc("remove_group_member", { p_chat: chatId, p_user: userId });
export const leaveGroup = (supabase: SupabaseClient, chatId: string) => supabase.rpc("leave_group_chat", { p_chat: chatId });

/* ── What's waiting for you, for the header ────────────────────────────
   The same shape as the bell's count (notifications.ts): one store for
   the whole app, kept fresh by realtime, so the icon can sit in the top
   bar without every screen fetching for it. Counts conversations with
   something unread rather than messages — "3" next to the icon means
   three people are waiting, which is what you want to know. */
import { useEffect, useState } from "react";
import { supabase as dmClient } from "./supabase";

let dmUnread = 0;
const dmListeners = new Set<(n: number) => void>();
let dmWatching: string | null = null;
let dmChannel: ReturnType<typeof dmClient.channel> | null = null;

async function refreshDmUnread() {
  const [threads, groups] = await Promise.all([
    fetchThreads(dmClient).catch(() => [] as Thread[]),
    fetchGroups(dmClient).catch(() => [] as GroupRow[]),
  ]);
  dmUnread = threads.filter((t) => t.unread > 0).length + groups.filter((g) => g.unread > 0).length;
  dmListeners.forEach((l) => l(dmUnread));
}

/** Follow my conversations while signed in; nil clears and unsubscribes. */
export function watchDmUnread(uid: string | null) {
  if (dmWatching === uid) return;
  dmWatching = uid;
  if (dmChannel) { void dmClient.removeChannel(dmChannel); dmChannel = null; }
  if (!uid) { dmUnread = 0; dmListeners.forEach((l) => l(0)); return; }
  void refreshDmUnread();
  dmChannel = dmClient
    .channel("dm-badge-app")
    /* Arriving mail, and my own reading of it: both change the count. */
    .on("postgres_changes", { event: "*", schema: "public", table: "direct_messages" }, () => void refreshDmUnread())
    .on("postgres_changes", { event: "*", schema: "public", table: "group_messages" }, () => void refreshDmUnread())
    .subscribe();
}

/** Reading a conversation doesn't always come back through realtime. */
export function bumpDmUnread() { void refreshDmUnread(); }

export function useDmUnread(): number {
  const [n, setN] = useState(dmUnread);
  useEffect(() => {
    dmListeners.add(setN);
    setN(dmUnread);
    return () => { dmListeners.delete(setN); };
  }, []);
  return n;
}
