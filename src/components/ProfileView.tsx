"use client";

/* Full profile view — rendered by the /users/[username] route (and /@handle),
   and embedded as a slide-over drawer inside live rooms so the debate keeps
   playing while you browse someone (Twitch-style).

   Header (avatar, name + verified badge, bio, joined date, follow/message),
   social stats with follower/following lists, then tabbed content: debates,
   scheduled, posts, shorts. Moderators see a verify toggle. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pathFor } from "@/lib/routes";
import { slugify } from "@/lib/communityUrls";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS } from "@/types/database";
import { roomPath, userPath } from "@/lib/urls";
import UserAvatar from "@/components/UserAvatar";
import VerifiedBadge from "@/components/VerifiedBadge";
import { Icon, type IconName } from "@/components/icons";
import FollowListModal from "@/components/FollowListModal";
import Wordmark from "@/components/Wordmark";
import dynamic from "next/dynamic";
import EditProfileModal from "@/components/EditProfileModal";
import ReportModal, { type ReportTarget } from "@/components/ReportModal";
import useEscapeClose from "@/lib/useEscapeClose";
import { displayName } from "@/lib/names";

interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  username_changed_at: string | null;
  follower_count: number;
  following_count: number;
  is_following: boolean;
  is_friend: boolean;
  verified: boolean;
  /* Added by migration 20260843 — optional so the page tolerates a
     live get_user_profile that predates it. */
  banner_url?: string | null;
  social_links?: unknown;
  karma?: number | null;
  live_room_id?: string | null;
  live_room_motion?: string | null;
  mutual_names?: string[] | null;
}

type DebateRow = {
  id: string;
  motion: string | null;
  topic_key: string | null;
  status: string;
  created_at: string;
  scheduled_start: string | null;
  viewer_count: number | null;
  role: string;
  /** For rooms this user debated in (not hosted): who hosted them. */
  host_username?: string | null;
  host_display_name?: string | null;
  host_avatar_url?: string | null;
  host_id?: string | null;
};

/* Rows from get_community_posts(p_author): scores, tags, images, and
   the embedded original for reposts — private-board posts already
   filtered server-side by the community_visible predicate. */
type PostRow = {
  id: string;
  community_name: string;
  title: string;
  body: string | null;
  created_at: string;
  score: number;
  comment_count: number;
  image_url: string | null;
  tag_name: string | null;
  tag_color: string | null;
  is_repost: boolean;
  repost_of: string | null;
  orig_title: string | null;
  orig_community_name: string | null;
  orig_author_username: string | null;
  orig_author_display_name: string | null;
};

type ClipRow = {
  id: string;
  title: string | null;
  thumb_gradient: string | null;
  video_url: string | null;
  view_count: number | null;
  duration_seconds: number | null;
};

/* Rows from get_user_comments(p_author, p_limit, p_offset) — newest
   first, privacy pre-filtered server-side. */
type CommentRow = {
  id: string;
  body: string;
  image_url: string | null;
  created_at: string;
  score: number;
  post_id: string;
  post_title: string;
  community_id: string;
  community_name: string;
};

/* Rows from get_user_communities(p_user) — owner/mod first. */
type CommunityRow = {
  id: string;
  name: string;
  color: string | null;
  avatar_url: string | null;
  role: string;
  member_count: number;
};

type Tab = "debates" | "scheduled" | "posts" | "reposts" | "comments" | "communities" | "shorts";

const COMMENTS_PAGE = 30;

/* Hostname → pretty label for the social-link chips. (A shared
   src/lib/socialLinks.ts is landing in parallel; this stays private
   here until the two are unified.) */
function socialLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    switch (host) {
      case "x.com":
      case "twitter.com":
        return "X";
      case "instagram.com":
        return "Instagram";
      case "youtube.com":
        return "YouTube";
      case "tiktok.com":
        return "TikTok";
      case "twitch.tv":
        return "Twitch";
      case "github.com":
        return "GitHub";
      case "discord.gg":
      case "discord.com":
        return "Discord";
      case "linkedin.com":
        return "LinkedIn";
      default:
        return host;
    }
  } catch {
    return url;
  }
}

/* Brand marks for the header's icon row. Hand-inlined paths for the
   big platforms; anything else gets the globe. */
function socialIcon(url: string): React.ReactElement {
  const label = socialLabel(url);
  const name: IconName =
    label === "X" ? "brand-x"
    : label === "Instagram" ? "brand-instagram"
    : label === "LinkedIn" ? "brand-linkedin"
    : label === "YouTube" ? "brand-youtube"
    : label === "GitHub" ? "brand-github"
    : "globe";
  return <Icon name={name} size={15} />;
}

/* social_links is jsonb — trust nothing about its shape. */
function safeSocialLinks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (u): u is string => typeof u === "string" && /^https:\/\//i.test(u)
  ).slice(0, 8);
}

const card: React.CSSProperties = {
  background: "rgba(16,16,22,0.88)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
};

/* The homepage's sidebar, loaded only on the standalone route (never the
   in-room drawer) so mvp-home.css — imported inside it — stays off the
   room page. */
