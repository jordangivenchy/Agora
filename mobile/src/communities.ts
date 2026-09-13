/* Communities, the way the website reads and writes them
   (components/CommunitiesPage.tsx): the directory from the tables, posts
   and comments from the same RPCs, votes and joins through the same
   calls, so the app and the site agree. */
import type { SupabaseClient } from "@supabase/supabase-js";

/* ── The directory ── */
export interface Community {
  id: string;
  name: string;
  kind: string;
  color: string;
  description: string | null;
  rules: string | null;
  is_private: boolean;
  application_prompt: string | null;
  banner_url: string | null;
  avatar_url: string | null;
  members: number;
  joined: boolean;
  favorite: boolean;
  my_role: string | null;
  requested: boolean;
}

type CommunityRow = {
  id: string; name: string; kind: string; color: string | null; description: string | null; rules: string | null;
  is_private: boolean | null; application_prompt: string | null; banner_url: string | null; avatar_url: string | null;
  community_members: { user_id: string; role: string; favorite: boolean | null }[] | null;
};

export async function fetchCommunities(supabase: SupabaseClient, uid: string | null): Promise<Community[]> {
  /* Everyone has a u/ board to post on; made on first sight, idempotent. */
  if (uid) await supabase.rpc("ensure_profile_community").then(undefined, () => undefined);
  const [commRes, reqRes] = await Promise.all([
    supabase
      .from("communities")
      .select("id, name, kind, color, description, rules, is_private, application_prompt, banner_url, avatar_url, community_members(user_id, role, favorite)"),
    uid ? supabase.from("community_join_requests").select("community_id").eq("user_id", uid) : Promise.resolve({ data: [] as { community_id: string }[] }),
  ]);
  const requested = new Set(((reqRes.data ?? []) as { community_id: string }[]).map((r) => r.community_id));
  return ((commRes.data ?? []) as unknown as CommunityRow[]).map((c) => {
    const members = c.community_members ?? [];
    const mine = uid ? members.find((m) => m.user_id === uid) : undefined;
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      color: c.color ?? "#4a9eff",
      description: c.description ?? null,
      rules: c.rules ?? null,
      is_private: !!c.is_private,
      application_prompt: c.application_prompt ?? null,
      banner_url: c.banner_url ?? null,
      avatar_url: c.avatar_url ?? null,
      members: members.length,
      joined: !!mine,
      favorite: !!mine?.favorite,
      my_role: mine?.role ?? null,
      requested: requested.has(c.id),
    };
  });
}

/* Join, leave, or ask. The result says what happened. */
export async function toggleJoin(supabase: SupabaseClient, c: Community, uid: string): Promise<"joined" | "left" | "requested" | "withdrawn"> {
  if (c.joined) {
    if (c.my_role === "owner") throw new Error("Owners can't leave their own community.");
    const { error } = await supabase.from("community_members").delete().eq("community_id", c.id).eq("user_id", uid);
    if (error) throw new Error(error.message);
    return "left";
  }
  if (c.is_private) {
    if (c.requested) {
      const { error } = await supabase.from("community_join_requests").delete().eq("community_id", c.id).eq("user_id", uid);
      if (error) throw new Error(error.message);
      return "withdrawn";
    }
    const { error } = await supabase.rpc("request_to_join", { p_community: c.id, p_message: null });
    if (error) throw new Error(error.message);
    return "requested";
  }
  const { error } = await supabase.from("community_members").insert({ community_id: c.id, user_id: uid });
  if (error) throw new Error(error.message);
  return "joined";
}

export async function setFavorite(supabase: SupabaseClient, communityId: string, favorite: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_community_favorite", { p_community: communityId, p_favorite: favorite });
  if (error) throw new Error(error.message);
}

/* ── Posts ── */
export type PostSort = "best" | "new" | "top";
export const FEED_PAGE = 30;

export interface PostRow {
  id: string;
  community_id: string;
  community_name: string;
  author_id: string | null;
  author_username: string;
  title: string;
  body: string | null;
  created_at: string;
  score: number;
  my_vote: number;
  comment_count: number;
  author_display_name: string | null;
  image_url: string | null;
  tag_id: string | null;
  tag_name: string | null;
  tag_color: string | null;
  author_role: string | null;
  is_repost: boolean;
  repost_of: string | null;
  orig_title: string | null;
  orig_body: string | null;
  orig_image_url: string | null;
  orig_community_name: string | null;
  orig_author_username: string | null;
  orig_author_display_name: string | null;
  pinned_at: string | null;
  featured_at?: string | null;
  edited_at?: string | null;
}

