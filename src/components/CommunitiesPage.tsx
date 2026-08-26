"use client";

/* Communities — a forum, not just a membership list. Each community is
   a board of posts with up/down votes and threaded comments
   (Reddit/Quora-style), backed by 20260815_community_posts.sql and
   20260835_communities_v2.sql:
   - feed + scores via get_community_posts (votes are private rows;
     only aggregates and your own vote leave the database), sorted
     Best (Wilson lower bound) / New / Top
   - voting via vote_post (±1, 0 clears)
   - posts/comments written directly under RLS (as yourself, not
     suspended, rate-limited by trigger, invisible boards excluded)
   - private communities: listed in the rail, content member-only,
     joining goes through request_to_join + mod approval
   - moderation: owner/mods edit description/rules/privacy, manage
     tags, approve requests, delete posts; owner promotes mods
   - images (post-images bucket), reposts (repost_post RPC), share
     links (/?post=<id>)
   Guests can read public boards; any interaction routes to /login. */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import { Icon, type IconName } from "@/components/icons";
import { useUserMenu } from "./userMenuContext";
import UserAvatar from "./UserAvatar";
import useEscapeClose from "@/lib/useEscapeClose";
import { formatBookmarks, isGroup, parseBookmarks, safeBookmarks, type Bookmark } from "@/lib/communityBookmarks";
import { uploadPostImage, uploadSquareImage } from "@/lib/postImages";
import { getPresenceSnapshot, subscribePresence } from "@/lib/presence";
import { communitySlug, findCommunityBySlug } from "@/lib/communityUrls";
import { pathFor, setSectionTitle } from "@/lib/routes";
import { BansPanel, ModLogPanel } from "./community/ModerationPanels";
import GifPicker, { giphyEnabled } from "./community/GifPicker";
import EmojiPicker from "./EmojiPicker";
import CommunityPicker from "./community/CommunityPicker";
import RichText from "./community/RichText";
import PostCard, { RoleBadge, TagChip, VoteBox, timeAgo, type PostRow } from "./community/PostCard";
import ReplayEmbed from "./community/ReplayEmbed";
import ClipEmbed from "./community/ClipEmbed";
import RichEditor, { type RichEditorHandle } from "./community/RichEditor";

interface Props {
  open: boolean;
  onClose: () => void;
  /* Open the room-create modal linked to a community — starts live by
     default; scheduling stays available inside the modal. */
  onStartDiscussion?: (communityId: string, communityName: string) => void;
}

type Community = {
  id: string;
  name: string;
  kind: string;
  color: string;
  description: string | null;
  rules: string | null;
  is_private: boolean;
  banner_url: string | null;
  avatar_url: string | null;
  members: number;
  joined: boolean;
  favorite: boolean;        // pinned to the top of the list
  bookmarks: Bookmark[];    // mod-curated sidebar links (Community Bookmarks)
  my_role: string | null;   // 'owner' | 'moderator' | 'member' | null
  requested: boolean;       // pending join request (private boards)
  blocked: boolean;         // you blocked this board (hidden from browse + feed)
};

type Tag = { id: string; community_id: string; name: string; color: string };

type Post = PostRow;


type Comment = {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string | null;
  author_username: string;
  author_display_name: string | null;
  body: string;
  created_at: string;
  score: number;
  my_vote: number | null;
  author_role: string | null;
  image_url: string | null;
  pinned_at: string | null;
};

type JoinRequest = {
  user_id: string;
  created_at: string;
  user: { username: string; display_name: string | null; avatar_url: string | null } | null;
};

type Member = {
  user_id: string;
  role: string;
  user: { username: string; display_name: string | null; avatar_url: string | null } | null;
};

type CommunityDebate = {
  id: string;
  motion: string;
  status: string;
  scheduled_start: string | null;
};

type RailDebate = CommunityDebate & {
  community_id: string;
  community_name: string;
  community_color: string;
};

const KINDS = [
  { key: "topic-circle", label: "Topic circle" },
  { key: "university", label: "University" },
  { key: "hs-team", label: "HS team" },
  { key: "mun", label: "Model UN" },
  { key: "pre-law", label: "Pre-law" },
];

const TAG_COLORS = ["#e2b96b", "#64B5F6", "#00b894", "#d98fb9", "#9d8fd9", "#e0956a"];

/* Homepage v5 glass: translucent card, blur, hairline border. */
const card: React.CSSProperties = {
  background: "rgba(14,14,17,0.72)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14,
};

/* Stored markdown length cap for post bodies and comments. */
const BODY_MAX = 10000;