const HomeSidebar = dynamic(() => import("@/components/HomeSidebar"), { ssr: false });

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export default function ProfileView({
  username: rawUsername,
  embedded = false,
}: {
  username: string;
  /** Drawer mode inside a room: no top bar, transparent shell. */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [profile, setProfile] = useState<Profile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerIsMod, setViewerIsMod] = useState(false);
  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState<Tab>("debates");
  const [debates, setDebates] = useState<DebateRow[] | null>(null);
  const [posts, setPosts] = useState<PostRow[] | null>(null);
  const [clips, setClips] = useState<ClipRow[] | null>(null);
  const [listMode, setListMode] = useState<null | "followers" | "following">(null);
  const [editOpen, setEditOpen] = useState(false);
  const [shared, setShared] = useState(false);

  /* Comments + communities + block state are keyed by the profile's uid,
     so a profile switch invalidates them by derivation — no reset-in-effect,
     and a late response for the old profile can never bleed into the new one. */
  const [commentsState, setCommentsState] = useState<{
    uid: string;
    rows: CommentRow[];
    hasMore: boolean;
  } | null>(null);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [communitiesState, setCommunitiesState] = useState<{
    uid: string;
    rows: CommunityRow[];
  } | null>(null);

  /* Block / Report popover ("⋯"). */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [blockState, setBlockState] = useState<{
    uid: string;
    blocked: boolean;
    note: string | null;
  } | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  useEscapeClose(menuOpen, () => setMenuOpen(false));

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const loadProfile = useCallback(async () => {
    const uname = decodeURIComponent(rawUsername);
    const { data: row } = await supabase
      .from("users")
      .select("id")
      .ilike("username", uname)
      .maybeSingle();
    if (!row) {
      setNotFound(true);
      return;
    }
    const { data } = await supabase.rpc("get_user_profile", { p_user: row.id });
    const p = Array.isArray(data) ? data[0] : data;
    if (!p) setNotFound(true);
    else setProfile(p as Profile);
  }, [rawUsername, supabase]);

  useEffect(() => {
    loadProfile();
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      setViewerId(auth.user.id);
      const { data: me } = await supabase
        .from("users")
        .select("is_moderator")
        .eq("id", auth.user.id)
        .maybeSingle();
      setViewerIsMod(!!me?.is_moderator);
    })();
  }, [loadProfile, supabase]);

  /* Tab data — loaded lazily, once per profile. */
  const uid = profile?.id;
  useEffect(() => {
    if (!uid) return;
    (async () => {
      const [{ data: parts }, { data: hosted }] = await Promise.all([
        supabase
          .from("debate_participants")
          .select("role, room:debate_rooms(id, motion, topic_key, status, created_at, scheduled_start, viewer_count, host_id)")
          .eq("user_id", uid)
          .eq("role", "debater"),
        supabase
          .from("debate_rooms")
          .select("id, motion, topic_key, status, created_at, scheduled_start, viewer_count")
          .eq("host_id", uid)
          .order("created_at", { ascending: false })
          .limit(40),
      ]);
      const seen = new Map<string, DebateRow>();
      for (const r of (hosted ?? []) as Omit<DebateRow, "role">[]) {
        seen.set(r.id, { ...r, role: "host" });
      }
      const hostIds = new Set<string>();
      for (const p of (parts ?? []) as unknown as {
        role: string;
        room: (Omit<DebateRow, "role"> & { host_id: string | null }) | null;
      }[]) {
        if (p.room && !seen.has(p.room.id)) {
          seen.set(p.room.id, { ...p.room, role: "debater" });
          if (p.room.host_id) hostIds.add(p.room.host_id);
        }
      }
      // Resolve host names for the debated-in rooms so rows can say
      // "hosted by @x" (hosted rooms use the profile's own name).
      if (hostIds.size > 0) {
        const { data: hostRows } = await supabase
          .from("users")
          .select("id, username, display_name, avatar_url")
          .in("id", [...hostIds]);
        type HostRow = { id: string; username: string; display_name: string | null; avatar_url: string | null };
        const hosts = new Map((hostRows ?? []).map((h: HostRow) => [h.id, h]));
        for (const row of seen.values()) {
          const hid = (row as DebateRow & { host_id?: string | null }).host_id;
          if (row.role === "debater" && hid) {
            const h = hosts.get(hid);
            row.host_id = hid;
            row.host_username = h?.username ?? null;
            row.host_display_name = h?.display_name ?? null;
            row.host_avatar_url = h?.avatar_url ?? null;
          }
        }
      }
      setDebates(
        [...seen.values()].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
      );

      /* Community posts via the feed RPC: scores + repost embeds come
         along, and private-board posts are filtered server-side. */
      const { data: postRows } = await supabase.rpc("get_community_posts", {
        p_community: null,
        p_sort: "new",
        p_limit: 60,
        p_author: uid,
      });
      setPosts((postRows ?? []) as unknown as PostRow[]);

      const { data: clipRows } = await supabase
        .from("clips")
        .select("id, title, thumb_gradient, video_url, view_count, duration_seconds")
        .eq("uploader_id", uid)
        .order("created_at", { ascending: false })
        .limit(30);
      setClips((clipRows ?? []) as ClipRow[]);
    })();
  }, [uid, supabase]);

  /* Comments + communities — new RPCs from migration 20260843. Errors
     (e.g. 42883 before the migration lands) degrade to empty lists so
     the page never crashes. Results are stored keyed by uid, so a slow
     response for a previous profile is ignored by derivation. */
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const [cRes, mRes] = await Promise.all([
        supabase.rpc("get_user_comments", { p_author: uid, p_limit: COMMENTS_PAGE, p_offset: 0 }),
        supabase.rpc("get_user_communities", { p_user: uid }),
      ]);
      if (cancelled) return;
      const cRows = (Array.isArray(cRes.data) ? cRes.data : []) as CommentRow[];
      setCommentsState({ uid, rows: cRows, hasMore: cRows.length === COMMENTS_PAGE });
      setCommunitiesState({
        uid,
        rows: (Array.isArray(mRes.data) ? mRes.data : []) as CommunityRow[],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, supabase]);

  const comments = commentsState && commentsState.uid === uid ? commentsState.rows : null;
  const commentsHasMore = commentsState && commentsState.uid === uid ? commentsState.hasMore : false;
  const myCommunities = communitiesState && communitiesState.uid === uid ? communitiesState.rows : null;

  const loadMoreComments = useCallback(async () => {
    if (!uid || comments === null || commentsBusy) return;
    setCommentsBusy(true);
    const { data } = await supabase.rpc("get_user_comments", {
      p_author: uid,
      p_limit: COMMENTS_PAGE,
      p_offset: comments.length,
    });
    const rows = (Array.isArray(data) ? data : []) as CommentRow[];
    setCommentsState((prev) =>
      prev && prev.uid === uid
        ? { uid, rows: [...prev.rows, ...rows], hasMore: rows.length === COMMENTS_PAGE }
        : prev
    );
    setCommentsBusy(false);
  }, [uid, comments, commentsBusy, supabase]);

  /* Have I blocked this user? (Same source of truth as UserContextMenu:
     RLS limits user_blocks reads to the viewer's own rows.) */
  useEffect(() => {
    if (!uid || !viewerId || uid === viewerId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_blocks")
        .select("blocked_id")
        .eq("blocked_id", uid);
      if (cancelled) return;
      if (data && data.length > 0) {
        setBlockState((prev) =>
          prev?.uid === uid ? prev : { uid, blocked: true, note: null }
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, viewerId, supabase]);

  const blocked = blockState && blockState.uid === uid ? blockState.blocked : false;
  const blockNote = blockState && blockState.uid === uid ? blockState.note : null;

  const toggleBlock = useCallback(async () => {
    if (!profile || !viewerId) return;
    setMenuOpen(false);
    const wasBlocked = blocked;
    /* Optimistic flip; revert on RPC failure. */
    setBlockState({
      uid: profile.id,
      blocked: !wasBlocked,
      note: wasBlocked ? null : "Blocked — manage in Settings",
    });
    const { error } = await supabase.rpc(wasBlocked ? "unblock_user" : "block_user", {
      p_target: profile.id,
    });
    if (error) {
      setBlockState((prev) =>
        prev?.uid === profile.id ? { uid: profile.id, blocked: wasBlocked, note: null } : prev
      );
    } else {
      window.dispatchEvent(new CustomEvent("blocks-updated"));
    }
  }, [profile, viewerId, blocked, supabase]);

  const toggleFollow = useCallback(async () => {
    if (!profile) return;
    if (!viewerId) {
      window.location.href = "/login";
      return;
    }
    setBusy(true);
    const fn = profile.is_following ? "unfollow_user" : "follow_user";
    const { error } = await supabase.rpc(fn, { p_target: profile.id });
    setBusy(false);
    if (!error) loadProfile();
  }, [profile, viewerId, supabase, loadProfile]);

  const toggleVerified = useCallback(async () => {
    if (!profile) return;
    setBusy(true);
    await supabase.rpc("set_user_verified", { p_user: profile.id, p_value: !profile.verified });
    setBusy(false);
    loadProfile();
  }, [profile, supabase, loadProfile]);

  const isSelf = viewerId && profile && viewerId === profile.id;

  /* Inline links inside rows: stop the row's own navigation. */
  const rowLink = (href: string, label: React.ReactNode, color = "#a9a9b4") => (
    <a
      href={href}
      className="no-underline row-inner-link"
      style={{ color, fontWeight: 600 }}
    >
      {label}
    </a>
  );
  const communityHref = (name: string) => pathFor.community(slugify(name));

  /* Empty states for the tabs: icon, title, hint, optional CTA. */
  const emptyState = (icon: IconName, title: string, hint: string, cta?: { label: string; href: string }) => (
    <div className="flex flex-col items-center text-center" style={{ ...card, padding: "36px 24px" }}>
      <span
        className="flex items-center justify-center"
        style={{ width: 44, height: 44, borderRadius: 14, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#8b8b94", marginBottom: 12 }}
      >
        <Icon name={icon} size={20} />
      </span>
      <p className="m-0" style={{ color: "#e3e3ea", fontSize: 14.5, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>{title}</p>
      <p className="m-0 mt-1" style={{ color: "#8b8b94", fontSize: 12.5, maxWidth: 360, lineHeight: 1.5 }}>{hint}</p>
      {cta && (
        <a
          href={cta.href}
          className="no-underline mt-4"
          style={{
            padding: "8px 18px", borderRadius: 999, fontSize: 12.5, fontWeight: 600,
            background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402",
          }}
        >
          {cta.label}
        </a>
      )}
    </div>
  );
  const first = (profile?.display_name?.trim() || profile?.username || "").split(" ")[0];

  /* Avatar + name + @handle, linked. Used at the top of every row so the
     person behind a debate / post / comment is always visible. */
  const identity = (u: { id?: string | null; username: string; display_name?: string | null; avatar_url?: string | null }, size = 20) => {
    const name = u.display_name?.trim() || `@${u.username}`;
    const showHandle = !!u.display_name?.trim();
    return (
      <a
        href={userPath(u.username)}
        className="no-underline inline-flex items-center gap-1.5 min-w-0 row-inner-link"
        style={{ color: "#e3e3ea" }}
      >
        <UserAvatar size={size} username={u.username} avatarUrl={u.avatar_url ?? null} seed={u.id ?? u.username} />
        <span className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{name}</span>
        {showHandle && <span className="truncate" style={{ color: "#8b8b94", fontSize: 11.5, fontWeight: 400 }}>@{u.username}</span>}
      </a>
    );
  };

  const menuItem: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "#c9c9d2",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 600,
  };

  const isUpcoming = (d: DebateRow) =>
    d.status !== "live" && d.status !== "ended" &&
    !!d.scheduled_start && new Date(d.scheduled_start).getTime() > Date.now();
  const pastAndLive = useMemo(() => debates?.filter((d) => !isUpcoming(d)) ?? null, [debates]);
  const upcoming = useMemo(
    () =>
      debates
        ?.filter(isUpcoming)
        .sort((a, b) => new Date(a.scheduled_start!).getTime() - new Date(b.scheduled_start!).getTime()) ?? null,
    [debates]
  );

  /* "Notify me" bells on scheduled rows — same RPCs as the homepage
     Browse tabs (toggle_room_reminder / get_room_reminders). */
  const [reminders, setReminders] = useState<Record<string, { count: number; amSet: boolean }>>({});
  const [reminderBusy, setReminderBusy] = useState<string | null>(null);
  useEffect(() => {
    const ids = (upcoming ?? []).map((d) => d.id);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("get_room_reminders", { p_rooms: ids });
      if (cancelled || !data) return;
      const map: Record<string, { count: number; amSet: boolean }> = {};
      for (const r of data as { room_id: string; reminder_count: number; am_set: boolean }[]) {
        map[r.room_id] = { count: Number(r.reminder_count), amSet: r.am_set };
      }
      setReminders(map);
    })();
    return () => { cancelled = true; };
  }, [upcoming, supabase, viewerId]);
  const toggleReminder = useCallback(async (roomId: string) => {
    if (!viewerId) { window.location.href = "/login"; return; }
    setReminderBusy(roomId);
    const { data, error } = await supabase.rpc("toggle_room_reminder", { p_room: roomId });
    setReminderBusy(null);
    if (error) return;
    const nowSet = data === true;
    setReminders((m) => {
      const cur = m[roomId] ?? { count: 0, amSet: false };
      return { ...m, [roomId]: { count: Math.max(0, cur.count + (nowSet ? 1 : -1)), amSet: nowSet } };
    });
  }, [supabase, viewerId]);

  /* TikTok-style split: originals under Posts, reposts under Reposts. */
  const ownPosts = useMemo(() => posts?.filter((p) => !p.is_repost) ?? null, [posts]);
  const reposts = useMemo(() => posts?.filter((p) => p.is_repost) ?? null, [posts]);

  /* Repost rows only carry the original author's username; resolve
     avatars for the identity chip in one query. */
  const [avatarByUsername, setAvatarByUsername] = useState<Map<string, { id: string; avatar_url: string | null }>>(new Map());
  useEffect(() => {
    const names = [...new Set((reposts ?? []).map((p) => p.orig_author_username).filter((x): x is string => !!x))]
      .filter((n) => !avatarByUsername.has(n));
    if (names.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("users").select("id, username, avatar_url").in("username", names);
      if (cancelled || !data) return;
      setAvatarByUsername((prev) => {
        const next = new Map(prev);
        for (const u of data as { id: string; username: string; avatar_url: string | null }[]) next.set(u.username, { id: u.id, avatar_url: u.avatar_url });
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reposts, supabase]);

  const counts = useMemo(
    () => ({
      debates: pastAndLive?.length ?? null,
      scheduled: upcoming?.length ?? null,
      posts: ownPosts?.length ?? null,
      reposts: reposts?.length ?? null,
      comments: comments?.length ?? null,
      communities: myCommunities?.length ?? null,
      shorts: clips?.length ?? null,
    }),
    [pastAndLive, upcoming, ownPosts, reposts, comments, myCommunities, clips]
  );

  const socialLinks = useMemo(() => safeSocialLinks(profile?.social_links), [profile]);

  if (notFound) {
    return (
      <div className={`${embedded ? "h-full" : "min-h-screen"} flex flex-col items-center justify-center gap-4`} style={{ background: embedded ? "transparent" : "var(--bg-primary, #0a0a0c)" }}>
        <Wordmark size={24} />
        <p style={{ color: "#8b8b94", fontFamily: "'DM Sans', sans-serif" }}>
          No one by that name here.
        </p>
        <a href="/" style={{ color: "#9cc4f0", fontFamily: "'DM Sans', sans-serif", fontSize: 14 }}>
          ← Back to the Agora
        </a>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={`${embedded ? "h-full py-24" : "min-h-screen"} flex items-center justify-center`} style={{ background: embedded ? "transparent" : "var(--bg-primary, #0a0a0c)" }}>
        <div className="animate-spin" style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid #3b6cf6", borderTopColor: "transparent" }} />
      </div>
    );
  }

  const tabBtn = (key: Tab, label: string, count: number | null) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className="cursor-pointer"
      style={{
        background: tab === key ? "rgba(255,255,255,0.09)" : "transparent",
        border: "none",
        borderRadius: 10,
        padding: "8px 16px",
        color: tab === key ? "#f5f5f0" : "#8b8b94",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: 13.5,
        fontWeight: 600,
      }}
    >
      {label}
      {count !== null && (
        <span style={{ color: "#6b6b74", fontWeight: 400, marginLeft: 6 }}>{count}</span>
      )}
    </button>
  );

  return (
    <div
      className={embedded ? "" : "min-h-screen"}
      style={{
        background: embedded ? "transparent" : "var(--bg-primary, #0a0a0c)",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {!embedded && (
        <div className="flex items-center justify-between px-6 py-4">
          <a href="/" className="no-underline">
            <Wordmark size={20} />
          </a>
          <a href="/" style={{ color: "#8b8b94", fontSize: 13, textDecoration: "none" }}>
            ← Back to the Agora
          </a>
        </div>
      )}

      {/* The homepage's glass sidebar on the standalone route; the
          drawer inside a room stays sidebar-free. Hidden under lg so
          phones keep the single column. */}
      {!embedded && (
        <div className="hidden lg:block">
          <HomeSidebar
            activeId={null}
            onNavigate={(id) => router.push(pathFor.section(id))}
          />
        </div>
      )}

      <main
        className={
          embedded
            ? "max-w-[860px] mx-auto px-6 pb-16"
            : "max-w-[860px] mx-auto px-6 pb-16 profile-beside-sidebar"
        }
      >
        {/* ── Banner. With a photo: everyone sees it. Without one: only the
               owner sees a dark grey placeholder with a hover "?" that opens
               Edit Profile; visitors get the plain header. ── */}
        {(profile.banner_url || isSelf) && (
          <div
            className="overflow-hidden relative profile-banner"
            style={{
              borderRadius: "14px 14px 0 0",
              border: "1px solid rgba(255,255,255,0.08)",
              borderBottom: "none",
              width: "100%",
              aspectRatio: "3 / 1",
              maxHeight: 240,
              background: profile.banner_url ? "rgba(16,16,22,0.88)" : "#141418",
            }}
          >
            {profile.banner_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.banner_url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            )}
            {!profile.banner_url && (
              <span
                aria-hidden
                style={{
                  position: "absolute", inset: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "rgba(255,255,255,0.18)",
                }}
              >
                <Icon name="circle-help" size={40} strokeWidth={1.5} />
              </span>
            )}
            {isSelf && (
              <button
                onClick={() => setEditOpen(true)}
                aria-label={profile.banner_url ? "Change banner" : "Add a banner"}
                title={profile.banner_url ? "Change banner" : "Add a banner (1500×500 works best)"}
                className="cursor-pointer profile-banner-edit"
                style={{
                  position: "absolute", right: 14, bottom: 14,
                  width: 34, height: 34, borderRadius: "50%",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.18)",
                  color: "#e3e3ea", padding: 0,
                  backdropFilter: "blur(8px)",
                }}
              >
                <Icon name="pencil" size={15} />
              </button>
            )}
          </div>
        )}

        {/* ── Header ── */}
        <section
          className="p-6 flex gap-5 flex-wrap items-start"
          style={{
            ...card,
            /* Above the (positioned) banner so the overlapping avatar paints on top. */
            position: "relative",
            zIndex: 1,
            ...((profile.banner_url || isSelf)
              ? { borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: "none" }
              : {}),
          }}
        >
          {/* With a banner, the avatar rides up over its bottom edge,
              ringed in the card color so the crop reads deliberate. */}
          <span
            className="inline-block shrink-0"
            style={
              profile.banner_url
                ? { marginTop: -52, borderRadius: "50%", border: "4px solid #101016", background: "#101016", lineHeight: 0 }
                : { lineHeight: 0 }
            }
          >
            <UserAvatar size={92} username={profile.username} avatarUrl={profile.avatar_url} seed={profile.id} />
          </span>
          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="m-0" style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 25, fontWeight: 700, letterSpacing: "-0.02em", color: "#f5f5f0" }}>
                {displayName(profile)}
              </h1>
              {profile.verified && <VerifiedBadge size={20} />}
              {profile.live_room_id && (
                <a
                  href={roomPath({ id: profile.live_room_id, motion: profile.live_room_motion ?? null })}
                  className="no-underline inline-flex items-center gap-1.5"
                  style={{
                    padding: "3px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(224,90,90,0.5)",
                    background: "rgba(224,90,90,0.12)",
                    color: "#e05a5a",
                    fontSize: 11.5,
                    fontWeight: 700,
                    maxWidth: 260,
                  }}
                  title={profile.live_room_motion ?? "Live now"}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <circle cx="4" cy="4" r="3" fill="#e05a5a">
                      <animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite" />
                    </circle>
                  </svg>
                  LIVE
                  {profile.live_room_motion && (
                    <span
                      style={{
                        color: "#f0b7b7",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {profile.live_room_motion}
                    </span>
                  )}
                </a>
              )}
            </div>
            <p className="m-0 mt-1" style={{ color: "#8b8b94", fontSize: 13.5 }}>
              @{profile.username} · joined{" "}
              {new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </p>
            {profile.bio && (
              <p className="m-0 mt-3" style={{ color: "#c9c9d2", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap", maxWidth: 620 }}>
                {profile.bio}
              </p>
            )}
            <div className="flex items-center gap-5 mt-3.5 flex-wrap">
              <button
                onClick={() => setListMode("followers")}
                className="cursor-pointer bg-transparent border-none p-0"
                style={{ color: "#c9c9d2", fontSize: 13.5, fontFamily: "inherit" }}
              >
                <strong style={{ color: "#f5f5f0" }}>{profile.follower_count}</strong> followers
              </button>
              <button
                onClick={() => setListMode("following")}
                className="cursor-pointer bg-transparent border-none p-0"
                style={{ color: "#c9c9d2", fontSize: 13.5, fontFamily: "inherit" }}
              >
                <strong style={{ color: "#f5f5f0" }}>{profile.following_count}</strong> following
              </button>
              {typeof profile.karma === "number" && (
                <span style={{ color: "#c9c9d2", fontSize: 13.5 }}>
                  <strong style={{ color: "#f5f5f0" }}>{profile.karma}</strong> karma
                </span>
              )}
              {profile.is_friend && (
                <span
                  className="inline-flex items-center gap-1.5"
                  title="You follow each other"
                  style={{
                    color: "#6fd3a0", fontSize: 12, fontWeight: 600,
                    padding: "3px 10px 3px 8px", borderRadius: 999,
                    background: "rgba(111,211,160,0.10)", border: "1px solid rgba(111,211,160,0.3)",
                  }}
                >
                  <Icon name="user-check" size={13} /> Friends
                </span>
              )}
            </div>
            {!isSelf && Array.isArray(profile.mutual_names) && profile.mutual_names.length > 0 && (
              <p className="m-0 mt-2" style={{ color: "#8b8b94", fontSize: 12.5 }}>
                Also followed by{" "}
                {profile.mutual_names.map((name, i, arr) => (
                  <span key={name}>
                    <a
                      href={userPath(name)}
                      style={{ color: "#c9c9d2", textDecoration: "none", fontWeight: 600 }}
                    >
                      {name}
                    </a>
                    {i < arr.length - 2 ? ", " : i === arr.length - 2 ? " and " : ""}
                  </span>
                ))}
              </p>
            )}
          </div>

          {/* Right column: social icons above the action buttons. */}
          {/* self-stretch + justify-between: icon row rides the name line,
              buttons settle level with the stats row. */}
          <div className="flex flex-col items-end justify-between gap-3 shrink-0 relative self-stretch" ref={menuRef}>
            {socialLinks.length > 0 && (
              <div className="flex items-center gap-1.5">
                {socialLinks.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    title={socialLabel(url)}
                    aria-label={socialLabel(url)}
                    className="inline-flex items-center justify-center no-underline transition-colors"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.05)",
                      color: "#a9a9b4",
                    }}
                  >
                    {socialIcon(url)}
                  </a>
                ))}
              </div>
            )}

            {isSelf && (
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setEditOpen(true)}
                  className="cursor-pointer"
                  style={{
                    padding: "8px 20px",
                    borderRadius: 999,
                    border: "none",
                    background: "#3b6cf6",
                    color: "white",
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Edit profile
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard
                      .writeText(`${window.location.origin}${userPath(profile.username)}`)
                      .then(() => {
                        setShared(true);
                        setTimeout(() => setShared(false), 1800);
                      });
                  }}
                  className="cursor-pointer inline-flex items-center justify-center gap-1.5"
                  style={{
                    padding: "8px 20px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: shared ? "rgba(111,211,160,0.12)" : "rgba(255,255,255,0.05)",
                    color: shared ? "#6fd3a0" : "#c9c9d2",
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {shared ? <><Icon name="check" size={13} /> Link copied</> : "Share profile"}
                </button>
              </div>
            )}

            {!isSelf && (
              <div className="flex flex-col items-end gap-2 relative">
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleFollow}
                  disabled={busy}
                  className="cursor-pointer"
                  style={{
                    height: 38,
                    padding: "0 22px",
                    borderRadius: 999,
                    border: profile.is_following ? "1px solid rgba(255,255,255,0.18)" : "none",
                    background: profile.is_following ? "transparent" : "#3b6cf6",
                    color: profile.is_following ? "#c9c9d2" : "white",
                    fontFamily: "inherit",
                    fontSize: 13.5,
                    fontWeight: 600,
                  }}
                >
                  {profile.is_following ? "Following" : profile.is_friend ? "Add friend back" : "Add friend"}
                </button>
                {profile.is_friend && (
                  <button
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent("agora:dm", {
                        detail: { userId: profile.id, username: profile.username, avatarUrl: profile.avatar_url ?? null },
                      }))
                    }
                    className="cursor-pointer inline-flex items-center gap-1.5"
                    style={{
                      height: 38,
                      padding: "0 18px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(255,255,255,0.05)",
                      color: "#c9c9d2",
                      fontFamily: "inherit",
                      fontSize: 13.5,
                      fontWeight: 600,
                    }}
                  >
                    <Icon name="message-circle" size={13} /> Message
                  </button>
                )}
                {viewerId && (
                  <button
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-label="More options"
                    aria-expanded={menuOpen}
                    className="cursor-pointer"
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: menuOpen ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.05)",
                      color: "#c9c9d2",
                      fontFamily: "inherit",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name="more-horizontal" size={16} />
                  </button>
                )}
              </div>
              {menuOpen && (
                <div
                  className="absolute z-50"
                  style={{
                    top: 42,
                    right: 0,
                    minWidth: 190,
                    background: "rgba(18,18,21,0.97)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 12,
                    boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
                    padding: 5,
                  }}
                >
                  <button
                    onClick={toggleBlock}
                    className="cursor-pointer w-full text-left"
                    style={{ ...menuItem, color: "#e58a8a" }}
                  >
                    <Icon name="ban" size={14} />
                    {blocked ? `Unblock @${profile.username}` : `Block @${profile.username}`}
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setReportTarget({
                        userId: profile.id,
                        username: profile.username,
                        context: "profile",
                      });
                    }}
                    className="cursor-pointer w-full text-left"
                    style={menuItem}
                  >
                    <Icon name="flag" size={14} />
                    Report
                  </button>
                  {viewerIsMod && (
                    <>
                      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "5px 6px" }} />
                      <p className="m-0" style={{ padding: "3px 12px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#6b6b74" }}>
                        MODERATOR
                      </p>
                      <button
                        onClick={() => { setMenuOpen(false); toggleVerified(); }}
                        disabled={busy}
                        className="cursor-pointer w-full text-left"
                        style={{ ...menuItem, color: profile.verified ? "#c9c9d2" : "#93bbfd" }}
                      >
                        <Icon name={profile.verified ? "circle-x" : "check"} size={14} />
                        {profile.verified ? "Remove verified badge" : "Verify account"}
                      </button>
                    </>
                  )}
                </div>
              )}
              {blockNote && (
                <p className="m-0 text-center" style={{ color: "#8b8b94", fontSize: 11.5 }}>
                  {blockNote}
                </p>
              )}
              </div>
            )}
          </div>
        </section>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1.5 mt-5 mb-4 flex-wrap">
          {tabBtn("debates", "Discussions", counts.debates)}
          {tabBtn("scheduled", "Scheduled", counts.scheduled)}
          {tabBtn("posts", "Posts", counts.posts)}
          {tabBtn("reposts", "Reposts", counts.reposts)}
          {tabBtn("comments", "Comments", counts.comments)}
          {tabBtn("communities", "Communities", counts.communities)}
          {tabBtn("shorts", "Shorts", counts.shorts)}
        </div>

        {/* ── Communities ── */}
        {tab === "communities" && (
          <div className="flex flex-col gap-2.5">
            {myCommunities === null ? (
              <p style={{ color: "#6b6b74", fontSize: 13 }}>Loading…</p>
            ) : myCommunities.length === 0 ? (
              emptyState(
                "users",
                isSelf ? "Not in any communities yet" : `${first} hasn't joined a community`,
                isSelf ? "Join a board to post, comment, and get its discussions in your feed." : "Communities they join will be listed here.",
                isSelf ? { label: "Browse communities", href: "/communities" } : undefined,
              )
            ) : (
              myCommunities.map((c) => {
                const roleTag =
                  c.role === "owner" ? "owner" : c.role === "mod" || c.role === "moderator" ? "mod" : null;
                const inner = (
                  <>
                    {c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.avatar_url}
                        alt=""
                        style={{ width: 28, height: 28, borderRadius: 9, objectFit: "cover", flexShrink: 0 }}
                      />
                    ) : (
                      <span
                        className="flex items-center justify-center shrink-0"
                        style={{ width: 28, height: 28, borderRadius: 9, background: c.color ?? "#4a9eff", color: "#fff", fontSize: 13, fontWeight: 700 }}
                      >
                        {c.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="flex-1 min-w-0 text-left">
                      <p className="m-0 flex items-center gap-2" style={{ color: "#f5f5f0", fontSize: 14, fontWeight: 600 }}>
                        {c.name}
                        {roleTag && (
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 700,
                              padding: "1px 6px",
                              borderRadius: 999,
                              background: "rgba(244,212,124,0.10)",
                              border: "0.5px solid rgba(244,212,124,0.35)",
                              color: "#f4d47c",
                              letterSpacing: 0.3,
                            }}
                          >
                            {roleTag}
                          </span>
                        )}
                      </p>
                      <p className="m-0 mt-0.5" style={{ color: "#8b8b94", fontSize: 11.5 }}>
                        {c.member_count} member{c.member_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span style={{ color: "#6b6b74", fontSize: 12 }}>→</span>
                  </>
                );
                /* Real link to the board. Inside the room drawer it opens in
                   a new tab so the viewer isn't yanked out of a live debate. */
                return (
                  <a
                    key={c.id}
                    href={pathFor.community(slugify(c.name))}
                    target={embedded ? "_blank" : undefined}
                    rel={embedded ? "noopener noreferrer" : undefined}
                    className="no-underline px-4 py-3 flex items-center gap-3 w-full"
                    style={{ ...card, color: "#c9c9d2" }}
                  >
                    {inner}
                  </a>
                );
              })
            )}
          </div>
        )}

        {/* ── Debates ── */}
        {tab === "debates" && (
          <div className="flex flex-col gap-2.5">
            {pastAndLive === null ? (
              <p style={{ color: "#6b6b74", fontSize: 13 }}>Loading…</p>
            ) : pastAndLive.length === 0 ? (
              emptyState(
                "mic",
                isSelf ? "No discussions yet" : `${first} hasn't joined a discussion yet`,
                isSelf ? "Host or join a live discussion and your history builds here." : "Their live and past discussions will show up here.",
                isSelf ? { label: "Start a discussion", href: "/?create=1" } : undefined,
              )
            ) : (
              pastAndLive.map((d) => {
                const topic = TOPICS.find((t) => t.key === d.topic_key);
                const live = d.status === "live";
                const inner = (
                  <>
                    <div className="flex-1 min-w-[220px]">
                      <p className="m-0 mb-1.5 flex items-center gap-1.5">
                        {d.role === "host" || !d.host_username
                          ? identity(profile)
                          : identity({ id: d.host_id, username: d.host_username, display_name: d.host_display_name, avatar_url: d.host_avatar_url })}
                        <span style={{ color: "#6b6b74", fontSize: 11 }}>· host</span>
                      </p>
                      <p className="m-0" style={{ fontSize: 14.5, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
                        <a href={roomPath({ id: d.id, motion: d.motion })} className="stretched-link no-underline" style={{ color: "#f5f5f0" }}>
                          {d.motion || "Untitled discussion"}
                        </a>
                      </p>
                      <p className="m-0 mt-1" style={{ color: "#8b8b94", fontSize: 11.5 }}>
                        {live ? (
                          <span style={{ color: "#e05a5a", fontWeight: 700 }}>● LIVE · </span>
                        ) : (
                          `${timeAgo(d.created_at)} ago · `
                        )}
                        {d.role === "host" ? "hosted" : "spoke"}
                        {topic ? ` · ${topic.label}` : ""}
                      </p>
                    </div>
                    <span
                      className="inline-flex items-center gap-1"
                      style={{ color: live ? "#e05a5a" : "#8b8b94", fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}
                    >
                      <Icon name="play" size={12} /> {live ? "Watch live" : "Replay"}
                    </span>
                  </>
                );
                /* Live rooms open the amphitheater; ended ones open the
                   replay (recording + transcript + discussion) at the same URL. */
                return (
                  <div key={d.id} className="row-card px-4 py-3 flex items-center gap-3 flex-wrap" style={card}>
                    {inner}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Scheduled ── */}
        {tab === "scheduled" && (
          <div className="flex flex-col gap-2.5">
            {upcoming === null ? (
              <p style={{ color: "#6b6b74", fontSize: 13 }}>Loading…</p>
            ) : upcoming.length === 0 ? (
              emptyState(
                "calendar",
                isSelf ? "Nothing on the calendar" : `${first} has nothing scheduled`,
                isSelf
                  ? "Schedule a discussion and it shows up here — people can hit the bell to be notified when you go live."
                  : "When they schedule a discussion it appears here, and you can tap the bell to get notified when it starts.",
                isSelf ? { label: "Schedule a discussion", href: "/?create=schedule" } : undefined,
              )
            ) : (
              upcoming.map((d) => {
                const topic = TOPICS.find((t) => t.key === d.topic_key);
                return (
                  <div
                    key={d.id}
                    className="row-card px-4 py-3 flex items-center gap-3 flex-wrap"
                    style={card}
                  >
                    <div className="flex-1 min-w-[220px]">
                      <p className="m-0 mb-1.5 flex items-center gap-1.5">
                        {d.role === "host" || !d.host_username
                          ? identity(profile)
                          : identity({ id: d.host_id, username: d.host_username, display_name: d.host_display_name, avatar_url: d.host_avatar_url })}
                        <span style={{ color: "#6b6b74", fontSize: 11 }}>· host</span>
                      </p>
                      <p className="m-0" style={{ fontSize: 14.5, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
                        <a href={roomPath({ id: d.id, motion: d.motion })} className="stretched-link no-underline" style={{ color: "#f5f5f0" }}>{d.motion || "Untitled discussion"}</a>
                      </p>
                      <p className="m-0 mt-1" style={{ color: "#f4d47c", fontSize: 11.5, fontWeight: 600 }}>
                        {new Date(d.scheduled_start!).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        <span style={{ color: "#8b8b94", fontWeight: 400 }}>
                          {" "}· {d.role === "host" ? "hosting" : "speaking"}
                          {topic ? ` · ${topic.label}` : ""}
                          {(reminders[d.id]?.count ?? 0) > 0 && ` · ${reminders[d.id].count} waiting`}
                        </span>
                      </p>
                    </div>
                    {(() => {
                      const set = !!reminders[d.id]?.amSet;
                      return (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleReminder(d.id); }}
                          disabled={reminderBusy === d.id}
                          title={set ? "Reminder set — click to remove" : "Notify me when this goes live"}
                          aria-pressed={set}
                          className="cursor-pointer row-inner-link"
                          style={{
                            width: 34, height: 34, borderRadius: "50%",
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            padding: 0, flexShrink: 0,
                            background: set ? "rgba(226,185,107,0.92)" : "rgba(255,255,255,0.05)",
                            border: set ? "1px solid #d9a238" : "1px solid rgba(255,255,255,0.14)",
                            color: set ? "#3a2a05" : "#c9c9d2",
                          }}
                        >
                          <Icon name="bell" size={15} />
                        </button>
                      );
                    })()}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Posts / Reposts (shared card; row click deep-links into the
               Communities view on that post) ── */}
        {(tab === "posts" || tab === "reposts") && (() => {
          const rows = tab === "posts" ? ownPosts : reposts;
          const postCard = (p: PostRow) => (
            <div
              key={p.id}
              className="row-card block px-4 py-3"
              style={card}
            >
              <p className="m-0 mb-1 flex items-center gap-1.5 flex-wrap" style={{ color: "#8b8b94", fontSize: 11 }}>
                {identity(profile)}
                <span>·</span>
                {p.is_repost && <span className="inline-flex items-center gap-1" style={{ color: "#c9b06a" }}><Icon name="repeat" size={11} /> reposted to</span>}
                <span>{rowLink(communityHref(p.community_name), p.community_name)} · {timeAgo(p.created_at)} ago</span>
                {p.tag_name && (
                  <span
                    className="rounded-full"
                    style={{
                      fontSize: 9.5, padding: "1px 7px", fontWeight: 600,
                      background: `${p.tag_color || "#8b8b94"}22`,
                      border: `0.5px solid ${p.tag_color || "#8b8b94"}66`,
                      color: p.tag_color || "#8b8b94",
                    }}
                  >
                    {p.tag_name}
                  </span>
                )}
              </p>
              <p className="m-0 mt-1" style={{ fontSize: 14.5, fontWeight: 600 }}>
                <a href={pathFor.post(p.id)} className="stretched-link no-underline" style={{ color: "#f5f5f0" }}>{p.title}</a>
              </p>
              {p.body && (
                <p
                  className="m-0 mt-1"
                  style={{
                    color: "#a9a9b4",
                    fontSize: 13,
                    lineHeight: 1.5,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {p.body}
                </p>
              )}
              {p.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt="" className="mt-1.5 rounded-lg"
                  style={{ maxHeight: 180, maxWidth: "100%", objectFit: "cover" }} />
              )}
              {p.is_repost && (
                <p className="m-0 mt-1.5 px-3 py-2 rounded-lg" style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "0.5px solid rgba(255,255,255,0.08)",
                  color: "#8b8b94", fontSize: 11.5,
                }}>
                  {p.repost_of
                    ? <>from {p.orig_community_name ? rowLink(communityHref(p.orig_community_name), p.orig_community_name, "#c9b06a") : <span style={{ color: "#c9b06a" }}>a community</span>}
                        {p.orig_author_username && <> · {identity({
                          id: avatarByUsername.get(p.orig_author_username)?.id,
                          username: p.orig_author_username,
                          display_name: p.orig_author_display_name,
                          avatar_url: avatarByUsername.get(p.orig_author_username)?.avatar_url ?? null,
                        }, 16)}</>}</>
                    : "The original post was deleted."}
                </p>
              )}
              <p className="m-0 mt-1.5" style={{ color: "#6b6b74", fontSize: 11 }}>
                <Icon name="arrow-up" size={11} /> {p.score} · <Icon name="message-circle" size={11} /> {p.comment_count}
              </p>
            </div>
          );
          return (
            <div className="flex flex-col gap-2.5">
              {rows === null ? (
                <p style={{ color: "#6b6b74", fontSize: 13 }}>Loading…</p>
              ) : rows.length === 0 ? (
                emptyState(
                  tab === "posts" ? "pencil" : "repeat",
                  tab === "posts"
                    ? (isSelf ? "No posts yet" : `${first} hasn't posted yet`)
                    : (isSelf ? "No reposts yet" : `${first} hasn't reposted anything`),
                  tab === "posts"
                    ? (isSelf ? "Posts you write in any community show up here." : "Their community posts will appear here.")
                    : (isSelf ? "Repost something from a community to share it with another." : "Posts they share across communities will appear here."),
                  isSelf ? { label: tab === "posts" ? "Write a post" : "Browse communities", href: "/communities" } : undefined,
                )
              ) : (
                rows.map(postCard)
              )}
            </div>
          );
        })()}

        {/* ── Comments (deep-links to the parent post, like Posts rows) ── */}
        {tab === "comments" && (
          <div className="flex flex-col gap-2.5">
            {comments === null ? (
              <p style={{ color: "#6b6b74", fontSize: 13 }}>Loading…</p>
            ) : comments.length === 0 ? (
              emptyState(
                "message-circle",
                isSelf ? "No comments yet" : `${first} hasn't commented yet`,
                isSelf ? "Join a thread — your comments across communities collect here." : "Their comments across communities will show up here.",
                isSelf ? { label: "Find a thread", href: "/communities" } : undefined,
              )
            ) : (
              <>
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className="row-card block px-4 py-3"
                    style={card}
                  >
                    <p className="m-0 mb-1 flex items-center gap-1.5 flex-wrap" style={{ color: "#8b8b94", fontSize: 11 }}>
                      {identity(profile)}
                      <span>·</span>
                      <span>commented in {rowLink(communityHref(c.community_name), c.community_name)} · <span style={{ color: "#a9a9b4" }}>{c.post_title}</span></span>
                    </p>
                    <p
                      className="m-0 mt-1"
                      style={{
                        color: "#e3e3ea",
                        fontSize: 13.5,
                        lineHeight: 1.5,
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      <a href={`${pathFor.post(c.post_id)}#comment-${c.id}`} className="stretched-link no-underline" style={{ color: "inherit" }}>{c.body}</a>
                    </p>
                    {c.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.image_url}
                        alt=""
                        className="mt-1.5 rounded-lg"
                        style={{ maxHeight: 90, maxWidth: 140, objectFit: "cover" }}
                      />
                    )}
                    <p className="m-0 mt-1.5" style={{ color: "#6b6b74", fontSize: 11 }}>
                      <Icon name="arrow-up" size={11} /> {c.score} · {timeAgo(c.created_at)} ago
                    </p>
                  </div>
                ))}
                {commentsHasMore && (
                  <button
                    onClick={loadMoreComments}
                    disabled={commentsBusy}
                    className="cursor-pointer py-2.5"
                    style={{
                      ...card,
                      color: commentsBusy ? "#6b6b74" : "#9cc4f0",
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {commentsBusy ? "Loading…" : "Load more"}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Shorts ── */}
        {tab === "shorts" && (
          <div>
            {clips === null ? (
              <p style={{ color: "#6b6b74", fontSize: 13 }}>Loading…</p>
            ) : clips.length === 0 ? (
              emptyState(
                "play",
                isSelf ? "No shorts yet" : `${first} has no shorts`,
                "Clips from recorded discussions will land here.",
              )
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                {clips.map((c) => (
                  <a
                    key={c.id}
                    href={c.video_url ?? "#"}
                    target={c.video_url ? "_blank" : undefined}
                    rel="noreferrer"
                    className="no-underline flex flex-col justify-end p-3"
                    style={{
                      aspectRatio: "9 / 14",
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: c.thumb_gradient || "linear-gradient(160deg,#23233a,#101018)",
                    }}
                  >
                    <p className="m-0" style={{ color: "white", fontSize: 12.5, fontWeight: 600, textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>
                      {c.title || "Untitled short"}
                    </p>
                    <p className="m-0 mt-0.5" style={{ color: "rgba(255,255,255,0.75)", fontSize: 10.5 }}>
                      {c.view_count ?? 0} views
                      {c.duration_seconds ? ` · ${c.duration_seconds}s` : ""}
                    </p>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {profile && (
        <EditProfileModal
          open={editOpen}
          userId={profile.id}
          initialUsername={profile.username}
          initialDisplayName={profile.display_name}
          initialAvatarUrl={profile.avatar_url}
          initialBio={profile.bio}
          usernameChangedAt={profile.username_changed_at}
          accountCreatedAt={profile.created_at}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            loadProfile();
          }}
        />
      )}

      <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />

      <FollowListModal
        open={listMode !== null}
        userId={profile.id}
        mode={listMode ?? "followers"}
        onClose={() => setListMode(null)}
        onOpenProfile={(id) => {
          setListMode(null);
          (async () => {
            const { data } = await supabase.from("users").select("username").eq("id", id).maybeSingle();
            if (data?.username) router.push(userPath(data.username));
          })();
        }}
      />
    </div>
  );
}
