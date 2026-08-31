"use client";

/* "Your feed" — the signed-in home. One ranked stream from
   get_home_feed (live rooms, upcoming rooms, community posts/reposts,
   and — under Following — comments by people you follow), with a
   Live-now rail on top and "People to follow" woven in for accounts
   that follow fewer than five people.

   Overlay panel like TrendingPage: `open` / `onClose`, same chrome as
   CommunitiesPage. Signed-out visitors see a sign-in prompt and nothing
   is fetched. Posts open at /posts/<id> through the shell's router
   (pushState + popstate, which page.tsx re-parses). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import useEscapeClose from "@/lib/useEscapeClose";
import { pathFor } from "@/lib/routes";
import { roomPath, replayPath } from "@/lib/urls";
import { TOPICS } from "@/types/database";
import RoomCard, { type RoomCardRoom } from "@/components/RoomCard";
import UserAvatar from "@/components/UserAvatar";
import PostCard, { RepostEmbed, authorLabel, timeAgo, type PostRow } from "@/components/community/PostCard";
import PeopleSuggestions from "@/components/people/PeopleSuggestions";
import FeedRail from "@/components/feed/FeedRail";
import { useUserMenu } from "@/components/userMenuContext";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Filter = "all" | "following" | "communities" | "popular";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "following", label: "Following" },
  { id: "communities", label: "My communities" },
  { id: "popular", label: "Popular" },
];
const FILTER_KEY = "agora:feed-filter";
const PAGE = 30;

type RoomPayload = RoomCardRoom & {
  speakers: number;
  reminder_count: number;
  am_set: boolean;
  created_at: string;
};

type CommentPayload = {
  id: string;
  post_id: string;
  post_title: string;
  body: string;
  created_at: string;
  community_name: string;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null };
};

type FeedPost = PostRow & { author_avatar_url?: string | null; community_color?: string | null };

type FeedItem =
  | { kind: "live" | "scheduled" | "replay"; item_id: string; score: number; created_at: string; reason: string; payload: RoomPayload }
  | { kind: "post" | "repost"; item_id: string; score: number; created_at: string; reason: string; payload: FeedPost }
  | { kind: "comment"; item_id: string; score: number; created_at: string; reason: string; payload: CommentPayload };

const card: React.CSSProperties = {
  background: "rgba(14,14,17,0.72)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14,
};

const btnGhost: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "0.5px solid rgba(255,255,255,0.14)",
  color: "rgba(238,238,245,0.8)",
  fontFamily: "inherit",
};

/** Navigate inside the homepage shell: push the path and let page.tsx
    re-parse it (its popstate listener reads window.location). */
function shellNavigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hours = (d.getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return "starting now";
  if (hours < 1) return `in ${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `in ${Math.round(hours)}h · ` + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Reason({ text }: { text: string }) {
  return (
    <p className="m-0 mb-1 text-[10.5px] inline-flex items-center gap-1" style={{ color: "rgba(238,238,245,0.38)" }}>
      <Icon name="sparkles" size={11} /> {text}
    </p>
  );
}

export default function FeedPage({ open, onClose }: Props) {
  const [supabase] = useState(() => createClient());
  const { openUserMenu } = useUserMenu();
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminderBusy, setReminderBusy] = useState<string | null>(null);
  const [suggestionCount, setSuggestionCount] = useState<number | null>(null);
  const loadSeq = useRef(0);

  useEscapeClose(open, onClose);

  /* Persisted filter choice. */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FILTER_KEY);
      if (saved && FILTERS.some((f) => f.id === saved)) setFilter(saved as Filter);
    } catch { /* private mode */ }
  }, []);
  const pickFilter = (f: Filter) => {
    setFilter(f);
    try { localStorage.setItem(FILTER_KEY, f); } catch { /* private mode */ }
  };

  /* Auth + how many people I follow (drives the suggestions placement). */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (cancelled) return;
      const uid = auth?.user?.id ?? null;
      setUserId(uid);
      if (!uid) return;
      const { count } = await supabase
        .from("user_follows").select("*", { count: "exact", head: true }).eq("follower_id", uid);
      if (!cancelled) setFollowingCount(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [open, supabase]);

  const load = useCallback(async (before: string | null) => {
    const seq = ++loadSeq.current;
    if (before) setLoadingMore(true); else setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("get_home_feed", {
      p_filter: filter, p_limit: PAGE, p_before: before,
    });
    if (seq !== loadSeq.current) return;
    setLoading(false);
    setLoadingMore(false);
    if (err) {
      setError(err.message.includes("does not exist")
        ? "The feed isn't set up on this database yet (migration 20260849 pending)."
        : "Couldn't load your feed — try again.");
      if (!before) setItems([]);
      return;
    }
    const rows = (data ?? []) as FeedItem[];
    setItems((prev) => {
      if (!before || !prev) return rows;
      const seen = new Set(prev.map((i) => i.item_id));
      return [...prev, ...rows.filter((r) => !seen.has(r.item_id))];
    });
    /* Rooms only ride on the first page; "more" means a full page of
       dated items came back. */
    setHasMore(rows.filter((r) => r.kind !== "live" && r.kind !== "scheduled").length >= PAGE * 0.8);
  }, [supabase, filter]);

  useEffect(() => {
    if (!open || !userId) return;
    load(null);
  }, [open, userId, load]);

  /* Live rail stays fresh: debate_rooms status changes re-fetch the
     first page (debounced; the ranked stream below is cheap to re-rank). */
  useEffect(() => {
    if (!open || !userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("home-feed-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "debate_rooms" }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => load(null), 1500);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [open, userId, supabase, load]);

  /* Optimistic post votes (vote_post, as CommunitiesPage). */
  const vote = useCallback(async (post: FeedPost, value: number) => {
    if (!userId) { window.location.href = "/login"; return; }
    const delta = value - (post.my_vote ?? 0);
    const patch = (fn: (p: FeedPost) => FeedPost) =>
      setItems((list) => list?.map((i) =>
        (i.kind === "post" || i.kind === "repost") && i.payload.id === post.id ? { ...i, payload: fn(i.payload) } : i) ?? list);
    patch((p) => ({ ...p, score: p.score + delta, my_vote: value === 0 ? null : value }));
    const { error: err } = await supabase.rpc("vote_post", { p_post: post.id, p_value: value });
    if (err) patch((p) => ({ ...p, score: post.score, my_vote: post.my_vote }));
  }, [supabase, userId]);

  const toggleReminder = useCallback(async (roomId: string) => {
    if (!userId) { window.location.href = "/login"; return; }
    setReminderBusy(roomId);
    const { data, error: err } = await supabase.rpc("toggle_room_reminder", { p_room: roomId });
    setReminderBusy(null);
    if (err) return;
    const nowSet = data === true;
    setItems((list) => list?.map((i) =>
      i.kind === "scheduled" && i.payload.id === roomId
        ? { ...i, payload: { ...i.payload, am_set: nowSet, reminder_count: Math.max(0, i.payload.reminder_count + (nowSet ? 1 : -1)) } }
        : i) ?? list);
  }, [supabase, userId]);

  const live = useMemo(() => (items ?? []).filter((i) => i.kind === "live"), [items]);
  const stream = useMemo(() => (items ?? []).filter((i) => i.kind !== "live"), [items]);

  const authorChip = (id: string | null, username: string, dn: string | null, avatar?: string | null) =>
    id ? (
      <span
        onClick={(e) => { e.stopPropagation(); openUserMenu({ x: e.clientX, y: e.clientY }, { userId: id, username }); }}
        className="cursor-pointer inline-flex items-center gap-1"
        style={{ textDecoration: "underline dotted rgba(255,255,255,0.25)", textUnderlineOffset: 2 }}
      >
        <UserAvatar size={14} username={username} avatarUrl={avatar ?? null} seed={id} />
        {authorLabel(dn, username)}
      </span>
    ) : <>{authorLabel(dn, username)}</>;

  const openPost = (id: string) => shellNavigate(pathFor.post(id));

  if (!open) return null;

  const showSuggestionsInline = userId && followingCount !== null && followingCount < 5;

  const renderItem = (it: FeedItem) => {
    if (it.kind === "post" || it.kind === "repost") {
      const p = it.payload;
      return (
        <PostCard
          key={it.item_id}
          post={p}
          onOpen={(x) => openPost(x.id)}
          onVote={vote}
          showCommunity
          onOpenCommunity={() => shellNavigate(pathFor.community(null))}
          author={authorChip(p.author_id, p.author_username, p.author_display_name, p.author_avatar_url)}
          reason={it.reason}
          embed={<RepostEmbed post={p} onOpenOriginal={openPost} />}
        />
      );
    }
    if (it.kind === "scheduled") {
      const r = it.payload;
      const topic = TOPICS.find((t) => t.key === r.topic_key);
      return (
        <div key={it.item_id} className="p-4 mb-3 flex items-center gap-3" style={card}>
          <div className="flex-1 min-w-0">
            <Reason text={it.reason} />
            <p className="m-0 text-[10.5px] flex items-center gap-1.5" style={{ color: "rgba(238,238,245,0.5)" }}>
              <span className="text-[9px] font-bold rounded" style={{ background: "rgba(139,92,246,0.18)", border: "0.5px solid rgba(139,92,246,0.5)", color: "#c4b5fd", padding: "1px 6px", letterSpacing: "0.06em" }}>SCHEDULED</span>
              {r.host && authorChip(r.host.id, r.host.username, r.host.display_name ?? null, r.host.avatar_url)}
              {r.community && <><span>·</span><span style={{ color: "#e2b96b" }}>{r.community.name}</span></>}
            </p>
            <p className="m-0 mt-1 text-[14px] font-medium" style={{ color: "#eeeef5" }}>
              <a href={roomPath(r)} className="no-underline" style={{ color: "inherit" }}>{r.motion}</a>
            </p>
            <p className="m-0 mt-1 text-[11.5px] flex items-center gap-2 flex-wrap" style={{ color: "#f4d47c", fontWeight: 600 }}>
              {whenLabel(r.scheduled_start)}
              {topic && (
                <span className="rounded-full" style={{ fontSize: 9.5, padding: "1px 7px", background: `${topic.color}22`, border: `0.5px solid ${topic.color}66`, color: topic.color, fontWeight: 600 }}>
                  {topic.label}
                </span>
              )}
              {r.reminder_count > 0 && <span style={{ color: "#8b8b94", fontWeight: 400 }}>{r.reminder_count} waiting</span>}
            </p>
          </div>
          <button
            onClick={() => toggleReminder(r.id)}
            disabled={reminderBusy === r.id}
            title={r.am_set ? "Reminder set — click to remove" : "Notify me when this goes live"}
            aria-pressed={r.am_set}
            className="cursor-pointer"
            style={{
              width: 34, height: 34, borderRadius: "50%",
              display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0,
              background: r.am_set ? "rgba(226,185,107,0.92)" : "rgba(255,255,255,0.05)",
              border: r.am_set ? "1px solid #d9a238" : "1px solid rgba(255,255,255,0.14)",
              color: r.am_set ? "#3a2a05" : "#c9c9d2",
            }}
          >
            <Icon name="bell" size={15} />
          </button>
        </div>
      );
    }
    if (it.kind === "replay") {
      const r = it.payload;
      const topic = TOPICS.find((t) => t.key === r.topic_key);
      return (
        <div
          key={it.item_id}
          role="link"
          tabIndex={0}
          onClick={() => { window.location.href = replayPath(r); }}
          onKeyDown={(e) => { if (e.key === "Enter") window.location.href = replayPath(r); }}
          className="p-3 mb-3 flex gap-4 items-center cursor-pointer"
          style={{ ...card, padding: 18 }}
        >
          <div style={{ position: "relative", width: 208, height: 117, borderRadius: 10, overflow: "hidden", flexShrink: 0, background: "#15151b", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {r.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.thumbnail_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <UserAvatar size={208} radius={0} username={r.host?.username} avatarUrl={r.host?.avatar_url ?? null} seed={r.host?.id} />
            )}
            <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.22)" }}>
              <span style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(10,10,14,0.72)", border: "0.5px solid rgba(255,255,255,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="play" size={13} style={{ fill: "#fff", marginLeft: 2 }} />
              </span>
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <Reason text={it.reason} />
            <p className="m-0 text-[15.5px] font-medium" style={{ color: "#eeeef5", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {r.motion}
            </p>
            <p className="m-0 mt-1 text-[10.5px] flex items-center gap-1.5" style={{ color: "rgba(238,238,245,0.5)" }}>
              {r.host && authorChip(r.host.id, r.host.username, r.host.display_name ?? null, r.host.avatar_url)}
              {r.community && <><span>·</span><span style={{ color: "#e2b96b" }}>{r.community.name}</span></>}
            </p>
            <p className="m-0 mt-1 text-[11px] flex items-center gap-2 flex-wrap">
              <span style={{ color: "#4a9eff", fontWeight: 600 }}>▶ Watch discussion</span>
              {topic && (
                <span className="rounded-full" style={{ fontSize: 9.5, padding: "1px 7px", background: `${topic.color}22`, border: `0.5px solid ${topic.color}66`, color: topic.color, fontWeight: 600 }}>
                  {topic.label}
                </span>
              )}
            </p>
          </div>
        </div>
      );
    }
    if (it.kind === "comment") {
      const c = it.payload;
      return (
        <div
          key={it.item_id}
          className="px-4 py-3 mb-3 cursor-pointer"
          style={card}
          onClick={() => shellNavigate(pathFor.post(c.post_id, c.id))}
        >
          <Reason text={it.reason} />
          <p className="m-0 text-[11.5px] flex items-center gap-1.5 flex-wrap" style={{ color: "rgba(238,238,245,0.6)" }}>
            <Icon name="message-circle" size={12} />
            {authorChip(c.author.id, c.author.username, c.author.display_name, c.author.avatar_url)}
            <span>commented on</span>
            <span className="truncate" style={{ color: "#eeeef5", maxWidth: 360 }}>{c.post_title}</span>
            <span>· {timeAgo(c.created_at)}</span>
          </p>
          <p className="m-0 mt-1 text-[12px]" style={{
            color: "rgba(238,238,245,0.5)", lineHeight: 1.5,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {c.body}
          </p>
        </div>
      );
    }
    return null;
  };

  const streamNodes: React.ReactNode[] = [];
  stream.forEach((it, idx) => {
    streamNodes.push(renderItem(it));
    if (showSuggestionsInline && idx === 4) {
      streamNodes.push(
        <div key="suggestions-inline" className="mb-4">
          <PeopleSuggestions limit={8} layout="row" onLoaded={setSuggestionCount} />
        </div>
      );
    }
  });

  return (
    <div
      className="fixed overflow-y-auto"
      style={{
        top: "var(--nav-height)",
        left: "calc(var(--sidebar-width) + 12px)",
        right: 0, bottom: 0, zIndex: 50,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div className="mx-auto" style={{ maxWidth: 1440, margin: "0 auto", padding: "20px 24px" }}>
        <div className="flex items-center gap-4 mb-5 flex-wrap">
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>
            Your feed
          </span>
          <div className="flex gap-2 flex-1 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => pickFilter(f.id)}
                className="cursor-pointer text-[12px] px-3.5 py-1 rounded-lg"
                style={
                  filter === f.id
                    ? { background: "rgba(255,255,255,0.12)", border: "0.5px solid #4a4a54", color: "#f5f5f0" }
                    : { background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#c0c0c8" }
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {userId === null && (
          <div className="p-8 text-center" style={card}>
            <p className="m-0 mb-1 text-[15px] font-semibold" style={{ color: "#eeeef5", fontFamily: "'Space Grotesk', sans-serif" }}>
              Your feed is for members
            </p>
            <p className="m-0 mb-4 text-[12px]" style={{ color: "rgba(238,238,245,0.5)" }}>
              Sign in to see live discussions from people you follow, posts from your communities, and what&apos;s coming up.
            </p>
            <a href="/login" className="no-underline text-[12px] px-4 py-2 rounded-lg inline-block" style={{ background: "#4a9eff", color: "#fff", fontWeight: 600 }}>
              Sign in
            </a>
          </div>
        )}

        {userId && (
          <div className="flex gap-5 items-start">
          <div className="flex-1 min-w-0">
            {error && (
              <p className="text-[12px] px-4 py-3 mb-3 rounded-xl" style={{ background: "rgba(226,120,120,0.08)", border: "0.5px solid rgba(226,120,120,0.3)", color: "#f09595" }}>
                {error}
              </p>
            )}

            {/* Small screens only — on lg+ the rail's Live block covers this. */}
            {live.length > 0 && (
              <section className="mb-5 lg:hidden">
                <p className="m-0 mb-2 text-[12px] font-semibold inline-flex items-center gap-1.5" style={{ color: "rgba(238,238,245,0.7)" }}>
                  <span style={{ color: "#ef4444" }}>●</span> Live now
                </p>
                <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
                  {live.map((it) => it.kind === "live" && (
                    <div key={it.item_id} className="shrink-0">
                      <RoomCard room={it.payload} size={168} />
                      <p className="m-0 mt-1 text-[10px] truncate" style={{ color: "rgba(238,238,245,0.38)", maxWidth: 168 }}>{it.reason}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {loading && items === null && (
              <p className="text-[12px] text-center py-8" style={{ color: "rgba(238,238,245,0.32)" }}>Loading your feed…</p>
            )}

            {items !== null && items.length === 0 && !loading && !error && (
              <div className="p-8 text-center mb-4" style={card}>
                <p className="m-0 mb-1 text-[15px] font-semibold" style={{ color: "#eeeef5", fontFamily: "'Space Grotesk', sans-serif" }}>
                  {filter === "all" ? "Your feed is empty" : `Nothing under ${FILTERS.find((f) => f.id === filter)?.label}`}
                </p>
                <p className="m-0 text-[12px]" style={{ color: "rgba(238,238,245,0.5)" }}>
                  Follow people and join communities to build your feed.
                </p>
              </div>
            )}

            {items !== null && items.length === 0 && !loading && (
              <div className="mb-4">
                <PeopleSuggestions limit={8} layout="row" onLoaded={setSuggestionCount} />
                {suggestionCount === 0 && (
                  <p className="m-0 text-[12px]" style={{ color: "rgba(238,238,245,0.4)" }}>No suggestions yet — check back once more people join.</p>
                )}
                <a
                  href={pathFor.community(null)}
                  onClick={(e) => { e.preventDefault(); shellNavigate(pathFor.community(null)); }}
                  className="inline-block mt-3 no-underline text-[12px] px-4 py-2 rounded-lg"
                  style={btnGhost}
                >
                  Browse communities →
                </a>
              </div>
            )}

            {streamNodes}

            {showSuggestionsInline && stream.length > 0 && stream.length <= 4 && (
              <div className="mb-4">
                <PeopleSuggestions limit={8} layout="row" onLoaded={setSuggestionCount} />
              </div>
            )}

            {hasMore && stream.length > 0 && (
              <button
                onClick={() => {
                  const dated = stream
                    .filter((i) => i.kind === "post" || i.kind === "repost" || i.kind === "comment")
                    .map((i) => i.created_at).sort();
                  if (dated[0]) load(dated[0]);
                }}
                disabled={loadingMore}
                className="block w-full cursor-pointer text-[12px] py-2.5 rounded-xl"
                style={{ ...btnGhost, opacity: loadingMore ? 0.6 : 1 }}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
          <FeedRail userId={userId} />
          </div>
        )}
      </div>
    </div>
  );
}