export async function fetchPosts(supabase: SupabaseClient, opts: { community: string | null; sort: PostSort; offset?: number; limit?: number }): Promise<PostRow[]> {
  const { data, error } = await supabase.rpc("get_community_posts", {
    p_community: opts.community,
    p_sort: opts.sort,
    p_limit: opts.limit ?? FEED_PAGE,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PostRow[];
}

export async function fetchPost(supabase: SupabaseClient, id: string): Promise<PostRow | null> {
  const { data, error } = await supabase.rpc("get_community_post", { p_post: id });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PostRow[];
  return rows[0] ?? null;
}

/* The RPCs don't carry avatars; fetched once per author and kept. */
const avatarCache = new Map<string, string | null>();
export async function fetchAvatars(supabase: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const missing = [...new Set(ids.filter((x): x is string => !!x && !avatarCache.has(x)))];
  if (missing.length) {
    const { data } = await supabase.from("users").select("id, avatar_url").in("id", missing);
    for (const u of (data ?? []) as { id: string; avatar_url: string | null }[]) avatarCache.set(u.id, u.avatar_url);
    for (const id of missing) if (!avatarCache.has(id)) avatarCache.set(id, null);
  }
  return new Map(avatarCache);
}

function friendly(message: string, kind: "post" | "comment"): string {
  if (message.includes("rate_limited")) return kind === "post" ? "You're posting too quickly — try again in a few minutes." : "Slow down — you're commenting too quickly.";
  if (message.includes("profile_board")) return "Only the profile's owner can post there.";
  return message;
}

export async function createPost(supabase: SupabaseClient, input: { communityId: string; authorId: string; title: string; body: string | null }): Promise<string> {
  const { data, error } = await supabase
    .from("community_posts")
    .insert({ community_id: input.communityId, author_id: input.authorId, title: input.title, body: input.body, tag_id: null, image_url: null })
    .select("id")
    .single();
  if (error) throw new Error(friendly(error.message, "post"));
  return (data as { id: string }).id;
}

export async function votePost(supabase: SupabaseClient, id: string, value: number): Promise<void> {
  const { error } = await supabase.rpc("vote_post", { p_post: id, p_value: value });
  if (error) throw new Error(error.message);
}

/* ── Comments ── */
export interface CommentRow {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string | null;
  author_username: string;
  body: string;
  created_at: string;
  score: number;
  my_vote: number;
  author_display_name: string | null;
  author_role: string | null;
  image_url: string | null;
  pinned_at: string | null;
}
export type CommentSort = "top" | "new";
export const COMMENT_PAGE = 60;

export async function fetchComments(supabase: SupabaseClient, postId: string, offset = 0): Promise<CommentRow[]> {
  const { data, error } = await supabase.rpc("get_post_comments", { p_post: postId, p_limit: COMMENT_PAGE, p_offset: offset });
  if (error) throw new Error(error.message);
  return (data ?? []) as CommentRow[];
}

export async function createComment(supabase: SupabaseClient, input: { postId: string; parentId: string | null; authorId: string; body: string }): Promise<{ id: string; created_at: string }> {
  const { data, error } = await supabase
    .from("community_comments")
    .insert({ post_id: input.postId, parent_id: input.parentId, author_id: input.authorId, body: input.body, image_url: null })
    .select("id, created_at")
    .single();
  if (error) throw new Error(friendly(error.message, "comment"));
  return data as { id: string; created_at: string };
}

export async function voteComment(supabase: SupabaseClient, id: string, value: number): Promise<void> {
  const { error } = await supabase.rpc("vote_comment", { p_comment: id, p_value: value });
  if (error) throw new Error(error.message);
}

/* Roots and children as the site orders them: pinned roots first,
   oldest pin first; then by score (ties oldest first) or newest first. */
export function buildTree(comments: CommentRow[], sort: CommentSort) {
  const ids = new Set(comments.map((c) => c.id));
  const roots: CommentRow[] = [];
  const children = new Map<string, CommentRow[]>();
  for (const c of comments) {
    if (c.parent_id && ids.has(c.parent_id)) {
      const list = children.get(c.parent_id) ?? [];
      list.push(c);
      children.set(c.parent_id, list);
    } else {
      roots.push(c);
    }
  }
  const bySort = (a: CommentRow, b: CommentRow) =>
    sort === "top"
      ? b.score - a.score || +new Date(a.created_at) - +new Date(b.created_at)
      : +new Date(b.created_at) - +new Date(a.created_at);
  roots.sort((a, b) => {
    if (!!a.pinned_at !== !!b.pinned_at) return a.pinned_at ? -1 : 1;
    if (a.pinned_at && b.pinned_at) return +new Date(a.pinned_at) - +new Date(b.pinned_at);
    return bySort(a, b);
  });
  for (const list of children.values()) list.sort(bySort);
  const subtreeSize = (id: string): number => (children.get(id) ?? []).reduce((n, d) => n + 1 + subtreeSize(d.id), 0);
  return { roots, children, subtreeSize };
}

/* "just now", "5m", "3h", "2d", then the day itself. */
export function timeAgo(iso: string): string {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - +d) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", thisYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
