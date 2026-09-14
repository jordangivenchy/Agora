/* A community's mod team and mod tools, read and written the way the site
   does (components/CommunitiesPage.tsx: loadCommunityExtras, saveSettings,
   setBranding, banMember, setRole, handleRequest, createTag, deleteTag;
   community/ModerationPanels.tsx: the ban list and the mod log). The
   database guards every write: is_community_mod for settings, bans, tags
   and approvals; the owner alone for roles and privacy. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBookmarks } from "./communityBookmarks";

export interface MiniUser { username: string | null; display_name: string | null; avatar_url?: string | null }
export interface Member { user_id: string; role: string; user: MiniUser | null }
export interface JoinRequest { user_id: string; created_at: string; message: string | null; user: MiniUser | null }
export interface BanRow { user_id: string; banned_by: string | null; reason: string | null; created_at: string; user: MiniUser | null }
export interface ModLogRow { id: string; actor_id: string | null; action: string; target_user: string | null; target_post: string | null; detail: string | null; created_at: string; actor: MiniUser | null; target: MiniUser | null }
export interface CommunityRoom { id: string; motion: string; status: string; scheduled_start: string | null; community_id: string }

/* The site's six tag colours (CommunitiesPage.tsx TAG_COLORS). */
export const TAG_COLORS = ["#e2b96b", "#64B5F6", "#00b894", "#d98fb9", "#9d8fd9", "#e0956a"];

export function personName(u: MiniUser | null | undefined): string {
  return u?.display_name?.trim() || `@${u?.username ?? "unknown"}`;
}

const PERSON = "user:users!user_id(username, display_name, avatar_url)";
const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
function withUser<T extends { user?: unknown }>(rows: unknown): T[] {
  return ((rows ?? []) as T[]).map((r) => ({ ...r, user: one(r.user as MiniUser | MiniUser[] | null) }));
}

export function modError(message: string): string {
  if (message.includes("not_moderator")) return "Only this community's moderators can do that.";
  if (message.includes("owner_only")) return "Only the owner can do that.";
  if (message.includes("cannot_ban_mod")) return "Owners and moderators can't be banned.";
  if (message.includes("cannot_ban_self")) return "You can't ban yourself.";
  if (message.includes("cannot_change_own_role")) return "You can't change your own role.";
  if (message.includes("too_many_bookmarks")) return "Twelve bookmarks at most.";
  if (message.includes("invalid_bookmark")) return "A bookmark didn't read right — use Label | https://link, one per line.";
  if (message.includes("duplicate")) return "That tag already exists.";
  return message.replace(/^[a-z_]+:\s*/, "");
}

/** The mod team, owner first: shown to everyone on the community page. */
export async function fetchMods(supabase: SupabaseClient, communityId: string): Promise<Member[]> {
  const { data } = await supabase.from("community_members").select(`user_id, role, ${PERSON}`).eq("community_id", communityId).in("role", ["owner", "moderator"]);
  return withUser<Member>(data).sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
}

/** Everyone in it (the mod tools' member list). */
export async function fetchMembers(supabase: SupabaseClient, communityId: string): Promise<Member[]> {
  const { data } = await supabase.from("community_members").select(`user_id, role, ${PERSON}`).eq("community_id", communityId);
  return withUser<Member>(data);
}

export async function fetchJoinRequests(supabase: SupabaseClient, communityId: string): Promise<JoinRequest[]> {
  const { data } = await supabase.from("community_join_requests").select(`user_id, created_at, message, ${PERSON}`).eq("community_id", communityId).order("created_at", { ascending: true });
  return withUser<JoinRequest>(data);
}

export async function fetchBans(supabase: SupabaseClient, communityId: string): Promise<BanRow[]> {
  const { data, error } = await supabase.from("community_bans").select(`user_id, banned_by, reason, created_at, ${PERSON}`).eq("community_id", communityId).order("created_at", { ascending: false });
  if (error) throw new Error("Couldn't load bans.");
  return withUser<BanRow>(data);
}

/* target_user has no foreign key, so it can't be embedded the way the
   actor is (the site's panel asks for both and gets an error back): the
   targets' names come in a second read. */
export async function fetchModLog(supabase: SupabaseClient, communityId: string): Promise<ModLogRow[]> {
  const { data, error } = await supabase
    .from("community_mod_log")
    .select("id, actor_id, action, target_user, target_post, detail, created_at, actor:users!actor_id(username, display_name)")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error("Couldn't load the log.");
  const rows = (data ?? []) as unknown as ModLogRow[];
  const targetIds = [...new Set(rows.map((r) => r.target_user).filter((x): x is string => !!x))];
  const names = new Map<string, MiniUser>();
  if (targetIds.length) {
    const { data: users } = await supabase.from("users").select("id, username, display_name").in("id", targetIds);
    for (const u of (users ?? []) as (MiniUser & { id: string })[]) names.set(u.id, u);
  }
  return rows.map((r) => ({ ...r, actor: one(r.actor as MiniUser | MiniUser[] | null), target: r.target_user ? names.get(r.target_user) ?? null : null }));
}