const inputStyle: React.CSSProperties = {
  background: "rgba(10,10,12,0.7)",
  border: "0.5px solid rgba(255,255,255,0.1)",
  borderRadius: 9,
  color: "#eeeef5",
  fontSize: 13,
  padding: "9px 12px",
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

/* Solid pill blue — same as the queue Join button (#2f7fe0). */
const btnBlue: React.CSSProperties = {
  background: "#2f7fe0", border: "none",
  color: "#fff", borderRadius: 9, fontFamily: "inherit", cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  background: "transparent", border: "0.5px solid rgba(255,255,255,0.14)",
  color: "rgba(238,238,245,0.65)", borderRadius: 9, fontFamily: "inherit", cursor: "pointer",
};

/* Premium header pills — shared base + tinted variants, with a hover
   lift applied via the mouse handlers below. */
const pillBase: React.CSSProperties = {
  fontFamily: "inherit", cursor: "pointer", borderRadius: 999,
  padding: "5px 13px", fontSize: 11, fontWeight: 600, letterSpacing: "0.01em",
  transition: "transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease",
  whiteSpace: "nowrap",
};
const pillGold: React.CSSProperties = {
  ...pillBase,
  background: "linear-gradient(135deg,#f7e3a0,#d9a238)",
  border: "none", color: "#412402",
  boxShadow: "0 3px 10px rgba(217,162,56,0.2)",
};
const pillBlue: React.CSSProperties = {
  ...pillBase,
  background: "rgba(74,158,255,0.14)",
  border: "1px solid rgba(74,158,255,0.4)", color: "#9ccafd",
  boxShadow: "0 3px 10px rgba(74,158,255,0.1)",
};
const pillGreen: React.CSSProperties = {
  ...pillBase,
  background: "rgba(0,184,148,0.1)",
  border: "1px solid rgba(0,184,148,0.4)", color: "#35d3ab",
};
const pillAmber: React.CSSProperties = {
  ...pillBase,
  background: "rgba(226,185,107,0.08)",
  border: "1px solid rgba(226,185,107,0.35)", color: "#e2b96b",
};
const pillGlass: React.CSSProperties = {
  ...pillBase,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)", color: "rgba(238,238,245,0.8)",
  backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
};
const liftIn = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.transform = "translateY(-1px)";
  e.currentTarget.style.filter = "brightness(1.12)";
};
const liftOut = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.transform = "";
  e.currentTarget.style.filter = "";
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function CommunitiesPage({ open, onClose, onStartDiscussion }: Props) {
  const { openUserMenu } = useUserMenu();

  /* Author label → unified user context menu (needs an id; system posts skip
     it). Renders the display name when one exists (no @ prefix), otherwise
     the @handle; the raw username still flows to openUserMenu. */
  const authorLabel = (dn: string | null, username: string) =>
    dn?.trim() || `@${username}`;
  const authorSpan = (authorId: string | null, username: string, dn: string | null) =>
    authorId ? (
      <span
        onClick={(e) => {
          e.stopPropagation();
          openUserMenu({ x: e.clientX, y: e.clientY }, { userId: authorId, username });
        }}
        className="cursor-pointer inline-flex items-center gap-1"
        style={{ textDecoration: "underline dotted rgba(255,255,255,0.25)", textUnderlineOffset: 2 }}
      >
        <UserAvatar size={14} username={username} avatarUrl={avatars[authorId]} seed={authorId} />
        {authorLabel(dn, username)}
      </span>
    ) : (
      <>{authorLabel(dn, username)}</>
    );

  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null>(null);

  /* Live presence (45s heartbeat / 90s staleness) — the store is kept
     running by FriendsSection on the homepage shell; we only read it. */
  const presence = useSyncExternalStore(subscribePresence, getPresenceSnapshot, () => getPresenceSnapshot());

  const [communities, setCommunities] = useState<Community[]>([]);
  const [communitiesLoaded, setCommunitiesLoaded] = useState(false);
  const [tagsByCommunity, setTagsByCommunity] = useState<Record<string, Tag[]>>({});
  const [selected, setSelected] = useState<string>("all"); // 'all' | community id
  const [posts, setPosts] = useState<Post[]>([]);
  const [sort, setSort] = useState<"best" | "new" | "top">("best");
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Rail filter + per-community notification mutes (mine). */
  const [railQuery, setRailQuery] = useState("");
  const [myMutes, setMyMutes] = useState<Set<string>>(new Set());
  const [myBlocks, setMyBlocks] = useState<Set<string>>(new Set());
  /* The board ⋯ overflow menu — its anchor coords (fixed-positioned so it
     escapes the header card's overflow:hidden), or null when closed. */
  const [boardMenuAt, setBoardMenuAt] = useState<{ top: number; left: number } | null>(null);

  // Post detail
  const [openPost, setOpenPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [hasMoreComments, setHasMoreComments] = useState(false);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [commentSort, setCommentSort] = useState<"top" | "new">("top");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pendingCommentId, setPendingCommentId] = useState<string | null>(null);
  const [flashCommentId, setFlashCommentId] = useState<string | null>(null);


  // Composers
  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newTagId, setNewTagId] = useState<string>("");
  const [newImage, setNewImage] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
  /* GIPHY picks (mutually exclusive with a file attachment). */
  const [newGifUrl, setNewGifUrl] = useState<string | null>(null);
  const [gifPickerFor, setGifPickerFor] = useState<null | "post" | "comment" | "reply">(null);
  const [commentGifUrl, setCommentGifUrl] = useState<string | null>(null);
  const bodyRef = useRef<RichEditorHandle | null>(null);
  /* Emoji picker (shared popover) for the post body / comment box. */
  const [emojiFor, setEmojiFor] = useState<null | "post" | "comment" | "reply">(null);
  const commentInputRef = useRef<RichEditorHandle | null>(null);
  const commentImageInputRef = useRef<HTMLInputElement | null>(null);
  const replyInputRef = useRef<RichEditorHandle | null>(null);
  const replyImageInputRef = useRef<HTMLInputElement | null>(null);
  const postImageInputRef = useRef<HTMLInputElement | null>(null);
  const [composeCommunity, setComposeCommunity] = useState<string>("");
  const [creatingCommunity, setCreatingCommunity] = useState(false);
  const [newCommunityName, setNewCommunityName] = useState("");
  const [newCommunityKind, setNewCommunityKind] = useState("topic-circle");
  const [newCommunityPrivate, setNewCommunityPrivate] = useState(false);
  const [busy, setBusy] = useState(false);

  // Sharing / reposting
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [repostFor, setRepostFor] = useState<Post | null>(null);
  const [repostCommunity, setRepostCommunity] = useState<string>("");
  const [repostComment, setRepostComment] = useState("");

  // Comment images (one active composer at a time: root box or open reply)
  const [commentImage, setCommentImage] = useState<File | null>(null);
  const [commentImagePreview, setCommentImagePreview] = useState<string | null>(null);
  const [replyImage, setReplyImage] = useState<File | null>(null);
  const [replyGifUrl, setReplyGifUrl] = useState<string | null>(null);
  const [replyImagePreview, setReplyImagePreview] = useState<string | null>(null);

  // Community header extras
  const [modOpen, setModOpen] = useState(false);
  const [railDebates, setRailDebates] = useState<RailDebate[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  /* The open community's mod team — shown to everyone in the About card. */
  const [railMods, setRailMods] = useState<Member[]>([]);
  const [membersList, setMembersList] = useState<Member[]>([]);
  // Mod panel drafts
  const [draftDescription, setDraftDescription] = useState("");
  const [draftRules, setDraftRules] = useState("");
  const [draftBookmarks, setDraftBookmarks] = useState("");
  const [openBookmarkGroup, setOpenBookmarkGroup] = useState<string | null>(null);
  const [draftPrivate, setDraftPrivate] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);

  const requireAuth = useCallback((): boolean => {
    if (!userId) { window.location.href = "/login"; return false; }
    return true;
  }, [userId]);

  /* ── loading ── */

  const loadCommunities = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id ?? null;
    setUserId(uid);
    const [commRes, tagRes, reqRes, muteRes, blockRes] = await Promise.all([
      supabase
        .from("communities")
        .select("id, name, kind, color, description, rules, is_private, banner_url, avatar_url, bookmarks, community_members(user_id, role, favorite)"),
      supabase.from("community_tags").select("id, community_id, name, color"),
      uid
        ? supabase.from("community_join_requests").select("community_id").eq("user_id", uid)
        : Promise.resolve({ data: [] as { community_id: string }[] }),
      uid
        ? supabase.from("community_mutes").select("community_id").eq("user_id", uid)
        : Promise.resolve({ data: [] as { community_id: string }[] }),
      uid
        ? supabase.from("community_blocks").select("community_id").eq("user_id", uid)
        : Promise.resolve({ data: [] as { community_id: string }[] }),
    ]);
    setMyMutes(new Set(((muteRes.data ?? []) as { community_id: string }[]).map((m) => m.community_id)));
    const blockedIds = new Set(((blockRes.data ?? []) as { community_id: string }[]).map((b) => b.community_id));
    setMyBlocks(blockedIds);
    const myRequests = new Set(
      ((reqRes.data ?? []) as { community_id: string }[]).map((r) => r.community_id)
    );
    setCommunitiesLoaded(true);
    setCommunities(
      (commRes.data ?? []).map((c) => {
        const members = (c.community_members ?? []) as { user_id: string; role: string; favorite?: boolean }[];
        const mine = members.find((m) => m.user_id === uid);
        return {
          id: c.id,
          name: c.name,
          kind: c.kind,
          color: c.color ?? "#4a9eff",
          description: c.description ?? null,
          rules: c.rules ?? null,
          is_private: !!c.is_private,
          banner_url: c.banner_url ?? null,
          avatar_url: c.avatar_url ?? null,
          members: members.length,
          joined: !!mine,
          favorite: !!mine?.favorite,
          bookmarks: safeBookmarks(c.bookmarks),
          my_role: mine?.role ?? null,
          requested: myRequests.has(c.id),
          blocked: blockedIds.has(c.id),
        };
      })
    );
    const byCommunity: Record<string, Tag[]> = {};
    for (const t of (tagRes.data ?? []) as Tag[]) {
      (byCommunity[t.community_id] ??= []).push(t);
    }
    setTagsByCommunity(byCommunity);

    /* Rail: scheduled/live debates across the communities you joined —
       hosted by the community, so they're labeled with its name. */
    const joinedMeta = new Map(
      (commRes.data ?? [])
        .filter((c) => ((c.community_members ?? []) as { user_id: string }[]).some((m) => m.user_id === uid))
        .map((c) => [c.id as string, { name: c.name as string, color: (c.color as string) ?? "#4a9eff" }])
    );
    if (joinedMeta.size === 0) {
      setRailDebates([]);
    } else {
      const { data: rooms } = await supabase
        .from("debate_rooms")
        .select("id, motion, status, scheduled_start, community_id")
        .in("community_id", [...joinedMeta.keys()])
        .in("status", ["created", "scheduled", "live"])
        .order("scheduled_start", { ascending: true })
        .limit(8);
      setRailDebates(
        ((rooms ?? []) as (CommunityDebate & { community_id: string })[])
          .map((r) => ({
            ...r,
            community_name: joinedMeta.get(r.community_id)?.name ?? "Community",
            community_color: joinedMeta.get(r.community_id)?.color ?? "#4a9eff",
          }))
          // Live rooms first, then soonest scheduled.
          .sort((a, b) =>
            (b.status === "live" ? 1 : 0) - (a.status === "live" ? 1 : 0)
            || (a.scheduled_start ?? "9999").localeCompare(b.scheduled_start ?? "9999"))
      );
    }
  }, [supabase]);

  /* The posts/comments RPCs don't return avatars; fetch them per author id
     once and cache — profile photos then appear next to every author name. */
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const requestedAvatars = useRef<Set<string>>(new Set());
  const fetchAvatars = useCallback(async (ids: (string | null)[]) => {
    const missing = [...new Set(ids.filter((id): id is string => !!id))]
      .filter((id) => !requestedAvatars.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => requestedAvatars.current.add(id));
    const { data } = await supabase.from("users").select("id, avatar_url").in("id", missing);
    if (data) {
      setAvatars((m) => {
        const next = { ...m };
        for (const u of data as { id: string; avatar_url: string | null }[]) next[u.id] = u.avatar_url;
        return next;
      });
    }
  }, [supabase]);

  /* Guards against out-of-order responses: only the latest feed request
     and the currently-open post may write their results into state. */
  const feedKeyRef = useRef("");
  const openPostIdRef = useRef<string | null>(null);

  /* Root comments the viewer appended locally (their own new top-level
     comments) that the server hasn't paged past yet — excluded from the
     p_offset count so posting between pages doesn't skip a thread. */
  const localRootIdsRef = useRef<Set<string>>(new Set());

  /* The viewer's own username/display name, fetched once — used to
     append their freshly posted comment without a full refetch. */
  const myIdentityRef = useRef<{ username: string; display_name: string | null } | null>(null);
  const getMyIdentity = useCallback(async () => {
    if (myIdentityRef.current || !userId) return myIdentityRef.current;
    const { data } = await supabase
      .from("users").select("username, display_name").eq("id", userId).single();
    if (data) myIdentityRef.current = data as { username: string; display_name: string | null };
    return myIdentityRef.current;
  }, [supabase, userId]);

  const FEED_PAGE = 50;
  const COMMENT_PAGE = 60;

  const loadPosts = useCallback(async () => {
    const key = `${selected}|${sort}`;
    feedKeyRef.current = key;
    setLoadingPosts(true);
    const { data, error: err } = await supabase.rpc("get_community_posts", {
      p_community: selected === "all" ? null : selected,
      p_sort: sort,
      p_limit: FEED_PAGE,
    });
    if (feedKeyRef.current !== key) return; // a newer request superseded this one
    setLoadingPosts(false);
    if (err) { setError(err.message); return; }
    setError(null);
    const rows = (data ?? []) as Post[];
    setPosts(rows);
    setHasMore(rows.length === FEED_PAGE);
    fetchAvatars(rows.map((p) => p.author_id));
  }, [supabase, selected, sort, fetchAvatars]);

  /* Next page, appended. Offset-based — fine at this scale; duplicate
     guard covers posts that shifted between fetches. */
  const loadMorePosts = useCallback(async () => {
    const key = `${selected}|${sort}`;
    setLoadingMore(true);
    const { data, error: err } = await supabase.rpc("get_community_posts", {
      p_community: selected === "all" ? null : selected,
      p_sort: sort,
      p_limit: FEED_PAGE,
      p_offset: posts.length,
    });
    setLoadingMore(false);
    if (feedKeyRef.current !== key) return;
    if (err) { setError(err.message); return; }
    const rows = (data ?? []) as Post[];
    setPosts((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...rows.filter((r) => !seen.has(r.id))];
    });
    setHasMore(rows.length === FEED_PAGE);
    fetchAvatars(rows.map((p) => p.author_id));
  }, [supabase, selected, sort, posts.length, fetchAvatars]);

  /* First page: 60 top-level threads, every descendant riding along.
     Has-more = a full page of roots came back (see 20260844). */
  const loadComments = useCallback(async (postId: string) => {
    const { data } = await supabase.rpc("get_post_comments", {
      p_post: postId, p_limit: COMMENT_PAGE, p_offset: 0,
    });
    if (openPostIdRef.current !== postId) return; // user moved on
    const rows = (data ?? []) as Comment[];
    localRootIdsRef.current = new Set();
    setComments(rows);
    setHasMoreComments(rows.filter((c) => !c.parent_id).length === COMMENT_PAGE);
    fetchAvatars(rows.map((c) => c.author_id));
  }, [supabase, fetchAvatars]);

  /* Next page of threads, appended. p_offset counts server-paged roots
     only (the viewer's own locally-appended roots are excluded so their
     insertion doesn't skip a thread); dedupe by id absorbs rows that
     shifted between fetches. */
  const loadMoreComments = useCallback(async () => {
    const postId = openPostIdRef.current;
    if (!postId || loadingMoreComments) return;
    const offset = comments
      .filter((c) => !c.parent_id && !localRootIdsRef.current.has(c.id)).length;
    setLoadingMoreComments(true);
    const { data } = await supabase.rpc("get_post_comments", {
      p_post: postId, p_limit: COMMENT_PAGE, p_offset: offset,
    });
    setLoadingMoreComments(false);
    if (openPostIdRef.current !== postId) return; // user moved on
    const rows = (data ?? []) as Comment[];
    // A locally-appended root coming back means the server paged past it.
    for (const r of rows) localRootIdsRef.current.delete(r.id);
    setComments((prev) => {
      const seen = new Set(prev.map((c) => c.id));
      return [...prev, ...rows.filter((r) => !seen.has(r.id))];
    });
    setHasMoreComments(rows.filter((c) => !c.parent_id).length === COMMENT_PAGE);
    fetchAvatars(rows.map((c) => c.author_id));
  }, [supabase, comments, loadingMoreComments, fetchAvatars]);

  /* Resolve a deep-linked comment once the thread is in. Pages through
     the server roots until it's found or the thread is exhausted. */
  const deepLinkTriesRef = useRef(0);
  useEffect(() => {
    if (!openPost || !pendingCommentId) return;
    if (comments.length === 0 && !hasMoreComments) return; // still loading first page
    const hit = comments.find((c) => c.id === pendingCommentId);
    if (hit) {
      setPendingCommentId(null);
      deepLinkTriesRef.current = 0;
      /* Expand any collapsed ancestor so the target is actually visible. */
      const byId = new Map(comments.map((c) => [c.id, c]));
      const ancestors: string[] = [];
      let cur = hit.parent_id ? byId.get(hit.parent_id) : undefined;
      while (cur) { ancestors.push(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
      if (ancestors.length) setCollapsed((prev) => {
        const next = new Set(prev); ancestors.forEach((a) => next.delete(a)); return next;
      });
      setFlashCommentId(hit.id);
      /* The panel scrolls itself to the top when a post opens; land the
         scroll after that settles, then once more for late layout
         (images, avatar fetches). */
      const go = () => document.getElementById(`comment-${hit.id}`)?.scrollIntoView({ block: "center" });
      setTimeout(go, 120);
      setTimeout(go, 700);
      setTimeout(() => setFlashCommentId((id) => (id === hit.id ? null : id)), 2800);
      return;
    }
    if (hasMoreComments && !loadingMoreComments && deepLinkTriesRef.current < 20) {
      deepLinkTriesRef.current += 1;
      loadMoreComments();
    } else if (!hasMoreComments) {
      setPendingCommentId(null);
      deepLinkTriesRef.current = 0;
    }
  }, [openPost, pendingCommentId, comments, hasMoreComments, loadingMoreComments, loadMoreComments]);

  /* Opening/closing a post resets every per-post composer state —
     comments from the previous post, drafts, and pending image
     attachments must never bleed into the next context. */
  const clearCommentImages = useCallback(() => {
    setCommentImage(null);
    setCommentImagePreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setReplyImage(null);
    setReplyImagePreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, []);

  /* Bookmark a community: pins it to the top of the list. Members only
     (the RPC enforces it); optimistic flip, reverted on error. */
  const toggleFavorite = useCallback(async (c: Community) => {
    if (!requireAuth() || !c.joined) return;
    const next = !c.favorite;
    setCommunities((cs) => cs.map((x) => (x.id === c.id ? { ...x, favorite: next } : x)));
    const { error } = await supabase.rpc("set_community_favorite", { p_community: c.id, p_favorite: next });
    if (error) setCommunities((cs) => cs.map((x) => (x.id === c.id ? { ...x, favorite: !next } : x)));
  }, [supabase, requireAuth]);

  /* Where "Back" returns to: the board a post was opened from, else All. */
  const backTargetRef = useRef<string>("all");

  const openPostDetail = useCallback((p: Post) => {
    openPostIdRef.current = p.id;
    backTargetRef.current = selected;
    setOpenPost(p);
    setComments([]);
    setHasMoreComments(false);
    setLoadingMoreComments(false);
    localRootIdsRef.current = new Set();
    setCommentText("");
    setReplyTo(null);
    setReplyText("");
    clearCommentImages();
    loadComments(p.id);
  }, [loadComments, clearCommentImages, selected]);

  const closePostDetail = useCallback(() => {
    openPostIdRef.current = null;
    setOpenPost(null);
    setComments([]);
    setHasMoreComments(false);
    setLoadingMoreComments(false);
    localRootIdsRef.current = new Set();
    setReplyTo(null);
    clearCommentImages();
  }, [clearCommentImages]);

  /* Community header extras: the mod team (public, for the About card),
     plus join requests and the member list for mods/owners. */
  const loadCommunityExtras = useCallback(async (communityId: string, isMod: boolean, isOwner: boolean) => {
    const { data: modRows } = await supabase
      .from("community_members")
      .select("user_id, role, user:users!user_id(username, display_name, avatar_url)")
      .eq("community_id", communityId)
      .in("role", ["owner", "moderator"]);
    setRailMods(
      ((modRows ?? []) as unknown as Member[])
        .sort((a, b) => (a.role === "owner" ? -1 : 0) - (b.role === "owner" ? -1 : 0))
    );
    if (isMod) {
      const { data: reqs } = await supabase
        .from("community_join_requests")
        .select("user_id, created_at, user:users!user_id(username, display_name, avatar_url)")
        .eq("community_id", communityId);
      setJoinRequests((reqs ?? []) as unknown as JoinRequest[]);
    } else {
      setJoinRequests([]);
    }
    // Every mod sees the member list; promoting/demoting stays owner-only
    // (set_community_role enforces that server-side regardless).
    if (isMod) {
      const { data: mems } = await supabase
        .from("community_members")
        .select("user_id, role, user:users!user_id(username, display_name, avatar_url)")
        .eq("community_id", communityId);
      setMembersList((mems ?? []) as unknown as Member[]);
    } else {
      setMembersList([]);
    }
  }, [supabase]);

  useEffect(() => { if (open) loadCommunities(); }, [open, loadCommunities]);
  useEffect(() => { if (open) loadPosts(); }, [open, loadPosts]);

  const selectedCommunity = useMemo(
    () => communities.find((c) => c.id === selected) ?? null,
    [communities, selected]
  );

  /* Switching boards closes the composer and drops the picked tag —
     a tag from community A must never ride along into community B
     (the validate_post_tag trigger would reject the insert). The
     About card's description also re-collapses. */
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  useEffect(() => {
    setComposing(false);
    setNewTagId("");
    setAboutExpanded(false);
    setRulesExpanded(false);
  }, [selected]);

  useEffect(() => {
    setModOpen(false);
    if (open && selectedCommunity) {
      const isMod = selectedCommunity.my_role === "owner" || selectedCommunity.my_role === "moderator";
      loadCommunityExtras(selectedCommunity.id, isMod, selectedCommunity.my_role === "owner");
      setDraftDescription(selectedCommunity.description ?? "");
      setDraftRules(selectedCommunity.rules ?? "");
      setDraftBookmarks(formatBookmarks(selectedCommunity.bookmarks));
      setDraftPrivate(selectedCommunity.is_private);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedCommunity?.id, selectedCommunity?.my_role]);

  /* The aggregate "All" feed drops posts from communities you've blocked;
     a single board's own view (selected !== "all") is shown in full so you
     can reach it to unblock. */
  const visiblePosts = useMemo(
    () => (selected === "all" ? posts.filter((p) => !myBlocks.has(p.community_id)) : posts),
    [posts, myBlocks, selected]
  );

  /* Deep link from the discovery search / share links / the bell: open a
     specific post. The event arrives right after the Communities nav click,
     so `open` may still be flipping — stash the id and resolve once posts
     are in. */
  const [pendingPostId, setPendingPostId] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const resolvingPostRef = useRef(false);
  const [routeTick, setRouteTick] = useState(0);
  /* /?post=<id>&comment=<cid>: once the post is open, find the comment
     (paging deeper if it isn't in the first 60 threads), expand its
     ancestors, scroll to it and flash it. */
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent).detail?.postId;
      const cid = (e as CustomEvent).detail?.commentId;
      if (typeof id === "string" && id) {
        setSelected("all");
        setOpenPost(null);
        setPendingPostId(id);
        setPendingCommentId(typeof cid === "string" && cid ? cid : null);
      }
    };
    /* Community names elsewhere in the app (room cards, feed rows) route
       here: open that community's home page. */
    const onOpenCommunity = (e: Event) => {
      const id = (e as CustomEvent).detail?.communityId;
      if (typeof id === "string" && id) {
        setOpenPost(null);
        setPendingPostId(null);
        setSelected(id);
      }
    };
    /* URL routes from page.tsx (/communities/<slug>, /posts/<id>): the
       slug resolves against the loaded list below; posts reuse the
       pending-post flow. */
    const onRoute = (e: Event) => {
      const r = (e as CustomEvent).detail as
        | { kind: "community"; slug: string }
        | { kind: "post"; id: string; commentId: string | null };
      if (r?.kind === "community") {
        setPendingPostId(null);
        setPendingCommentId(null);
        setOpenPost(null);
        setPendingSlug(r.slug);
      } else if (r?.kind === "post") {
        setPendingSlug(null);
        setOpenPost(null);
        setPendingPostId(r.id);
        setPendingCommentId(r.commentId ?? null);
      }
    };
    document.addEventListener("agora:open-post", onOpen);
    document.addEventListener("agora:open-community", onOpenCommunity);
    document.addEventListener("agora:route", onRoute);
    return () => {
      document.removeEventListener("agora:open-post", onOpen);
      document.removeEventListener("agora:open-community", onOpenCommunity);
      document.removeEventListener("agora:route", onRoute);
    };
  }, []);
  useEffect(() => {
    if (!pendingSlug || !communitiesLoaded) return;
    const hit = findCommunityBySlug(pendingSlug, communities);
    setPendingSlug(null);
    setSelected(hit ? hit.id : "all");
  }, [pendingSlug, communitiesLoaded, communities]);

  /* Keep the address bar on the board/post being shown. Pushes only when
     the desired path changes and differs from the bar, so popstate-driven
     state (page.tsx re-parses the URL and dispatches agora:route) never
     adds duplicate entries. Skipped while a route is still resolving. */
  const lastPushedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { lastPushedRef.current = null; return; }
    if (pendingSlug || pendingPostId || resolvingPostRef.current) return;
    const board = selected === "all" ? null : communities.find((c) => c.id === selected) ?? null;
    const desired = openPost
      ? pathFor.post(openPost.id)
      : pathFor.community(board ? communitySlug(board, communities) : null);
    setSectionTitle(openPost
      ? `${openPost.title} · AgoraSphere`
      : board ? `${board.name} · AgoraSphere` : "Communities · AgoraSphere");
    const first = lastPushedRef.current === null;
    if (first) lastPushedRef.current = window.location.pathname;
    if (lastPushedRef.current === desired) return;
    lastPushedRef.current = desired;
    if (window.location.pathname === desired) return;
    /* Landing on /communities/<uuid> (or a stale slug): canonicalise in
       place rather than stacking a second entry. */
    if (first && /^\/(communities|posts)\//.test(window.location.pathname)) {
      window.history.replaceState(null, "", desired + window.location.hash);
    } else {
      window.history.pushState(null, "", desired);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected, openPost, communities, pendingSlug, pendingPostId, routeTick]);
  useEffect(() => {
    if (!open || !pendingPostId || loadingPosts) return;
    const hit = posts.find((p) => p.id === pendingPostId);
    if (hit) {
      openPostDetail(hit);
      setPendingPostId(null);
      return;
    }
    /* Older than the loaded page — fetch the single post via RPC, which
       returns the same row shape as the feed (real score/my_vote/counts). */
    const id = pendingPostId;
    setPendingPostId(null);
    resolvingPostRef.current = true;
    (async () => {
      const { data } = await supabase.rpc("get_community_post", { p_post: id });
      resolvingPostRef.current = false;
      const row = (data as Post[] | null)?.[0];
      if (!row) { setRouteTick((t) => t + 1); return; } // re-sync the URL to the board
      fetchAvatars([row.author_id]);
      openPostDetail(row);
    })();
  }, [open, pendingPostId, loadingPosts, posts, openPostDetail, fetchAvatars, supabase]);

  useEscapeClose(open, () => (repostFor ? setRepostFor(null) : openPost ? closePostDetail() : onClose()));

  /* ── actions ── */

  const vote = useCallback(async (post: Post, value: number) => {
    if (!requireAuth()) return;
    const prev = { score: post.score, my_vote: post.my_vote };
    const delta = value - (post.my_vote ?? 0);
    const apply = (p: Post): Post =>
      p.id === post.id ? { ...p, score: p.score + delta, my_vote: value === 0 ? null : value } : p;
    setPosts((ps) => ps.map(apply));
    setOpenPost((p) => (p && p.id === post.id ? apply(p) : p));
    const { error: err } = await supabase.rpc("vote_post", { p_post: post.id, p_value: value });
    if (err) {
      const rollback = (p: Post): Post =>
        p.id === post.id ? { ...p, score: prev.score, my_vote: prev.my_vote } : p;
      setPosts((ps) => ps.map(rollback));
      setOpenPost((p) => (p && p.id === post.id ? rollback(p) : p));
      setError(err.message.includes("suspended") ? "Your account is suspended." : "Vote failed — try again.");
    }
  }, [supabase, requireAuth]);

  const voteComment = useCallback(async (comment: Comment, value: number) => {
    if (!requireAuth()) return;
    const prev = { score: comment.score, my_vote: comment.my_vote };
    const delta = value - (comment.my_vote ?? 0);
    setComments((cs) => cs.map((c) =>
      c.id === comment.id ? { ...c, score: c.score + delta, my_vote: value === 0 ? null : value } : c));
    const { error: err } = await supabase.rpc("vote_comment", { p_comment: comment.id, p_value: value });
    if (err) {
      setComments((cs) => cs.map((c) =>
        c.id === comment.id ? { ...c, score: prev.score, my_vote: prev.my_vote } : c));
      setError(err.message.includes("suspended") ? "Your account is suspended." : "Vote failed — try again.");
    }
  }, [supabase, requireAuth]);

  const pickImage = useCallback((file: File | null) => {
    setNewImage(file);
    if (file) setNewGifUrl(null); // one attachment at a time
    setNewImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }, []);

  const pickCommentImage = useCallback((file: File | null) => {
    setCommentImage(file);
    setCommentImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }, []);

  const pickReplyImage = useCallback((file: File | null) => {
    setReplyImage(file);
    setReplyImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }, []);

  const submitPost = useCallback(async () => {
    if (!requireAuth()) return;
    const communityId = selected !== "all" ? selected : composeCommunity;
    const title = newTitle.trim();
    if (!communityId || !title) return;
    if (newBody.length > BODY_MAX) { setError(`Post body is too long (${newBody.length.toLocaleString()} / ${BODY_MAX.toLocaleString()} characters).`); return; }
    setBusy(true);
    let imageUrl: string | null = null;
    if (newImage && userId) {
      try {
        imageUrl = await uploadPostImage(supabase, userId, newImage);
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : "Image upload failed.");
        return;
      }
    }
    const { error: err } = await supabase.from("community_posts").insert({
      community_id: communityId,
      author_id: userId,
      title,
      body: newBody.trim() || null,
      tag_id: newTagId || null,
      image_url: imageUrl ?? newGifUrl,
    });
    setBusy(false);
    if (err) {
      setError(err.message.includes("rate_limited")
        ? "You're posting too quickly — try again in a few minutes."
        : err.message);
      return;
    }
    setComposing(false);
    try { window.localStorage.setItem("agora:lastPostCommunity", composeCommunity); } catch {}
    setNewTitle(""); setNewBody(""); setNewTagId("");
    setNewGifUrl(null);
    pickImage(null);
    loadPosts();
  }, [supabase, requireAuth, selected, composeCommunity, newTitle, newBody, newTagId, newImage, newGifUrl, userId, loadPosts, pickImage]);

  const submitComment = useCallback(async (parentId: string | null, body: string, image: File | null, gif: string | null = null) => {
    if (busy || !openPost || !requireAuth()) return; // busy: Enter can auto-repeat
    const text = body.trim();
    if (!text) return;
    if (text.length > BODY_MAX) { setError(`Comment is too long (${text.length.toLocaleString()} / ${BODY_MAX.toLocaleString()} characters).`); return; }
    setBusy(true);
    let imageUrl: string | null = null;
    if (image && userId) {
      try {
        imageUrl = await uploadPostImage(supabase, userId, image);
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : "Image upload failed.");
        return;
      }
    }
    const { data: inserted, error: err } = await supabase.from("community_comments").insert({
      post_id: openPost.id,
      parent_id: parentId,
      author_id: userId,
      body: text,
      image_url: imageUrl ?? gif,
    }).select("id, created_at, image_url").single();
    setBusy(false);
    if (err) {
      setError(err.message.includes("rate_limited")
        ? "Slow down — you're commenting too quickly."
        : err.message);
      return;
    }
    setCommentText(""); setReplyTo(null); setReplyText("");
    setCommentGifUrl(null); setReplyGifUrl(null);
    pickCommentImage(null); pickReplyImage(null);
    /* Append the new comment locally instead of refetching — a refetch
       would reset the section to page 1, and a new top-level comment
       sorts last server-side so page 1 might not even contain it. */
    const me = await getMyIdentity();
    if (inserted && me) {
      const mine: Comment = {
        id: inserted.id,
        post_id: openPost.id,
        parent_id: parentId,
        author_id: userId,
        author_username: me.username,
        author_display_name: me.display_name,
        body: text,
        created_at: inserted.created_at,
        score: 0,
        my_vote: null,
        author_role: communities.find((x) => x.id === openPost.community_id)?.my_role ?? null,
        image_url: inserted.image_url,
        pinned_at: null,
      };
      if (openPostIdRef.current === openPost.id) {
        if (!parentId) localRootIdsRef.current.add(mine.id);
        setComments((cs) => (cs.some((c) => c.id === mine.id) ? cs : [...cs, mine]));
        if (userId) fetchAvatars([userId]);
      }
    } else {
      // Couldn't read the row back — fall back to the full refetch.
      loadComments(openPost.id);
    }
    const bump = (p: Post): Post =>
      p.id === openPost.id ? { ...p, comment_count: p.comment_count + 1 } : p;
    setPosts((ps) => ps.map(bump));
    setOpenPost((p) => (p ? bump(p) : p));
  }, [busy, supabase, requireAuth, openPost, userId, communities, getMyIdentity, fetchAvatars, loadComments, pickCommentImage, pickReplyImage]);

  /* Mods can delete anything in their board (RLS-backed). */
  const canModerate = useCallback((communityId: string): boolean => {
    const c = communities.find((x) => x.id === communityId);
    return c?.my_role === "owner" || c?.my_role === "moderator";
  }, [communities]);

  const deletePost = useCallback(async (post: Post) => {
    if (!confirm("Delete this post? Its comments go with it.")) return;
    const { error: err } = await supabase.from("community_posts").delete().eq("id", post.id);
    if (!err) {
      closePostDetail();
      setPosts((ps) => ps.filter((p) => p.id !== post.id));
    }
  }, [supabase, closePostDetail]);

  const deleteComment = useCallback(async (comment: Comment) => {
    if (!openPost) return;
    if (!confirm("Delete this comment? Replies to it go with it.")) return;
    const { error: err } = await supabase.from("community_comments").delete().eq("id", comment.id);
    if (!err) loadComments(openPost.id);
  }, [supabase, openPost, loadComments]);

  /* Join / request / leave. Private boards go through join requests. */
  const toggleJoin = useCallback(async (c: Community) => {
    if (!requireAuth()) return;
    if (c.joined) {
      if (c.my_role === "owner") {
        setError("Owners can't leave their own community.");
        return;
      }
      await supabase.from("community_members").delete()
        .eq("community_id", c.id).eq("user_id", userId!);
    } else if (c.is_private) {
      if (c.requested) {
        await supabase.from("community_join_requests").delete()
          .eq("community_id", c.id).eq("user_id", userId!);
      } else {
        const { error: err } = await supabase.rpc("request_to_join", { p_community: c.id });
        if (err) { setError(err.message); return; }
      }
    } else {
      await supabase.from("community_members").insert({ community_id: c.id, user_id: userId });
    }
    loadCommunities();
  }, [supabase, requireAuth, userId, loadCommunities]);

  const createCommunity = useCallback(async () => {
    if (!requireAuth()) return;
    const name = newCommunityName.trim();
    if (!name) return;
    const { data, error: err } = await supabase
      .from("communities")
      .insert({ name, kind: newCommunityKind, created_by: userId, is_private: newCommunityPrivate })
      .select("id")
      .single();
    if (!err && data) {
      await supabase.from("community_members").insert({ community_id: data.id, user_id: userId, role: "owner" });
      setCreatingCommunity(false);
      setNewCommunityName("");
      setNewCommunityPrivate(false);
      setSelected(data.id);
      loadCommunities();
    }
  }, [supabase, requireAuth, newCommunityName, newCommunityKind, newCommunityPrivate, userId, loadCommunities]);

  /* Share: copy a deep link that reopens this post (handled in page.tsx). */
  const [copiedCommentId, setCopiedCommentId] = useState<string | null>(null);
  const shareComment = useCallback(async (c: Comment) => {
    const url = `${window.location.origin}${pathFor.post(c.post_id, c.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCommentId(c.id);
      setTimeout(() => setCopiedCommentId((id) => (id === c.id ? null : id)), 1600);
    } catch {
      setError("Couldn't copy the link — copy it from the address bar instead.");
    }
  }, []);

  const sharePost = useCallback(async (post: Post) => {
    const url = `${window.location.origin}${pathFor.post(post.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(post.id);
      setTimeout(() => setCopiedId((id) => (id === post.id ? null : id)), 1600);
    } catch {
      setError("Couldn't copy the link — copy it from the address bar instead.");
    }
  }, []);

  const submitRepost = useCallback(async () => {
    if (!repostFor || !requireAuth() || !repostCommunity) return;
    setBusy(true);
    const { error: err } = await supabase.rpc("repost_post", {
      p_post: repostFor.id,
      p_community: repostCommunity,
      p_body: repostComment.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(
        err.message.includes("private_source") ? "Posts in private communities can't be shared out."
        : err.message.includes("same_community") ? "That post already lives in that community."
        : err.message.includes("rate_limited") ? "You're posting too quickly — try again in a few minutes."
        : err.message);
      return;
    }
    setRepostFor(null);
    setRepostComment("");
    loadPosts();
  }, [supabase, requireAuth, repostFor, repostCommunity, repostComment, loadPosts]);

  /* ── mod actions ── */

  const saveSettings = useCallback(async () => {
    if (!selectedCommunity) return;
    setBusy(true);
    const { error: err } = await supabase.rpc("update_community_settings", {
      p_community: selectedCommunity.id,
      p_description: draftDescription.trim() || "",
      p_rules: draftRules.trim() || "",
      p_is_private: selectedCommunity.my_role === "owner" ? draftPrivate : null,
    });
    if (!err) {
      const { error: bmErr } = await supabase.rpc("set_community_bookmarks", {
        p_community: selectedCommunity.id,
        p_bookmarks: parseBookmarks(draftBookmarks),
      });
      if (bmErr) { setBusy(false); setError(bmErr.message); return; }
    }
    setBusy(false);
    if (err) { setError(err.message); return; }
    loadCommunities();
  }, [supabase, selectedCommunity, draftDescription, draftRules, draftBookmarks, draftPrivate, loadCommunities]);

  /* Branding: banner (wide) and avatar (square-cropped) upload to the
     post-images bucket, then the guarded settings RPC stores the URL.
     Passing '' clears a slot back to the color/letter fallback. */
  const [brandingBusy, setBrandingBusy] = useState<"banner" | "avatar" | null>(null);
  const setBranding = useCallback(async (kind: "banner" | "avatar", file: File | null) => {
    if (!selectedCommunity || !userId) return;
    setBrandingBusy(kind);
    try {
      let url = "";
      if (file) {
        url = kind === "banner"
          ? await uploadPostImage(supabase, userId, file)
          : await uploadSquareImage(supabase, userId, file);
      }
      const { error: err } = await supabase.rpc("update_community_settings", {
        p_community: selectedCommunity.id,
        ...(kind === "banner" ? { p_banner_url: url } : { p_avatar_url: url }),
      });
      if (err) throw new Error(err.message);
      loadCommunities();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image upload failed.");
    } finally {
      setBrandingBusy(null);
    }
  }, [supabase, selectedCommunity, userId, loadCommunities]);

  /* Bumps whenever a mod action lands so the bans/log panels refetch. */
  const [modRefresh, setModRefresh] = useState(0);

  /* Ban a plain member (mods; owners/mods are refused server-side). */
  const banMember = useCallback(async (m: Member) => {
    if (!selectedCommunity) return;
    const name = m.user?.display_name?.trim() || `@${m.user?.username ?? "user"}`;
    const reason = prompt(`Ban ${name} from ${selectedCommunity.name}? Optional reason:`);
    if (reason === null) return; // cancelled
    const { error: err } = await supabase.rpc("ban_community_member", {
      p_community: selectedCommunity.id,
      p_user: m.user_id,
      p_reason: reason.trim() || null,
    });
    if (err) { setError(err.message); return; }
    setMembersList((ms) => ms.filter((x) => x.user_id !== m.user_id));
    setModRefresh((k) => k + 1);
    loadCommunities();
  }, [supabase, selectedCommunity, loadCommunities]);

  /* Per-community notification mute — own-row toggle on community_mutes. */
  const toggleMute = useCallback(async (communityId: string) => {
    if (!requireAuth() || !userId) return;
    const muted = myMutes.has(communityId);
    setMyMutes((s) => {
      const next = new Set(s);
      if (muted) next.delete(communityId); else next.add(communityId);
      return next;
    });
    const { error: err } = muted
      ? await supabase.from("community_mutes").delete()
          .eq("community_id", communityId).eq("user_id", userId)
      : await supabase.from("community_mutes")
          .insert({ community_id: communityId, user_id: userId });
    if (err) {
      setMyMutes((s) => {
        const next = new Set(s);
        if (muted) next.add(communityId); else next.delete(communityId);
        return next;
      });
      setError("Couldn't update notifications — try again.");
    }
  }, [supabase, requireAuth, userId, myMutes]);

  /* Block / unblock a community. Blocking leaves the board and hides it
     from browse + feed (server-side in set_community_block); a follow-up
     loadCommunities refreshes joined/blocked flags. */
  const toggleBlock = useCallback(async (c: Community) => {
    if (!requireAuth()) return;
    const next = !c.blocked;
    if (next && c.my_role === "owner") {
      setError("You own this community — you can't block it.");
      return;
    }
    setMyBlocks((s) => {
      const n = new Set(s);
      if (next) n.add(c.id); else n.delete(c.id);
      return n;
    });
    const { error: err } = await supabase.rpc("set_community_block", { p_community: c.id, p_blocked: next });
    if (err) {
      setMyBlocks((s) => {
        const n = new Set(s);
        if (next) n.delete(c.id); else n.add(c.id);
        return n;
      });
      setError(err.message.includes("owner_cannot_block") ? "You own this community — you can't block it." : "Couldn't update — try again.");
      return;
    }
    loadCommunities();
  }, [supabase, requireAuth, loadCommunities]);

  /* Mods pin/unpin posts; pinned posts lead their board's feed. */
  const togglePostPin = useCallback(async (post: Post) => {
    const pinned = !post.pinned_at;
    const { error: err } = await supabase.rpc("set_post_pinned", {
      p_post: post.id, p_pinned: pinned,
    });
    if (err) { setError(err.message); return; }
    const stamp = pinned ? new Date().toISOString() : null;
    setOpenPost((p) => (p && p.id === post.id ? { ...p, pinned_at: stamp } : p));
    loadPosts();
  }, [supabase, loadPosts]);

  /* Mods pin/unpin root comments; pinned threads float to the top. */
  const togglePin = useCallback(async (comment: Comment) => {
    const pinned = !comment.pinned_at;
    const { error: err } = await supabase.rpc("set_comment_pinned", {
      p_comment: comment.id, p_pinned: pinned,
    });
    if (err) { setError(err.message); return; }
    setComments((cs) => cs.map((c) =>
      c.id === comment.id ? { ...c, pinned_at: pinned ? new Date().toISOString() : null } : c));
  }, [supabase]);

  const createTag = useCallback(async () => {
    if (!selectedCommunity || !userId) return;
    const name = newTagName.trim();
    if (!name) return;
    const { error: err } = await supabase.from("community_tags").insert({
      community_id: selectedCommunity.id, name, color: newTagColor, created_by: userId,
    });
    if (err) {
      setError(err.message.includes("duplicate") ? "That tag already exists." : err.message);
      return;
    }
    setNewTagName("");
    loadCommunities();
  }, [supabase, selectedCommunity, userId, newTagName, newTagColor, loadCommunities]);

  const deleteTag = useCallback(async (tag: Tag) => {
    await supabase.from("community_tags").delete().eq("id", tag.id);
    loadCommunities();
  }, [supabase, loadCommunities]);

  const handleRequest = useCallback(async (targetUserId: string, approve: boolean) => {
    if (!selectedCommunity) return;
    const { error: err } = await supabase.rpc(
      approve ? "approve_join_request" : "deny_join_request",
      { p_community: selectedCommunity.id, p_user: targetUserId }
    );
    if (err) { setError(err.message); return; }
    setJoinRequests((rs) => rs.filter((r) => r.user_id !== targetUserId));
    if (approve) {
      loadCommunities();
      // The new member should appear in the owner's roles list right away.
      const mod = selectedCommunity.my_role === "owner" || selectedCommunity.my_role === "moderator";
      loadCommunityExtras(selectedCommunity.id, mod, selectedCommunity.my_role === "owner");
    }
  }, [supabase, selectedCommunity, loadCommunities, loadCommunityExtras]);

  const setRole = useCallback(async (targetUserId: string, role: "moderator" | "member") => {
    if (!selectedCommunity) return;
    const { error: err } = await supabase.rpc("set_community_role", {
      p_community: selectedCommunity.id, p_user: targetUserId, p_role: role,
    });
    if (err) { setError(err.message); return; }
    setMembersList((ms) => ms.map((m) => (m.user_id === targetUserId ? { ...m, role } : m)));
    loadCommunities();
  }, [supabase, selectedCommunity, loadCommunities]);

  /* ── derived ── */

  // True threading: parent_id -> children, siblings sorted by the active
  // comment sort (top = score desc, then oldest; new = newest first).
  const commentTree = useMemo(() => {
    const roots: Comment[] = [];
    const children = new Map<string, Comment[]>();
    for (const c of comments) {
      if (!c.parent_id) roots.push(c);
      else {
        const list = children.get(c.parent_id) ?? [];
        list.push(c);
        children.set(c.parent_id, list);
      }
    }
    const bySort = (a: Comment, b: Comment) =>
      commentSort === "top"
        ? b.score - a.score || +new Date(a.created_at) - +new Date(b.created_at)
        : +new Date(b.created_at) - +new Date(a.created_at);
    // Pinned roots float above everything, oldest pin first.
    roots.sort((a, b) => {
      if (!!a.pinned_at !== !!b.pinned_at) return a.pinned_at ? -1 : 1;
      if (a.pinned_at && b.pinned_at) return +new Date(a.pinned_at) - +new Date(b.pinned_at);
      return bySort(a, b);
    });
    for (const list of children.values()) list.sort(bySort);
    const subtreeSize = (id: string): number => {
      const direct = children.get(id) ?? [];
      return direct.reduce((n, d) => n + 1 + subtreeSize(d.id), 0);
    };
    return { roots, children, subtreeSize };
  }, [comments, commentSort]);

  const composerTags = useMemo(() => {
    const target = selected !== "all" ? selected : composeCommunity;
    return tagsByCommunity[target] ?? [];
  }, [selected, composeCommunity, tagsByCommunity]);

  /* Locked out of a private board: rail shows it, feed shows the lock. */
  const lockedOut = !!selectedCommunity?.is_private && !selectedCommunity?.joined;

  if (!open) return null;

  /* ── render helpers ── */

  const MAX_INDENT = 5;

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* The embedded original inside a repost card. */
  const repostEmbed = (p: Post) => {
    if (!p.is_repost) return null;
    if (!p.repost_of) {
      return (
        <p className="m-0 px-3 py-2 text-[11.5px] rounded-lg"
          style={{ background: "rgba(255,255,255,0.03)", border: "0.5px dashed rgba(255,255,255,0.14)", color: "rgba(238,238,245,0.32)", marginTop: 10 }}>
          The original post was unavailable or deleted.
        </p>
      );
    }
    return (
      <div
        className="rounded-lg cursor-pointer"
        style={{
          background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.1)",
          marginTop: 10, padding: "10px 12px 11px",
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (p.repost_of) {
            setOpenPost(null);
            setPendingPostId(p.repost_of);
          }
        }}
      >
        <p className="m-0 text-[10px] inline-flex items-center gap-1" style={{ color: "rgba(238,238,245,0.5)" }}>
          <Icon name="repeat" size={11} /> from <span style={{ color: "#e2b96b" }}>{p.orig_community_name ?? "a community"}</span>
          {p.orig_author_username && <> · {authorLabel(p.orig_author_display_name, p.orig_author_username)}</>}
        </p>
        <p className="m-0 text-[12.5px] font-medium" style={{ color: "rgba(238,238,245,0.88)", marginTop: 5 }}>
          <RichText text={p.orig_title ?? ""} inline />
        </p>
        {p.orig_body && (
          <div className="text-[11.5px]" style={{
            color: "rgba(238,238,245,0.55)", marginTop: 4, lineHeight: 1.5,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            <RichText text={p.orig_body} />
          </div>
        )}
        {p.orig_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.orig_image_url} alt="" className="mt-1.5 rounded-lg"
            style={{ maxHeight: 160, maxWidth: "100%", objectFit: "cover" }} />
        )}
      </div>
    );
  };

  /* Share / repost / delete row under a post. */
  const postActions = (p: Post, inDetail: boolean) => (
    <span className="flex items-center gap-3">
      <button
        onClick={(e) => { e.stopPropagation(); sharePost(p); }}
        className="cursor-pointer bg-transparent border-none p-0 text-[12px] inline-flex items-center gap-1"
        style={{ color: copiedId === p.id ? "#00b894" : "rgba(238,238,245,0.55)", fontFamily: "inherit" }}
      >
        {copiedId === p.id ? <><Icon name="check" size={14} /> Link copied</> : <><Icon name="share" size={14} /> Share</>}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!requireAuth()) return;
          setRepostFor(p);
          setRepostComment("");
          const options = communities.filter((c) => c.joined && c.id !== p.community_id);
          setRepostCommunity(options[0]?.id ?? "");
        }}
        className="cursor-pointer bg-transparent border-none p-0 text-[12px] inline-flex items-center gap-1"
        style={{ color: "rgba(238,238,245,0.55)", fontFamily: "inherit" }}
      >
        <Icon name="repeat" size={14} /> Repost
      </button>
      {canModerate(p.community_id) && (
        <button
          onClick={(e) => { e.stopPropagation(); togglePostPin(p); }}
          className="cursor-pointer bg-transparent border-none p-0 text-[12px] inline-flex items-center gap-1"
          style={{ color: "#4a9eff", fontFamily: "inherit" }}
        >
          {p.pinned_at ? "Unpin" : <><Icon name="pin" size={14} /> Pin</>}
        </button>
      )}
      {(p.author_id === userId || canModerate(p.community_id)) && (
        <button
          onClick={(e) => { e.stopPropagation(); deletePost(p); }}
          className="cursor-pointer bg-transparent border-none p-0 text-[12px] inline-flex items-center gap-1"
          style={{ color: p.author_id === userId ? "rgba(238,238,245,0.55)" : "#e2b96b", fontFamily: "inherit" }}
        >
          {p.author_id === userId ? "Delete" : "Remove (mod)"}
        </button>
      )}
      {!inDetail && (
        <span className="text-[12px] inline-flex items-center gap-1" style={{ color: "rgba(238,238,245,0.55)" }}>
          <Icon name="message-circle" size={14} /> {p.comment_count} comment{p.comment_count === 1 ? "" : "s"}
        </span>
      )}
    </span>
  );

  /* One thread node: collapse toggle, vote pips, body, actions, reply
     box, then children — visual indent caps at MAX_INDENT so deep
     chains stay readable while true nesting is preserved. */
  const renderThread = (c: Comment, depth: number): React.ReactNode => {
    const kids = commentTree.children.get(c.id) ?? [];
    const isCollapsed = collapsed.has(c.id);
    const hidden = commentTree.subtreeSize(c.id);
    return (
      <div key={c.id} className="cm-node" id={`comment-${c.id}`}>
        <div className="px-4 py-3" style={{
          ...card, borderRadius: 14,
          ...(flashCommentId === c.id
            ? { boxShadow: "0 0 0 1px rgba(226,185,107,0.55), 0 0 18px rgba(226,185,107,0.18)", transition: "box-shadow 0.3s" }
            : { transition: "box-shadow 1.2s" }),
        }}>
            <div className="flex items-center gap-2 flex-wrap">
              {kids.length > 0 && (
                <button
                  onClick={() => toggleCollapse(c.id)}
                  className="cursor-pointer bg-transparent border-none p-0 text-[11px]"
                  style={{ color: "rgba(238,238,245,0.32)", fontFamily: "inherit", width: 16 }}
                  aria-label={isCollapsed ? "Expand thread" : "Collapse thread"}
                >
                  {isCollapsed ? "[+]" : "[–]"}
                </button>
              )}
              <span className="text-[11px]" style={{ color: "rgba(238,238,245,0.5)" }}>
                {authorSpan(c.author_id, c.author_username, c.author_display_name)} · {timeAgo(c.created_at)}
              </span>
              <RoleBadge role={c.author_role} />
              {c.pinned_at && (
                <span className="text-[9.5px] font-bold px-1.5 rounded" style={{
                  background: "rgba(74,158,255,0.12)", border: "0.5px solid rgba(74,158,255,0.35)",
                  color: "#4a9eff", padding: "1px 6px", letterSpacing: "0.04em",
                }}>
                  <Icon name="pin" size={10} /> PINNED
                </span>
              )}
              {isCollapsed && hidden > 0 && (
                <span className="text-[10px]" style={{ color: "#e2b96b" }}>
                  {hidden} repl{hidden === 1 ? "y" : "ies"} hidden
                </span>
              )}
            </div>
            {!isCollapsed && (
              <>
                <div className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "rgba(238,238,245,0.88)" }}>
                  <RichText text={c.body} />
                </div>
                {c.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.image_url} alt="" className="mt-1.5 rounded-lg"
                    style={{ maxHeight: 260, maxWidth: "100%" }} />
                )}
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="flex items-center gap-1">
                    <button
                      onClick={() => voteComment(c, c.my_vote === 1 ? 0 : 1)}
                      className="cursor-pointer bg-transparent border-none p-0 text-[11px]"
                      style={{ color: c.my_vote === 1 ? "#e2b96b" : "rgba(238,238,245,0.32)" }}
                      aria-label="Upvote comment"
                    >
                      ▲
                    </button>
                    <span className="text-[11px]" style={{ color: "rgba(238,238,245,0.65)", fontWeight: 600, minWidth: 12, textAlign: "center" }}>
                      {c.score}
                    </span>
                    <button
                      onClick={() => voteComment(c, c.my_vote === -1 ? 0 : -1)}
                      className="cursor-pointer bg-transparent border-none p-0 text-[11px]"
                      style={{ color: c.my_vote === -1 ? "#64B5F6" : "rgba(238,238,245,0.32)" }}
                      aria-label="Downvote comment"
                    >
                      ▼
                    </button>
                  </span>
                  <button
                    onClick={() => { if (requireAuth()) { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(""); pickReplyImage(null); setReplyGifUrl(null); } }}
                    className="cursor-pointer bg-transparent border-none p-0 text-[10px]"
                    style={{ color: "#4a9eff", fontFamily: "inherit" }}
                  >
                    Reply
                  </button>
                  <button
                    onClick={() => shareComment(c)}
                    className="cursor-pointer bg-transparent border-none p-0 text-[10px] inline-flex items-center gap-1"
                    style={{ color: copiedCommentId === c.id ? "#00b894" : "rgba(238,238,245,0.45)", fontFamily: "inherit" }}
                  >
                    {copiedCommentId === c.id ? <><Icon name="check" size={11} /> Link copied</> : <><Icon name="share" size={11} /> Share</>}
                  </button>
                  {/* Mods pin root comments (children live under parents). */}
                  {!c.parent_id && openPost && canModerate(openPost.community_id) && (
                    <button
                      onClick={() => togglePin(c)}
                      className="cursor-pointer bg-transparent border-none p-0 text-[10px]"
                      style={{ color: "#4a9eff", fontFamily: "inherit" }}
                    >
                      {c.pinned_at ? "Unpin" : <><Icon name="pin" size={12} /> Pin</>}
                    </button>
                  )}
                  {(c.author_id === userId || (openPost && canModerate(openPost.community_id))) && (
                    <button
                      onClick={() => deleteComment(c)}
                      className="cursor-pointer bg-transparent border-none p-0 text-[10px]"
                      style={{ color: c.author_id === userId ? "rgba(238,238,245,0.32)" : "#e2b96b", fontFamily: "inherit" }}
                    >
                      {c.author_id === userId ? "Delete" : "Remove (mod)"}
                    </button>
                  )}
                </div>
                {replyTo === c.id && (
                  <div className="mt-2">
                    <div className="flex gap-2 items-end">
                      <span className="relative flex-1 min-w-0">
                        <RichEditor
                          ref={replyInputRef}
                          compact
                          autoFocus
                          value={replyText}
                          onChange={setReplyText}
                          placeholder={`Reply to @${c.author_username}… (⌘↩ to send)`}
                          onSubmit={() => submitComment(c.id, replyText, replyImage, replyGifUrl)}
                          onImage={() => replyImageInputRef.current?.click()}
                          onGif={giphyEnabled ? () => setGifPickerFor(gifPickerFor === "reply" ? null : "reply") : undefined}
                          onEmoji={() => setEmojiFor(emojiFor === "reply" ? null : "reply")}
                          trailing={
                            <span className="relative inline-block" style={{ alignSelf: "stretch" }}>
                              {emojiFor === "reply" && (
                                <EmojiPicker
                                  onPick={(e) => replyInputRef.current?.insertText(e)}
                                  onClose={() => setEmojiFor(null)}
                                />
                              )}
                              {gifPickerFor === "reply" && (
                                <GifPicker
                                  onPick={(u) => { setReplyGifUrl(u); pickReplyImage(null); setGifPickerFor(null); }}
                                  onClose={() => setGifPickerFor(null)}
                                />
                              )}
                            </span>
                          }
                        />
                        <input ref={replyImageInputRef} type="file" accept="image/*" className="hidden"
                          onChange={(e) => { pickReplyImage(e.target.files?.[0] ?? null); setReplyGifUrl(null); e.target.value = ""; }} />
                      </span>
                      <button
                        onClick={() => submitComment(c.id, replyText, replyImage, replyGifUrl)}
                        disabled={busy || !replyText.trim()}
                        className="cursor-pointer text-[11px] px-3 rounded-lg shrink-0 disabled:opacity-50 disabled:cursor-default"
                        style={{ ...btnBlue, borderRadius: 10, height: 40 }}
                      >
                        Reply
                      </button>
                    </div>
                    {replyGifUrl && (
                      <span className="inline-flex items-center gap-2 mt-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={replyGifUrl} alt="" className="rounded" style={{ height: 40 }} />
                        <button onClick={() => setReplyGifUrl(null)}
                          className="cursor-pointer bg-transparent border-none p-0 text-[10.5px]" style={{ color: "rgba(238,238,245,0.32)" }}>
                          remove
                        </button>
                      </span>
                    )}
                    {replyImagePreview && (
                      <span className="inline-flex items-center gap-2 mt-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={replyImagePreview} alt="" className="rounded" style={{ height: 36 }} />
                        <button onClick={() => pickReplyImage(null)}
                          className="cursor-pointer bg-transparent border-none p-0 text-[10.5px]" style={{ color: "rgba(238,238,245,0.32)" }}>
                          remove
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
        </div>
        {!isCollapsed && kids.length > 0 && (
          <div className={depth < MAX_INDENT ? "cm-children" : "cm-children cm-children--flat"}>
            {kids.map((k) => (
              <div key={k.id} className="cm-child">
                {renderThread(k, depth + 1)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const isMod = selectedCommunity?.my_role === "owner" || selectedCommunity?.my_role === "moderator";
  const isOwner = selectedCommunity?.my_role === "owner";

  return (
    <div
      className="fixed overflow-y-auto"
      style={{
        top: "var(--nav-height)",
        left: "calc(var(--sidebar-width) + 12px)",
        right: 0,
        bottom: 0,
        zIndex: 50,
        fontFamily: "'DM Sans', sans-serif",
        /* Translucent veil instead of solid: the homepage star canvas
           lives behind this overlay (the MVP main content is hidden
           while a tab is open), so the sky shows through. */
        background: "rgba(6,6,8,0.45)",
      }}
    >
      <div className="max-w-[1200px] mx-auto px-6 py-5">

        {/* header — matches the homepage section-title treatment; clicking
            it returns to the All-posts feed */}
        <div className="flex items-end gap-3.5 mb-5 flex-wrap">
          {(openPost || selected !== "all") && (
            <button
              onClick={() => {
                if (openPost) {
                  const target = backTargetRef.current;
                  closePostDetail();
                  setSelected(communities.some((c) => c.id === target) ? target : "all");
                } else {
                  setSelected("all");
                }
              }}
              title={openPost ? "Back" : "Back to all posts"}
              aria-label="Back"
              className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-full self-center"
              style={{ border: "0.5px solid #2e2e38", background: "rgba(11,11,13,0.95)", color: "#eeeef5", fontSize: 12, fontFamily: "inherit", marginBottom: 2 }}
            >
              <Icon name="arrow-left" size={14} />
              Back
            </button>
          )}
          <span
            className="flex flex-col cursor-pointer"
            style={{ gap: 6 }}
            title="Back to all posts"
            onClick={() => { closePostDetail(); setSelected("all"); }}
          >
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 22, color: "#eeeef5", lineHeight: 1 }}>
              Communities
            </span>
            <span style={{ display: "block", width: 28, height: 2, background: "#e2b96b", borderRadius: 2 }} />
          </span>
          <span className="text-[12px]" style={{ color: "rgba(238,238,245,0.45)", paddingBottom: 2 }}>
            Boards for your school, team, or topic
          </span>
          <button
            onClick={() => { if (requireAuth()) setCreatingCommunity((v) => !v); }}
            className="cursor-pointer text-[12px] font-medium px-4 py-1.5 rounded-full border-none ml-auto"
            style={{ background: "#ffb700", color: "#1a0e00" }}
          >
            + New community
          </button>
        </div>

        {error && (
          <p className="mb-3 px-4 py-2.5 rounded-lg text-[12px]"
            style={{ background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
            {error}
            <button onClick={() => setError(null)} className="ml-3 cursor-pointer bg-transparent border-none text-[11px]" style={{ color: "rgba(238,238,245,0.5)" }}>
              dismiss
            </button>
          </p>
        )}

        {creatingCommunity && (
          <div className="p-4 mb-4 flex gap-3 items-center flex-wrap" style={card}>
            <input
              value={newCommunityName}
              onChange={(e) => setNewCommunityName(e.target.value)}
              placeholder="Community name"
              style={{ ...inputStyle, width: "auto", flex: 1, minWidth: 200 }}
            />
            <select
              value={newCommunityKind}
              onChange={(e) => setNewCommunityKind(e.target.value)}
              className="text-[13px] px-3 py-2 rounded-lg"
              style={{ background: "rgba(16,16,19,0.7)", border: "0.5px solid rgba(255,255,255,0.1)", color: "rgba(238,238,245,0.88)" }}
            >
              {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: "rgba(238,238,245,0.65)" }}>
              <input
                type="checkbox"
                checked={newCommunityPrivate}
                onChange={(e) => setNewCommunityPrivate(e.target.checked)}
              />
              <Icon name="lock" size={12} /> Private
            </label>
            <button
              onClick={createCommunity}
              disabled={!newCommunityName.trim()}
              className="cursor-pointer text-[12px] px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-default"
              style={btnBlue}
            >
              Create
            </button>
          </div>
        )}

        {/* Reddit-style split: feed left, rail right (rail first on mobile). */}
        <div className="flex gap-5 items-start flex-col md:flex-row-reverse">

          {/* community rail — right side */}
          <nav className="w-full md:w-[310px] shrink-0">
            {/* About card — the open board's name and description, up top */}
            {selectedCommunity && (
              <div className="mb-3 overflow-hidden" style={{
                background: "rgba(14,14,17,0.72)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 12,
              }}>
                <div className="px-3.5" style={{ paddingTop: 14, paddingBottom: 18 }}>
                  <p className="m-0 text-[9.5px] font-bold flex items-center" style={{ color: "rgba(238,238,245,0.35)", letterSpacing: "0.09em", marginBottom: 10 }}>
                    ABOUT COMMUNITY
                    {selectedCommunity.joined && (
                      <button
                        onClick={() => toggleMute(selectedCommunity.id)}
                        title={myMutes.has(selectedCommunity.id)
                          ? "Notifications muted — click to unmute"
                          : "Notifying you about new posts — click to mute"}
                        className="cursor-pointer bg-transparent border-none p-0 ml-auto"
                        style={{ fontSize: 12, opacity: myMutes.has(selectedCommunity.id) ? 0.5 : 0.9, lineHeight: 1 }}
                      >
                        {myMutes.has(selectedCommunity.id) ? <Icon name="bell-off" size={14} /> : <Icon name="bell" size={14} />}
                      </button>
                    )}
                  </p>
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex items-center justify-center shrink-0 overflow-hidden"
                      style={{ width: 32, height: 32, borderRadius: 10, background: selectedCommunity.color, color: "#fff", fontSize: 14, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}
                    >
                      {selectedCommunity.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={selectedCommunity.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        selectedCommunity.name.charAt(0).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] truncate" style={{ color: "#eeeef5", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
                        {selectedCommunity.is_private && <Icon name="lock" size={11} style={{ marginRight: 4 }} />}
                        {selectedCommunity.name}
                      </span>
                      <span className="block text-[10px]" style={{ color: "rgba(238,238,245,0.4)", marginTop: 1 }}>
                        {selectedCommunity.members} member{selectedCommunity.members === 1 ? "" : "s"}
                        {selectedCommunity.is_private ? " · private" : " · public"}
                      </span>
                    </span>
                  </div>
                  {selectedCommunity.description && (() => {
                    /* Clamp long descriptions to three lines; a Read-more
                       toggle reveals the rest in place. */
                    const long = selectedCommunity.description.length > 130;
                    return (
                      <>
                        <p className="m-0 text-[11.5px]" style={{
                          marginTop: 10, color: "rgba(238,238,245,0.62)", lineHeight: 1.6,
                          ...(long && !aboutExpanded
                            ? {
                                display: "-webkit-box",
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: "vertical" as const,
                                overflow: "hidden",
                              }
                            : {}),
                        }}>
                          {selectedCommunity.description}
                        </p>
                        {long && (
                          <button
                            onClick={() => setAboutExpanded((v) => !v)}
                            className="cursor-pointer bg-transparent border-none p-0 text-[10.5px] font-semibold"
                            style={{
                              marginTop: 7, color: "#e2b96b", fontFamily: "inherit",
                              letterSpacing: "0.02em",
                              transition: "filter 0.15s ease",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.2)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
                          >
                            {aboutExpanded ? "Show less ▴" : "Read more ▾"}
                          </button>
                        )}
                      </>
                    );
                  })()}

                  {/* the board's mod team — online first, with a live count */}
                  {railMods.length > 0 && (() => {
                    const onlineCount = railMods.filter((m) => presence.has(m.user_id)).length;
                    const sorted = [...railMods].sort((a, b) =>
                      (presence.has(b.user_id) ? 1 : 0) - (presence.has(a.user_id) ? 1 : 0));
                    return (
                    <>
                      <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "12px 0 10px" }} />
                      <p className="m-0 text-[9.5px] font-bold flex items-center gap-1.5" style={{ color: "rgba(238,238,245,0.35)", letterSpacing: "0.09em", marginBottom: 8 }}>
                        MODERATORS
                        {onlineCount > 0 && (
                          <span className="inline-flex items-center gap-1" style={{ color: "#00b894" }}>
                            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00b894", boxShadow: "0 0 5px rgba(0,184,148,0.7)" }} />
                            {onlineCount} ONLINE
                          </span>
                        )}
                      </p>
                      {sorted.map((m) => {
                        const online = presence.has(m.user_id);
                        return (
                          <div
                            key={m.user_id}
                            className="flex items-center gap-2 cursor-pointer"
                            style={{ padding: "3px 0" }}
                            onClick={(e) => {
                              if (m.user?.username) {
                                openUserMenu({ x: e.clientX, y: e.clientY }, { userId: m.user_id, username: m.user.username });
                              }
                            }}
                          >
                            <UserAvatar size={20} username={m.user?.username ?? "?"} avatarUrl={m.user?.avatar_url ?? null} seed={m.user_id} />
                            <span className="flex-1 min-w-0 truncate text-[11.5px]" style={{ color: "rgba(238,238,245,0.8)" }}>
                              {m.user?.display_name?.trim() || `@${m.user?.username ?? "unknown"}`}
                              {m.role === "owner" && (
                                <span className="text-[8.5px] font-bold ml-1.5" style={{ color: "#e2b96b", letterSpacing: "0.04em" }}>OWNER</span>
                              )}
                            </span>
                            <span
                              title={online ? "Active now" : "Offline"}
                              style={{
                                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                                background: online ? "#00b894" : "rgba(238,238,245,0.18)",
                                boxShadow: online ? "0 0 6px rgba(0,184,148,0.6)" : "none",
                              }}
                            />
                          </div>
                        );
                      })}
                    </>
                    );
                  })()}
                </div>
              </div>
            )}
            {/* quick filter over the community lists */}
            {communities.length > 3 && (
              <input
                value={railQuery}
                onChange={(e) => setRailQuery(e.target.value)}
                placeholder="Find a community…"
                className="w-full mb-1"
                style={{ ...inputStyle, padding: "7px 12px", fontSize: 12, borderRadius: 10 }}
              />
            )}
            {(() => {
              const q = railQuery.trim().toLowerCase();
              const match = (c: Community) => !q || c.name.toLowerCase().includes(q);
              const joined = communities
                .filter((c) => c.joined && !c.blocked && match(c))
                .sort((a, b) => Number(b.favorite) - Number(a.favorite));
              const discover = communities.filter((c) => !c.joined && !c.blocked && match(c));
              const row = (c: Community) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 mb-1 px-3.5 py-2 cursor-pointer"
                  style={{
                    borderRadius: 10,
                    background: selected === c.id ? "rgba(255,255,255,0.07)" : "transparent",
                  }}
                  onClick={() => { setSelected(c.id); setOpenPost(null); }}
                >
                  <span
                    className="flex items-center justify-center shrink-0 overflow-hidden"
                    style={{ width: 26, height: 26, borderRadius: 8, background: c.color, color: "#fff", fontSize: 12, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}
                  >
                    {c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      c.name.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] truncate" style={{ color: "#eeeef5" }}>
                      {c.is_private && <Icon name="lock" size={12} title="Private community" style={{ marginRight: 3 }} />}
                      {c.name}
                    </span>
                    <span className="block text-[10px]" style={{ color: "rgba(238,238,245,0.32)" }}>
                      {c.members} member{c.members === 1 ? "" : "s"}
                    </span>
                  </span>
                  {c.joined && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(c); }}
                      title={c.favorite ? "Remove bookmark" : "Bookmark this community"}
                      aria-label={c.favorite ? "Remove bookmark" : "Bookmark this community"}
                      className="cursor-pointer shrink-0 flex items-center justify-center border-none bg-transparent"
                      style={{ width: 22, height: 22, color: c.favorite ? "#e2b96b" : "rgba(238,238,245,0.28)", padding: 0 }}
                    >
                      <Icon name="bookmark" size={14} style={{ fill: c.favorite ? "currentColor" : "none" }} />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleJoin(c); }}
                    className="cursor-pointer text-[10px] px-2 py-1 rounded-md shrink-0"
                    style={
                      c.joined
                        ? { background: "transparent", border: "0.5px solid rgba(0,184,148,0.4)", color: "#00b894", fontFamily: "inherit" }
                        : c.requested
                          ? { background: "transparent", border: "0.5px solid rgba(226,185,107,0.35)", color: "#e2b96b", fontFamily: "inherit" }
                          : { ...btnBlue, borderRadius: 6 }
                    }
                  >
                    {c.joined ? "✓" : c.requested ? "Pending" : c.is_private ? "Request" : "Join"}
                  </button>
                </div>
              );
              const sectionTitle = (label: string) => (
                <p className="m-0 mt-3 mb-1 px-3.5 text-[10px] font-bold" style={{ color: "rgba(238,238,245,0.32)", letterSpacing: "0.08em" }}>
                  {label}
                </p>
              );
              return (
                <>
                  {joined.length > 0 && (
                    <>
                      {sectionTitle("YOUR COMMUNITIES")}
                      {joined.map(row)}
                    </>
                  )}
                  {discover.length > 0 && (
                    <>
                      {sectionTitle(joined.length > 0 ? "DISCOVER" : "COMMUNITIES")}
                      {discover.map(row)}
                    </>
                  )}
                  {communities.length === 0 && (
                    <p className="px-3.5 text-[11px]" style={{ color: "rgba(238,238,245,0.32)" }}>
                      No communities yet — create the first one.
                    </p>
                  )}
                  {/* Two rail sections — LIVE (joinable) above SCHEDULED
                      (informational); each hidden entirely when empty. */}
                  {(() => {
                    const railInner = (d: RailDebate, live: boolean) => (
                      <>
                        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: live ? "#e84040" : "#e2b96b" }}>
                          <span
                            className="inline-block shrink-0"
                            style={{ width: 8, height: 8, borderRadius: 3, background: d.community_color }}
                          />
                          <span className="truncate" style={{ color: "rgba(238,238,245,0.5)" }}>{d.community_name}</span>
                          <span className="ml-auto shrink-0">
                            {live ? "● LIVE — join" : fmtWhen(d.scheduled_start)}
                          </span>
                        </span>
                        <span className="block mt-0.5 text-[11.5px] leading-snug" style={{
                          color: "rgba(238,238,245,0.88)",
                          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                        }}>
                          {d.motion}
                        </span>
                      </>
                    );
                    const liveRail = railDebates.filter((d) => d.status === "live");
                    const schedRail = railDebates.filter((d) => d.status !== "live");
                    return (
                      <>
                        {liveRail.length > 0 && (
                          <>
                            {sectionTitle("LIVE DISCUSSIONS")}
                            {liveRail.map((d) => (
                              <a
                                key={d.id}
                                href={`/agora/${d.id}`}
                                className="block mb-1 px-3.5 py-2 no-underline"
                                style={{ borderRadius: 10, background: "rgba(232,64,64,0.06)", border: "0.5px solid rgba(232,64,64,0.3)" }}
                              >
                                {railInner(d, true)}
                              </a>
                            ))}
                          </>
                        )}
                        {schedRail.length > 0 && (
                          <>
                            {sectionTitle("SCHEDULED DISCUSSIONS")}
                            {schedRail.map((d) => (
                              <div
                                key={d.id}
                                className="block mb-1 px-3.5 py-2"
                                title="Joining opens when the discussion starts"
                                style={{ borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.07)", cursor: "default" }}
                              >
                                {railInner(d, false)}
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    );
                  })()}

                  {/* Community Bookmarks — mod-curated links, pill buttons;
                      groups expand into their links. */}
                  {selectedCommunity && selectedCommunity.bookmarks.length > 0 && (
                    <>
                      {sectionTitle("COMMUNITY BOOKMARKS")}
                      <div className="flex flex-col gap-2 mb-4">
                        {selectedCommunity.bookmarks.map((b) => {
                          const pill: React.CSSProperties = {
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            width: "100%", padding: "10px 14px", borderRadius: 999,
                            background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(255,255,255,0.08)",
                            color: "#eeeef5", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                            textDecoration: "none", cursor: "pointer",
                          };
                          if (!isGroup(b)) {
                            return (
                              <a key={b.label} href={b.url} target="_blank" rel="noopener noreferrer nofollow" style={pill}>
                                {b.label}
                              </a>
                            );
                          }
                          const open = openBookmarkGroup === b.label;
                          return (
                            <div key={b.label}>
                              <button
                                onClick={() => setOpenBookmarkGroup(open ? null : b.label)}
                                aria-expanded={open}
                                style={pill}
                              >
                                {b.label}
                                <Icon name="chevron-down" size={12} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                              </button>
                              {open && (
                                <div className="flex flex-col gap-1.5 mt-1.5 px-1">
                                  {b.items.map((it) => (
                                    <a
                                      key={it.url}
                                      href={it.url}
                                      target="_blank"
                                      rel="noopener noreferrer nofollow"
                                      style={{ ...pill, padding: "8px 12px", fontSize: 12, fontWeight: 500, background: "rgba(255,255,255,0.035)" }}
                                    >
                                      {it.label} ↗
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {/* community rules — anchored at the very bottom of the
                      rail for the board currently open */}
                  {selectedCommunity?.rules && (
                    <>
                      {sectionTitle(`${selectedCommunity.name.toUpperCase()} RULES`)}
                      {(() => {
                        /* Compact preview — the first three rules; a toggle
                           reveals the full list, mirroring the About card. */
                        const allRules = selectedCommunity.rules.split("\n").filter((r) => r.trim());
                        const shown = rulesExpanded ? allRules : allRules.slice(0, 3);
                        return (
                          <div className="px-3 mb-1" style={{
                            borderRadius: 10,
                            background: "rgba(255,255,255,0.03)",
                            border: "0.5px solid rgba(255,255,255,0.07)",
                            paddingTop: 9, paddingBottom: 10,
                          }}>
                            {shown.map((r, i) => (
                              <p key={i} className="m-0 text-[10.5px]" style={{
                                color: "rgba(238,238,245,0.65)", lineHeight: 1.5,
                                marginTop: i === 0 ? 0 : 5,
                              }}>
                                <span style={{ color: "#e2b96b", marginRight: 6, fontWeight: 700, fontSize: 9.5 }}>{i + 1}</span>
                                {r.trim()}
                              </p>
                            ))}
                            {allRules.length > 3 && (
                              <button
                                onClick={() => setRulesExpanded((v) => !v)}
                                className="cursor-pointer bg-transparent border-none p-0 text-[10px] font-semibold"
                                style={{
                                  marginTop: 7, color: "#e2b96b", fontFamily: "inherit",
                                  letterSpacing: "0.02em",
                                  transition: "filter 0.15s ease",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.2)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
                              >
                                {rulesExpanded ? "Show less ▴" : `Show all ${allRules.length} rules ▾`}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </>
              );
            })()}
          </nav>

          {/* main column */}
          <main className="flex-1 min-w-0 w-full">

            {openPost ? (
              /* ── post detail ── */
              <div>
                {/* (the header's Back pill handles navigation) */}
                <div className="p-4 mb-4 flex gap-3" style={card}>
                  <VoteBox post={openPost} onVote={vote} size={14} />
                  <div className="flex-1 min-w-0">
                    <p className="m-0 text-[11px] flex items-center gap-1.5 flex-wrap" style={{ color: "rgba(238,238,245,0.5)" }}>
                      <span className="inline-flex items-center gap-1">
                        <span
                          onClick={() => { const cid = openPost.community_id; closePostDetail(); setSelected(cid); }}
                          className="cursor-pointer"
                          title={`Go to ${openPost.community_name}`}
                          style={{ color: "#e2b96b", textDecoration: "underline dotted rgba(226,185,107,0.4)", textUnderlineOffset: 2 }}
                        >
                          {openPost.community_name}
                        </span>
                        <span>·</span>
                        {authorSpan(openPost.author_id, openPost.author_username, openPost.author_display_name)}
                        <span>·</span>
                        <span>{timeAgo(openPost.created_at)}</span>
                      </span>
                      <RoleBadge role={openPost.author_role} />
                      {openPost.is_repost && <span className="inline-flex items-center gap-1" style={{ color: "#e2b96b" }}><Icon name="repeat" size={12} /> repost</span>}
                      {openPost.pinned_at && (
                        <span className="text-[9.5px] font-bold rounded" style={{
                          background: "rgba(74,158,255,0.12)", border: "0.5px solid rgba(74,158,255,0.35)",
                          color: "#4a9eff", padding: "1px 6px", letterSpacing: "0.04em",
                        }}>
                          <Icon name="pin" size={10} /> PINNED
                        </span>
                      )}
                      {openPost.tag_name && <TagChip name={openPost.tag_name} color={openPost.tag_color} />}
                    </p>
                    <h2 className="m-0 mt-1 text-[17px]" style={{ color: "#eeeef5", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
                      <RichText text={openPost.title} inline />
                    </h2>
                    {openPost.body && (
                      <div className="mt-2 text-[13px] leading-relaxed" style={{ color: "rgba(238,238,245,0.85)" }}>
                        <RichText text={openPost.body} />
                      </div>
                    )}
                    {/* Replay threads get the VOD player inline — the
                        component no-ops for every ordinary post. */}
                    <ReplayEmbed postId={openPost.id} />
                    {/* Posts sharing a clip link embed the clip the same way. */}
                    <ClipEmbed body={openPost.body} />
                    {openPost.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={openPost.image_url} alt="" className="mt-2 rounded-xl"
                        style={{ maxWidth: "100%", maxHeight: 480 }} />
                    )}
                    {repostEmbed(openPost)}
                    <div style={{ marginTop: 16 }}>{postActions(openPost, true)}</div>
                  </div>
                </div>

                {/* comment composer — media/emoji live in the editor toolbar; only
                    the submit button sits beside the box, bottom-aligned. */}
                <div className="mb-4">
                  <div className="flex gap-2 items-end">
                    <span className="relative flex-1 min-w-0">
                      <RichEditor
                        ref={commentInputRef}
                        compact
                        value={commentText}
                        onChange={setCommentText}
                        placeholder={userId ? "Add a comment… (@ to mention, ⌘↩ to send)" : "Sign in to comment"}
                        onSubmit={() => submitComment(null, commentText, commentImage, commentGifUrl)}
                        mentions={!!userId}
                        onFocus={() => { if (!userId) window.location.href = "/login"; }}
                        onImage={() => commentImageInputRef.current?.click()}
                        onGif={giphyEnabled ? () => setGifPickerFor(gifPickerFor === "comment" ? null : "comment") : undefined}
                        onEmoji={() => setEmojiFor(emojiFor === "comment" ? null : "comment")}
                        trailing={
                          <span className="relative inline-block" style={{ alignSelf: "stretch" }}>
                            {emojiFor === "comment" && (
                              <EmojiPicker
                                onPick={(e) => commentInputRef.current?.insertText(e)}
                                onClose={() => setEmojiFor(null)}
                              />
                            )}
                            {gifPickerFor === "comment" && (
                              <GifPicker
                                onPick={(u) => { setCommentGifUrl(u); pickCommentImage(null); setGifPickerFor(null); }}
                                onClose={() => setGifPickerFor(null)}
                              />
                            )}
                          </span>
                        }
                      />
                      <input ref={commentImageInputRef} type="file" accept="image/*" className="hidden"
                        onChange={(e) => { pickCommentImage(e.target.files?.[0] ?? null); setCommentGifUrl(null); e.target.value = ""; }} />
                    </span>
                    <button
                      onClick={() => submitComment(null, commentText, commentImage, commentGifUrl)}
                      disabled={busy || !commentText.trim()}
                      className="cursor-pointer text-[12px] px-4 rounded-lg shrink-0 disabled:opacity-50 disabled:cursor-default"
                      style={{ ...btnBlue, height: 40 }}
                    >
                      Comment
                    </button>
                  </div>
                  {commentImagePreview && (
                    <span className="inline-flex items-center gap-2 mt-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={commentImagePreview} alt="" className="rounded" style={{ height: 40 }} />
                      <button onClick={() => pickCommentImage(null)}
                        className="cursor-pointer bg-transparent border-none p-0 text-[11px]" style={{ color: "rgba(238,238,245,0.32)" }}>
                        remove
                      </button>
                    </span>
                  )}
                  {commentGifUrl && (
                    <span className="inline-flex items-center gap-2 mt-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={commentGifUrl} alt="" className="rounded" style={{ height: 40 }} />
                      <button onClick={() => setCommentGifUrl(null)}
                        className="cursor-pointer bg-transparent border-none p-0 text-[11px]" style={{ color: "rgba(238,238,245,0.32)" }}>
                        remove
                      </button>
                    </span>
                  )}
                </div>

                {/* comments */}
                {commentTree.roots.length > 0 && (
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[11px]" style={{ color: "rgba(238,238,245,0.32)" }}>Sort:</span>
                    {(["top", "new"] as const).map((cs) => (
                      <button
                        key={cs}
                        onClick={() => setCommentSort(cs)}
                        className="cursor-pointer text-[11px] px-2.5 py-1 rounded-full"
                        style={{
                          background: commentSort === cs ? "rgba(255,255,255,0.1)" : "transparent",
                          border: "0.5px solid " + (commentSort === cs ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.1)"),
                          color: commentSort === cs ? "#eeeef5" : "rgba(238,238,245,0.5)",
                          fontFamily: "inherit",
                        }}
                      >
                        {cs === "top" ? "Top" : "New"}
                      </button>
                    ))}
                  </div>
                )}
                {commentTree.roots.length === 0 ? (
                  <p className="text-[12px] text-center py-6" style={{ color: "rgba(238,238,245,0.32)" }}>
                    No comments yet — start the discussion.
                  </p>
                ) : (
                  <div className="flex flex-col" style={{ gap: 16 }}>
                    {commentTree.roots.map((root) => renderThread(root, 0))}
                  </div>
                )}

                {/* pagination — appears whenever a full page of threads came back */}
                {hasMoreComments && commentTree.roots.length > 0 && (
                  <button
                    onClick={loadMoreComments}
                    disabled={loadingMoreComments}
                    className="block w-full cursor-pointer text-[12px] py-2.5 rounded-xl"
                    style={{ ...btnGhost, opacity: loadingMoreComments ? 0.6 : 1, marginTop: 14 }}
                  >
                    {loadingMoreComments ? "Loading…" : "Load more comments"}
                  </button>
                )}
              </div>
            ) : (
              /* ── feed ── */
              <div>
                {/* community header — Reddit-style banner card */}
                {selectedCommunity && (
                  <div className="mb-3 overflow-hidden" style={card}>
                    {/* banner: custom image when set, else the community color.
                        Mods get a pencil (and ✕ when a custom image is set)
                        that fades in on hover anywhere over the banner. */}
                    <div className="group relative">
                      {selectedCommunity.banner_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selectedCommunity.banner_url}
                          alt=""
                          style={{ width: "100%", height: 140, objectFit: "cover", display: "block" }}
                        />
                      ) : (
                        <div
                          style={{
                            height: 140,
                            background: `linear-gradient(120deg, ${selectedCommunity.color} 0%, ${selectedCommunity.color}55 45%, rgba(18,18,24,0) 100%)`,
                          }}
                        />
                      )}
                      {isMod && (
                        <span className="absolute flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                          style={{ right: 10, bottom: 10 }}>
                          {selectedCommunity.banner_url && (
                            <button
                              onClick={() => setBranding("banner", null)}
                              disabled={brandingBusy !== null}
                              title="Remove banner"
                              className="cursor-pointer flex items-center justify-center"
                              style={{
                                width: 28, height: 28, borderRadius: "50%", fontSize: 12,
                                background: "rgba(10,10,12,0.7)", border: "0.5px solid rgba(255,255,255,0.25)",
                                color: "rgba(238,238,245,0.88)",
                              }}
                            >
                              <Icon name="x" size={12} />
                            </button>
                          )}
                          <label
                            title={selectedCommunity.banner_url ? "Change banner" : "Upload a banner"}
                            className="cursor-pointer flex items-center justify-center"
                            style={{
                              width: 28, height: 28, borderRadius: "50%", fontSize: 13,
                              background: "rgba(10,10,12,0.7)", border: "0.5px solid rgba(255,255,255,0.25)",
                            }}
                          >
                            {brandingBusy === "banner" ? "…" : <Icon name="pencil" size={13} />}
                            <input type="file" accept="image/*" className="hidden" disabled={brandingBusy !== null}
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) setBranding("banner", f); e.target.value = ""; }} />
                          </label>
                        </span>
                      )}
                    </div>
                    <div className="px-5 pb-5">
                    {/* Identity row: avatar flush left straddling the banner
                        edge, name beside it; actions (incl. the ⋯ menu)
                        float on the right just under the banner. */}
                    <div className="flex items-start gap-4 flex-wrap">
                      <span
                        className="group relative flex items-center justify-center shrink-0"
                        style={{
                          width: 76, height: 76, borderRadius: 20, background: selectedCommunity.color,
                          color: "#fff", fontSize: 30, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700,
                          border: "3px solid rgba(14,14,17,0.97)",
                          marginTop: -41,
                        }}
                      >
                        <span className="flex items-center justify-center overflow-hidden"
                          style={{ width: "100%", height: "100%", borderRadius: 17 }}>
                          {selectedCommunity.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={selectedCommunity.avatar_url} alt=""
                              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            selectedCommunity.name.charAt(0).toUpperCase()
                          )}
                        </span>
                        {isMod && (
                          <span className="absolute flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                            style={{ right: -4, bottom: -4 }}>
                            {selectedCommunity.avatar_url && (
                              <button
                                onClick={() => setBranding("avatar", null)}
                                disabled={brandingBusy !== null}
                                title="Remove picture"
                                className="cursor-pointer flex items-center justify-center"
                                style={{
                                  width: 22, height: 22, borderRadius: "50%", fontSize: 10,
                                  background: "rgba(10,10,12,0.9)", border: "0.5px solid rgba(255,255,255,0.25)",
                                  color: "rgba(238,238,245,0.88)",
                                }}
                              >
                                <Icon name="x" size={12} />
                              </button>
                            )}
                            <label
                              title={selectedCommunity.avatar_url ? "Change picture" : "Upload a picture"}
                              className="cursor-pointer flex items-center justify-center"
                              style={{
                                width: 22, height: 22, borderRadius: "50%", fontSize: 10,
                                background: "rgba(10,10,12,0.9)", border: "0.5px solid rgba(255,255,255,0.25)",
                              }}
                            >
                              {brandingBusy === "avatar" ? "…" : <Icon name="pencil" size={13} />}
                              <input type="file" accept="image/*" className="hidden" disabled={brandingBusy !== null}
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) setBranding("avatar", f); e.target.value = ""; }} />
                            </label>
                          </span>
                        )}
                      </span>
                      {/* identity cluster: name and stats beside the avatar,
                          lifted off the row's bottom edge */}
                      <span className="flex-1 min-w-0" style={{ paddingTop: 6, paddingBottom: 12, minWidth: 200 }}>
                        <span className="block text-[21px]" style={{ color: "#eeeef5", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.15 }}>
                          {selectedCommunity.is_private && <Icon name="lock" size={16} title="Private community" style={{ marginRight: 5 }} />}
                          {selectedCommunity.name}
                        </span>
                        <span className="block text-[11px]" style={{ color: "rgba(238,238,245,0.4)", marginTop: 3, letterSpacing: "0.01em" }}>
                          {selectedCommunity.members} member{selectedCommunity.members === 1 ? "" : "s"}
                          {selectedCommunity.is_private ? " · private" : " · public"}
                          {selectedCommunity.my_role && ` · you're ${selectedCommunity.my_role === "owner" ? "the owner" : selectedCommunity.my_role === "moderator" ? "a moderator" : "a member"}`}
                        </span>
                      </span>

                      {/* right column — action pills hovering between the
                          banner edge and the content, description beneath
                          them, all clear of the card border */}
                      <span className="flex flex-col items-end gap-2 ml-auto" style={{ paddingTop: 10, maxWidth: "46ch" }}>
                      <span className="flex items-center gap-2 flex-wrap justify-end">
                        {/* community discussions are a mod privilege — the
                            RPC enforces this server-side too */}
                        {isMod && onStartDiscussion && (
                          <button
                            onClick={() => onStartDiscussion(selectedCommunity.id, selectedCommunity.name)}
                            onMouseEnter={liftIn} onMouseLeave={liftOut}
                            style={pillGold}
                          >
                            <Icon name="mic" size={13} /> Start a discussion
                          </button>
                        )}
                        <button
                          onClick={() => toggleJoin(selectedCommunity)}
                          onMouseEnter={liftIn} onMouseLeave={liftOut}
                          style={
                            selectedCommunity.joined
                              ? pillGreen
                              : selectedCommunity.requested
                                ? pillAmber
                                : pillBlue
                          }
                        >
                          {selectedCommunity.joined ? "✓ Joined" : selectedCommunity.requested ? "Pending" : selectedCommunity.is_private ? "Request to join" : "Join"}
                        </button>
                        {isMod && (
                          <button
                            onClick={() => setModOpen((v) => !v)}
                            onMouseEnter={liftIn} onMouseLeave={liftOut}
                            style={pillAmber}
                          >
                            {modOpen ? "Close mod tools" : <><Icon name="shield" size={13} /> Mod tools{joinRequests.length ? ` ()` : ""}</>}
                          </button>
                        )}
                        {/* ⋯ community options — copy link / mute / leave / block */}
                        <button
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            /* Right-align the 226px-wide menu to the button,
                               clamped to the viewport — computed from left so
                               it doesn't depend on window.innerWidth. */
                            setBoardMenuAt((o) => (o ? null : { top: r.bottom + 6, left: Math.max(8, r.right - 226) }));
                          }}
                          title="Community options"
                          aria-label="Community options"
                          className="cursor-pointer flex items-center justify-center"
                          style={{
                            background: "transparent", border: "none", padding: 4,
                            color: boardMenuAt ? "#eeeef5" : "rgba(238,238,245,0.62)",
                            transition: "color 0.15s ease",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "#eeeef5"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = boardMenuAt ? "#eeeef5" : "rgba(238,238,245,0.62)"; }}
                        >
                          <Icon name="more-horizontal" size={20} />
                        </button>
                        {boardMenuAt && typeof document !== "undefined" && createPortal(
                          (() => {
                            const c = selectedCommunity;
                            const isOwner = c.my_role === "owner";
                            const item = (icon: IconName, label: string, onClick: () => void, danger?: boolean) => (
                              <button
                                key={label}
                                onClick={() => { setBoardMenuAt(null); onClick(); }}
                                className="w-full flex items-center gap-2.5 cursor-pointer text-left"
                                style={{
                                  padding: "9px 11px", borderRadius: 8, background: "transparent",
                                  border: "none", color: danger ? "#f08a8a" : "rgba(238,238,245,0.92)",
                                  fontFamily: "'DM Sans', sans-serif", fontSize: 12.5,
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                              >
                                <Icon name={icon} size={14} /> {label}
                              </button>
                            );
                            return (
                              <>
                                <div className="fixed inset-0" style={{ zIndex: 998 }} onClick={() => setBoardMenuAt(null)} />
                                <div
                                  className="fixed flex flex-col"
                                  style={{
                                    top: boardMenuAt.top, left: boardMenuAt.left, minWidth: 214, zIndex: 999,
                                    background: "rgba(18,18,22,0.98)", backdropFilter: "blur(20px)",
                                    WebkitBackdropFilter: "blur(20px)",
                                    border: "0.5px solid rgba(255,255,255,0.12)", borderRadius: 12,
                                    boxShadow: "0 16px 48px rgba(0,0,0,0.5)", padding: 6, gap: 1,
                                  }}
                                >
                                  {item("link", "Copy link", () => {
                                    const url = `${window.location.origin}${pathFor.community(communitySlug(c, communities))}`;
                                    navigator.clipboard.writeText(url).catch(() => {});
                                  })}
                                  {c.joined && item(
                                    myMutes.has(c.id) ? "bell" : "bell-off",
                                    myMutes.has(c.id) ? "Unmute notifications" : "Mute notifications",
                                    () => toggleMute(c.id),
                                  )}
                                  {c.joined && !isOwner && item("log-out", "Leave community", () => toggleJoin(c), true)}
                                  {!isOwner && item(
                                    "ban",
                                    c.blocked ? "Unblock community" : "Block community",
                                    () => toggleBlock(c),
                                    !c.blocked,
                                  )}
                                </div>
                              </>
                            );
                          })(),
                          document.body,
                        )}
                      </span>
                      </span>
                    </div>

                    {/* mod panel — tidy sub-panels; banner & picture edit
                        via the hover pencils on the header itself */}
                    {modOpen && isMod && (() => {
                      const panel: React.CSSProperties = {
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 12,
                        padding: "12px 14px",
                      };
                      const panelLabel = (label: string) => (
                        <p className="m-0 mb-2 text-[10.5px] font-bold" style={{ color: "rgba(238,238,245,0.5)", letterSpacing: "0.06em" }}>
                          {label}
                        </p>
                      );
                      const activePill = (uid: string) => {
                        const online = presence.has(uid);
                        return (
                          <span className="inline-flex items-center gap-1.5 text-[10px] shrink-0"
                            style={{ color: online ? "#00b894" : "rgba(238,238,245,0.32)" }}>
                            <span style={{
                              width: 7, height: 7, borderRadius: "50%",
                              background: online ? "#00b894" : "rgba(238,238,245,0.22)",
                              boxShadow: online ? "0 0 6px rgba(0,184,148,0.6)" : "none",
                            }} />
                            {online ? "Active" : "Offline"}
                          </span>
                        );
                      };
                      const personRow = (uid: string, u: Member["user"], right: React.ReactNode) => (
                        <div key={uid} className="flex items-center gap-2.5 py-1.5">
                          <UserAvatar size={24} username={u?.username ?? "?"} avatarUrl={u?.avatar_url ?? null} seed={uid} />
                          <span className="flex-1 min-w-0 truncate text-[12px]" style={{ color: "rgba(238,238,245,0.88)" }}>
                            {u?.display_name?.trim() || `@${u?.username ?? "unknown"}`}
                          </span>
                          {right}
                        </div>
                      );
                      const modsList = membersList.filter((m) => m.role === "owner" || m.role === "moderator");
                      const plainMembers = membersList.filter((m) => m.role === "member");
                      return (
                      <div className="mt-4 pt-4 grid gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                        {/* moderators + activity */}
                        <div style={panel}>
                          {panelLabel("MODERATORS")}
                          {modsList.length === 0 ? (
                            <p className="m-0 text-[11px]" style={{ color: "rgba(238,238,245,0.32)" }}>Loading…</p>
                          ) : modsList.map((m) => personRow(m.user_id, m.user, (
                            <>
                              {activePill(m.user_id)}
                              <RoleBadge role={m.role} />
                              {isOwner && m.role === "moderator" && m.user_id !== userId && (
                                <button onClick={() => setRole(m.user_id, "member")}
                                  className="cursor-pointer text-[10.5px] px-2.5 py-1 rounded-md" style={{ ...btnGhost, borderRadius: 6 }}>
                                  Remove
                                </button>
                              )}
                            </>
                          )))}
                        </div>

                        {/* members (mods see; owner promotes) */}
                        <div style={panel}>
                          {panelLabel(`MEMBERS${plainMembers.length ? ` · ${plainMembers.length}` : ""}`)}
                          {plainMembers.length === 0 ? (
                            <p className="m-0 text-[11px]" style={{ color: "rgba(238,238,245,0.32)" }}>No members beyond the mod team yet.</p>
                          ) : plainMembers.map((m) => personRow(m.user_id, m.user, (
                            <>
                              {activePill(m.user_id)}
                              {isOwner && m.user_id !== userId && (
                                <button onClick={() => setRole(m.user_id, "moderator")}
                                  className="cursor-pointer text-[10.5px] px-2.5 py-1 rounded-md" style={{ ...btnGhost, borderRadius: 6 }}>
                                  Make mod
                                </button>
                              )}
                              {m.user_id !== userId && (
                                <button onClick={() => banMember(m)}
                                  className="cursor-pointer text-[10.5px] px-2.5 py-1 rounded-md"
                                  style={{ background: "transparent", border: "0.5px solid rgba(232,64,64,0.35)", color: "#e88", fontFamily: "inherit", borderRadius: 6 }}>
                                  Ban
                                </button>
                              )}
                            </>
                          )))}
                        </div>

                        {/* agent-built panels: bans + mod log */}
                        <BansPanel supabase={supabase} communityId={selectedCommunity.id} refreshKey={modRefresh} />
                        <ModLogPanel supabase={supabase} communityId={selectedCommunity.id} refreshKey={modRefresh} />

                        {/* join requests */}
                        {selectedCommunity.is_private && (
                          <div style={panel}>
                            {panelLabel(`JOIN REQUESTS${joinRequests.length ? ` · ${joinRequests.length}` : ""}`)}
                            {joinRequests.length === 0 ? (
                              <p className="m-0 text-[11px]" style={{ color: "rgba(238,238,245,0.32)" }}>No pending requests.</p>
                            ) : joinRequests.map((r) => personRow(r.user_id, r.user, (
                              <>
                                <span className="text-[10px] shrink-0" style={{ color: "rgba(238,238,245,0.32)" }}>{timeAgo(r.created_at)}</span>
                                <button onClick={() => handleRequest(r.user_id, true)}
                                  className="cursor-pointer text-[10.5px] px-2.5 py-1 rounded-md"
                                  style={{ background: "transparent", border: "0.5px solid rgba(0,184,148,0.4)", color: "#00b894", fontFamily: "inherit" }}>
                                  Approve
                                </button>
                                <button onClick={() => handleRequest(r.user_id, false)}
                                  className="cursor-pointer text-[10.5px] px-2.5 py-1 rounded-md"
                                  style={{ background: "transparent", border: "0.5px solid rgba(232,64,64,0.35)", color: "#e88", fontFamily: "inherit" }}>
                                  Deny
                                </button>
                              </>
                            )))}
                          </div>
                        )}

                        {/* about & rules editor */}
                        <div style={panel}>
                          {panelLabel("ABOUT & RULES")}
                          <input
                            style={{ ...inputStyle, marginBottom: 8 }}
                            placeholder="Description (what is this board for?)"
                            maxLength={500}
                            value={draftDescription}
                            onChange={(e) => setDraftDescription(e.target.value)}
                          />
                          <textarea
                            style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
                            placeholder={"Rules — one per line\nBe civil.\nStay on topic."}
                            maxLength={4000}
                            value={draftRules}
                            onChange={(e) => setDraftRules(e.target.value)}
                          />
                          <textarea
                            style={{ ...inputStyle, minHeight: 90, resize: "vertical", marginTop: 8, fontFamily: "'DM Mono', monospace", fontSize: 11.5 }}
                            placeholder={"Community bookmarks — one per line\nDiscord | https://discord.gg/yourboard\n## Social Links\nX | https://x.com/yourboard\nInstagram | https://instagram.com/yourboard"}
                            maxLength={4000}
                            value={draftBookmarks}
                            onChange={(e) => setDraftBookmarks(e.target.value)}
                          />
                          <p className="m-0 mt-1 text-[10.5px]" style={{ color: "rgba(238,238,245,0.38)" }}>
                            Bookmarks: <code>Label | URL</code> per line; a line starting with <code>##</code> begins a dropdown group.
                          </p>
                          <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                            {isOwner && (
                              <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: "rgba(238,238,245,0.65)" }}>
                                <input
                                  type="checkbox"
                                  checked={draftPrivate}
                                  onChange={(e) => setDraftPrivate(e.target.checked)}
                                />
                                <Icon name="lock" size={12} /> Private (join by approval)
                              </label>
                            )}
                            <button onClick={saveSettings} disabled={busy}
                              className="cursor-pointer text-[11.5px] px-3.5 py-1.5 rounded-lg ml-auto disabled:opacity-50 disabled:cursor-default" style={btnBlue}>
                              Save changes
                            </button>
                          </div>
                        </div>

                        {/* tags */}
                        <div style={panel}>
                          {panelLabel("POST TAGS")}
                          <div className="flex items-center gap-2 flex-wrap">
                            {(tagsByCommunity[selectedCommunity.id] ?? []).map((t) => (
                              <span key={t.id} className="inline-flex items-center gap-1">
                                <TagChip name={t.name} color={t.color} />
                                <button
                                  onClick={() => deleteTag(t)}
                                  className="cursor-pointer bg-transparent border-none p-0 text-[10px]"
                                  style={{ color: "rgba(238,238,245,0.32)" }}
                                  aria-label={`Delete tag ${t.name}`}
                                >
                                  <Icon name="x" size={12} />
                                </button>
                              </span>
                            ))}
                            {(tagsByCommunity[selectedCommunity.id] ?? []).length === 0 && (
                              <span className="text-[11px]" style={{ color: "rgba(238,238,245,0.32)" }}>No tags yet.</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                            <input
                              style={{ ...inputStyle, width: 150 }}
                              placeholder="New tag"
                              maxLength={24}
                              value={newTagName}
                              onChange={(e) => setNewTagName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") createTag(); }}
                            />
                            <span className="flex items-center gap-1">
                              {TAG_COLORS.map((col) => (
                                <button
                                  key={col}
                                  onClick={() => setNewTagColor(col)}
                                  className="cursor-pointer border-none p-0"
                                  style={{
                                    width: 16, height: 16, borderRadius: "50%", background: col,
                                    outline: newTagColor === col ? "2px solid #eeeef5" : "none",
                                    outlineOffset: 1,
                                  }}
                                  aria-label={`Tag color ${col}`}
                                />
                              ))}
                            </span>
                            <button onClick={createTag} disabled={!newTagName.trim()}
                              className="cursor-pointer text-[11.5px] px-3 py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-default" style={btnBlue}>
                              Add
                            </button>
                          </div>
                        </div>
                      </div>
                      );
                    })()}
                    </div>
                  </div>
                )}

                {/* locked-out notice for private boards */}
                {lockedOut ? (
                  <div className="p-8 text-center" style={card}>
                    <p className="m-0 mb-1 text-[15px]" style={{ color: "#eeeef5" }}><Icon name="lock" size={14} /> This community is private</p>
                    <p className="m-0 mb-3 text-[12px]" style={{ color: "rgba(238,238,245,0.5)" }}>
                      Posts are visible to members only. Request to join and a moderator will review it.
                    </p>
                    <button
                      onClick={() => selectedCommunity && toggleJoin(selectedCommunity)}
                      className="cursor-pointer text-[12px] px-4 py-2 rounded-full"
                      style={selectedCommunity?.requested
                        ? { background: "transparent", border: "0.5px solid rgba(226,185,107,0.35)", color: "#e2b96b", fontFamily: "inherit", cursor: "pointer", borderRadius: 999 }
                        : { ...btnBlue, borderRadius: 999 }}
                    >
                      {selectedCommunity?.requested ? "Cancel request" : "Request to join"}
                    </button>
                  </div>
                ) : (
                <>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {(["best", "new", "top"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSort(s)}
                      className="cursor-pointer text-[12px] px-3.5 py-1.5 rounded-full"
                      style={{
                        background: sort === s ? "rgba(255,255,255,0.1)" : "rgba(16,16,19,0.7)",
                        border: "0.5px solid " + (sort === s ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.1)"),
                        color: sort === s ? "#eeeef5" : "rgba(238,238,245,0.65)",
                        fontFamily: "inherit",
                      }}
                      title={s === "best" ? "Wilson-score confidence: high ratios win, small samples don't" : undefined}
                    >
                      {s === "best" ? "Best" : s === "new" ? "New" : "Top"}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      if (!requireAuth()) return;
                      setComposing((v) => !v);
                      setComposeCommunity(selected !== "all" ? selected : (() => {
                        /* Default to where you last posted, then a favorite, then any joined board. */
                        const last = typeof window !== "undefined" ? window.localStorage.getItem("agora:lastPostCommunity") : null;
                        const ok = (id: string | null | undefined) => !!id && communities.some((c) => c.id === id && (!c.is_private || c.joined));
                        if (ok(last)) return last as string;
                        return communities.find((c) => c.joined && c.favorite)?.id ?? communities.find((c) => c.joined)?.id ?? communities[0]?.id ?? "";
                      })());
                    }}
                    className="cursor-pointer text-[12px] font-medium px-4 py-1.5 rounded-full ml-auto"
                    style={{ background: "#2f7fe0", border: "none", color: "#fff", borderRadius: 999, fontFamily: "inherit" }}
                  >
                    + New post
                  </button>
                </div>

                {composing && (
                  <div className="p-4 mb-4 flex flex-col gap-2.5" style={{ ...card, position: "relative", zIndex: 30 }}>
                    {selected === "all" && (
                      <CommunityPicker
                        communities={communities.filter((c) => !c.is_private || c.joined)}
                        value={composeCommunity}
                        onChange={(id) => { setComposeCommunity(id); setNewTagId(""); }}
                      />
                    )}
                    <input
                      style={inputStyle}
                      placeholder="Title"
                      maxLength={200}
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                    {/* rich editor — stores markdown, see community/RichEditor.tsx */}
                    <RichEditor
                      ref={bodyRef}
                      value={newBody}
                      onChange={setNewBody}
                      placeholder="Text (optional — @ to mention someone)"
                      onImage={() => postImageInputRef.current?.click()}
                      onGif={giphyEnabled ? () => setGifPickerFor(gifPickerFor === "post" ? null : "post") : undefined}
                      onEmoji={() => setEmojiFor(emojiFor === "post" ? null : "post")}
                      trailing={
                        <>
                          <span className="relative inline-block" style={{ alignSelf: "stretch" }}>
                            {emojiFor === "post" && (
                              <EmojiPicker
                                onPick={(e) => bodyRef.current?.insertText(e)}
                                onClose={() => setEmojiFor(null)}
                              />
                            )}
                            {gifPickerFor === "post" && (
                              <GifPicker
                                onPick={(u) => { setNewGifUrl(u); pickImage(null); setGifPickerFor(null); }}
                                onClose={() => setGifPickerFor(null)}
                              />
                            )}
                          </span>
                          <span className="text-[10px] ml-2" style={{ color: newBody.length > BODY_MAX ? "#e26b6b" : "rgba(238,238,245,0.25)" }}>
                            {newBody.length > BODY_MAX * 0.9 ? `${newBody.length.toLocaleString()} / ${BODY_MAX.toLocaleString()}` : "@mention"}
                          </span>
                        </>
                      }
                    />
                    <input
                      ref={postImageInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => { pickImage(e.target.files?.[0] ?? null); e.target.value = ""; }}
                    />
                    {composerTags.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px]" style={{ color: "rgba(238,238,245,0.32)" }}>Tag:</span>
                        {composerTags.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => setNewTagId(newTagId === t.id ? "" : t.id)}
                            className="cursor-pointer bg-transparent border-none p-0"
                            style={{ opacity: newTagId && newTagId !== t.id ? 0.45 : 1 }}
                          >
                            <TagChip name={t.name} color={t.color} />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                      {newImagePreview && (
                        <span className="inline-flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={newImagePreview} alt="" className="rounded-lg" style={{ height: 44 }} />
                          <button
                            onClick={() => pickImage(null)}
                            className="cursor-pointer bg-transparent border-none p-0 text-[11px]"
                            style={{ color: "rgba(238,238,245,0.32)" }}
                          >
                            remove
                          </button>
                        </span>
                      )}
                      {newGifUrl && (
                        <span className="inline-flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={newGifUrl} alt="" className="rounded-lg" style={{ height: 44 }} />
                          <button
                            onClick={() => setNewGifUrl(null)}
                            className="cursor-pointer bg-transparent border-none p-0 text-[11px]"
                            style={{ color: "rgba(238,238,245,0.32)" }}
                          >
                            remove
                          </button>
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={submitPost}
                        disabled={busy || !newTitle.trim() || (selected === "all" && !composeCommunity)}
                        className="cursor-pointer text-[12px] px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-default"
                        style={btnBlue}
                      >
                        {busy ? "Posting…" : "Post"}
                      </button>
                      <button
                        onClick={() => { setComposing(false); setNewTagId(""); pickImage(null); }}
                        className="cursor-pointer text-[12px] px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-default"
                        style={btnGhost}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {loadingPosts && posts.length === 0 && (
                  <p className="text-[12px] text-center py-8" style={{ color: "rgba(238,238,245,0.32)" }}>Loading…</p>
                )}

                {!loadingPosts && visiblePosts.length === 0 && (
                  <div className="p-8 text-center" style={card}>
                    <p className="m-0 mb-1 text-[13px]" style={{ color: "#eeeef5" }}>
                      {selectedCommunity ? `No posts in ${selectedCommunity.name} yet` : "No posts yet"}
                    </p>
                    <p className="m-0 text-[11px]" style={{ color: "rgba(238,238,245,0.5)" }}>
                      Start the first thread — a question, a take, a topic worth arguing about.
                    </p>
                  </div>
                )}

                {visiblePosts.map((p) => (
                  <PostCard
                    key={p.id}
                    post={p}
                    onOpen={openPostDetail}
                    onVote={vote}
                    showCommunity={selected === "all"}
                    onOpenCommunity={(id) => { closePostDetail(); setSelected(id); }}
                    author={authorSpan(p.author_id, p.author_username, p.author_display_name)}
                    actions={postActions(p, false)}
                    embed={repostEmbed(p)}
                  />
                ))}

                {/* pagination — appears whenever a full page came back */}
                {hasMore && posts.length > 0 && (
                  <button
                    onClick={loadMorePosts}
                    disabled={loadingMore}
                    className="block w-full cursor-pointer text-[12px] py-2.5 rounded-xl"
                    style={{ ...btnGhost, opacity: loadingMore ? 0.6 : 1 }}
                  >
                    {loadingMore ? "Loading…" : "Load more posts"}
                  </button>
                )}
                </>
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* repost picker */}
      {repostFor && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.55)", zIndex: 80 }}
          onClick={() => setRepostFor(null)}
        >
          <div
            className="p-5 w-full mx-4"
            style={{ ...card, maxWidth: 420, background: "rgba(14,14,17,0.97)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="m-0 mb-1 text-[15px] font-semibold flex items-center gap-2" style={{ color: "#eeeef5", fontFamily: "'Space Grotesk', sans-serif" }}>
              <Icon name="repeat" size={16} /> Repost
            </p>
            <p className="m-0 mb-3 text-[11.5px] truncate" style={{ color: "rgba(238,238,245,0.5)" }}>
              “{repostFor.title}”
            </p>
            {communities.filter((c) => c.joined && c.id !== repostFor.community_id).length === 0 ? (
              <p className="m-0 text-[12px]" style={{ color: "rgba(238,238,245,0.55)" }}>
                Join another community first — reposts land in a community you're a member of.
              </p>
            ) : (
              <>
                <select
                  value={repostCommunity}
                  onChange={(e) => setRepostCommunity(e.target.value)}
                  className="text-[13px] px-3 py-2 rounded-lg w-full"
                  style={{ background: "rgba(16,16,19,0.7)", border: "0.5px solid rgba(255,255,255,0.1)", color: "rgba(238,238,245,0.88)", marginBottom: 10 }}
                >
                  {communities
                    .filter((c) => c.joined && c.id !== repostFor.community_id)
                    .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <textarea
                  style={{ ...inputStyle, minHeight: 60, resize: "vertical", marginBottom: 12 }}
                  placeholder="Add your take (optional)"
                  maxLength={10000}
                  value={repostComment}
                  onChange={(e) => setRepostComment(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    onClick={submitRepost}
                    disabled={busy || !repostCommunity}
                    className="cursor-pointer text-[12px] px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-default"
                    style={btnBlue}
                  >
                    {busy ? "Reposting…" : "Repost"}
                  </button>
                  <button
                    onClick={() => setRepostFor(null)}
                    className="cursor-pointer text-[12px] px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-default"
                    style={btnGhost}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