/* One phrase per logged action, as the site's ModLogPanel words it; the
   target's name is kept apart so it can take its colour. */
export function logPhrase(row: ModLogRow): { verb: string; target: string | null; tail?: string } {
  const target = row.target_user ? personName(row.target) : null;
  switch (row.action) {
    case "ban": return { verb: "banned", target };
    case "unban": return { verb: "unbanned", target };
    case "role_change": return row.detail ? { verb: "made", target, tail: `a ${row.detail}` } : { verb: "changed the role of", target };
    case "approve_join": return { verb: "approved join request", target };
    case "deny_join": return { verb: "denied join request", target };
    case "settings_update": return { verb: "updated settings", target: null };
    case "pin_comment": return { verb: "pinned a comment", target: null };
    case "unpin_comment": return { verb: "unpinned a comment", target: null };
    case "pin_post": return { verb: "pinned a post", target: null };
    case "unpin_post": return { verb: "unpinned a post", target: null };
    default: return { verb: row.action.replace(/_/g, " "), target };
  }
}

/** Live and upcoming discussions hosted by these communities, soonest first. */
export async function fetchCommunityRooms(supabase: SupabaseClient, communityIds: string[]): Promise<CommunityRoom[]> {
  if (communityIds.length === 0) return [];
  const { data } = await supabase
    .from("debate_rooms")
    .select("id, motion, status, scheduled_start, community_id")
    .in("community_id", communityIds)
    .in("status", ["created", "scheduled", "live"])
    .order("scheduled_start", { ascending: true })
    .limit(8);
  return (data ?? []) as CommunityRoom[];
}

async function rpc(supabase: SupabaseClient, fn: string, params: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(fn, params);
  if (error) throw new Error(modError(error.message));
}

export const approveJoinRequest = (supabase: SupabaseClient, communityId: string, userId: string, approve: boolean) =>
  rpc(supabase, approve ? "approve_join_request" : "deny_join_request", { p_community: communityId, p_user: userId });

export const setMemberRole = (supabase: SupabaseClient, communityId: string, userId: string, role: "moderator" | "member") =>
  rpc(supabase, "set_community_role", { p_community: communityId, p_user: userId, p_role: role });

export const banMember = (supabase: SupabaseClient, communityId: string, userId: string, reason: string) =>
  rpc(supabase, "ban_community_member", { p_community: communityId, p_user: userId, p_reason: reason.trim() || null });

export const unbanMember = (supabase: SupabaseClient, communityId: string, userId: string) =>
  rpc(supabase, "unban_community_member", { p_community: communityId, p_user: userId });

/* About & rules, as the site saves them: the settings (privacy only when
   the owner changes it), then the bookmarks parsed from their text. An
   empty field clears the column. */
export async function saveCommunityAbout(
  supabase: SupabaseClient,
  communityId: string,
  draft: { description: string; rules: string; applicationPrompt: string; bookmarksText: string; isPrivate: boolean | null },
): Promise<void> {
  await rpc(supabase, "update_community_settings", {
    p_community: communityId,
    p_description: draft.description.trim(),
    p_rules: draft.rules.trim(),
    p_is_private: draft.isPrivate,
    p_application_prompt: draft.applicationPrompt.trim(),
  });
  await rpc(supabase, "set_community_bookmarks", { p_community: communityId, p_bookmarks: parseBookmarks(draft.bookmarksText) });
}

/** A new banner or picture (a URL), or "" to go back to the colour and the initial. */
export const setCommunityBranding = (supabase: SupabaseClient, communityId: string, kind: "banner" | "avatar", url: string) =>
  rpc(supabase, "update_community_settings", { p_community: communityId, ...(kind === "banner" ? { p_banner_url: url } : { p_avatar_url: url }) });

export async function addCommunityTag(supabase: SupabaseClient, communityId: string, uid: string, name: string, color: string): Promise<void> {
  const { error } = await supabase.from("community_tags").insert({ community_id: communityId, name: name.trim(), color, created_by: uid });
  if (error) throw new Error(modError(error.message));
}

export async function removeCommunityTag(supabase: SupabaseClient, tagId: string): Promise<void> {
  const { error } = await supabase.from("community_tags").delete().eq("id", tagId);
  if (error) throw new Error(modError(error.message));
}
