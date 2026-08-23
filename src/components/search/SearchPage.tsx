"use client";

/* /search?q=… — global search across debates, posts, comments,
   communities and people, all served by the search_all RPC
   (migration 20260853; visibility is enforced inside it, so this works
   signed out too — public content only).

   Overlay panel like FeedPage: `open` / `onClose`, same chrome. The
   panel owns ?q= while open (replaceState as the user types, debounced);
   page.tsx hands it the initial query from the URL. Kind tabs page
   independently ("Load more" = offset); the All tab is a fixed mixed
   quota from the RPC and doesn't page. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import useEscapeClose from "@/lib/useEscapeClose";
import { pathFor, setSectionTitle, sectionTitle } from "@/lib/routes";
import { highlightSegments, excerptAround } from "@/lib/highlight";
import RoomCard, { type RoomCardRoom } from "@/components/RoomCard";
import UserAvatar from "@/components/UserAvatar";
import PostCard, { RepostEmbed, authorLabel, timeAgo, type PostRow } from "@/components/community/PostCard";
import { PersonCard, useFollowToggle, type Suggestion } from "@/components/people/PeopleSuggestions";
import { useUserMenu } from "@/components/userMenuContext";

interface Props {
  open: boolean;
  initialQuery: string;
  onClose: () => void;
}

export type SearchKind = "all" | "debate" | "post" | "comment" | "community" | "person";
const TABS: { id: SearchKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "debate", label: "Debates" },
  { id: "post", label: "Posts" },
  { id: "comment", label: "Comments" },
  { id: "community", label: "Communities" },
  { id: "person", label: "People" },
];
const PAGE = 20;
const RECENT_KEY = "agora:recent-searches";
const RECENT_MAX = 8;

type DebatePayload = RoomCardRoom & {
  created_at: string;
  ended_at: string | null;
  recording_url: string | null;
};
type CommentPayload = {
  id: string;
  post_id: string;
  post_title: string;
  community_id: string;
  community_name: string;
  body: string;
  excerpt: string | null;
  created_at: string;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null } | null;
};
type CommunityPayload = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  color: string | null;
  is_private: boolean;
  members: number;
  joined: boolean;
};
type PersonPayload = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  verified: boolean;
  bio: string | null;
  is_following: boolean;
  followers: number;
};
type SearchPost = PostRow & { author_avatar_url?: string | null; community_color?: string | null };

type Row =
  | { kind: "debate"; id: string; rank: number; created_at: string; payload: DebatePayload }
  | { kind: "post"; id: string; rank: number; created_at: string; payload: SearchPost }
  | { kind: "comment"; id: string; rank: number; created_at: string; payload: CommentPayload }
  | { kind: "community"; id: string; rank: number; created_at: string; payload: CommunityPayload }
  | { kind: "person"; id: string; rank: number; created_at: string; payload: PersonPayload };

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

/** Navigate inside the homepage shell (page.tsx re-parses on popstate). */
function shellNavigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Query terms wrapped in <mark>. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const segs = useMemo(() => highlightSegments(text, query), [text, query]);
  return (
    <>
      {segs.map((s, i) =>
        s.hit ? (
          <mark key={i} style={{ background: "rgba(244,212,124,0.28)", color: "inherit", borderRadius: 3, padding: "0 1px" }}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}

function readLocalRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
function writeLocalRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* private mode */ }
}

export default function SearchPage({ open, initialQuery, onClose }: Props) {
  const [supabase] = useState(() => createClient());
  const { openUserMenu } = useUserMenu();
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery.trim());
  const [kind, setKind] = useState<SearchKind>("all");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"ok" | "warming" | "error">("ok");
  const [recent, setRecent] = useState<string[]>([]);
  const [joinBusy, setJoinBusy] = useState<string | null>(null);
  const { following, busy: followBusy, toggle: toggleFollow, setFollowing } = useFollowToggle();
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const recordedRef = useRef<string>("");

  useEscapeClose(open, onClose);

  /* Sync from the URL when the shell hands us a new query (navbar Enter,
     back/forward): adjust state during render (React's prop-change
     pattern), then focus the box. */
  const [seenInitial, setSeenInitial] = useState(initialQuery);
  if (seenInitial !== initialQuery) {
    setSeenInitial(initialQuery);
    setInput(initialQuery);
    setQuery(initialQuery.trim());
  }
  useEffect(() => {
    if (!open) return;
    setSectionTitle(sectionTitle("search"));
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, initialQuery]);

  /* Auth + recent searches (DB history when signed in, localStorage otherwise). */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (cancelled) return;
      const uid = auth?.user?.id ?? null;
      setUserId(uid);
      if (!uid) { setRecent(readLocalRecent()); return; }
      const { data, error } = await supabase
        .from("search_history").select("query").eq("user_id", uid)
        .order("created_at", { ascending: false }).limit(40);
      if (cancelled) return;
      if (error) { setRecent(readLocalRecent()); return; }
      const seen = new Set<string>();
      const list: string[] = [];
      for (const r of (data ?? []) as { query: string }[]) {
        const k = r.query.trim().toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        list.push(r.query.trim());
        if (list.length >= RECENT_MAX) break;
      }
      setRecent(list);
    })();
    return () => { cancelled = true; };
  }, [open, supabase]);

  /* Debounced: input → query + ?q= in the address bar. */
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const q = input.trim();
      setQuery(q);
      if (!q) { setRows(null); setHasMore(false); setStatus("ok"); }
      const desired = pathFor.search(q);
      if (window.location.pathname + window.location.search !== desired) {
        window.history.replaceState(null, "", desired);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [input, open]);

  const run = useCallback(async (q: string, k: SearchKind, offset: number) => {
    const mySeq = ++seq.current;
    if (offset > 0) setLoadingMore(true); else setLoading(true);
    const { data, error } = await supabase.rpc("search_all", {
      p_q: q, p_kind: k, p_limit: PAGE, p_offset: offset,
    });
    if (mySeq !== seq.current) return;
    setLoading(false);
    setLoadingMore(false);
    if (error) {
      const m = error.message ?? "";
      setStatus(/does not exist|not find|schema cache|404/i.test(m) ? "warming" : "error");
      if (offset === 0) setRows([]);
      return;
    }
    setStatus("ok");
    const list = (data ?? []) as Row[];
    /* Seed the follow toggle with the server's state. */
    const seed: Record<string, boolean> = {};
    for (const r of list) if (r.kind === "person") seed[r.id] = r.payload.is_following;
    if (Object.keys(seed).length) setFollowing((m) => ({ ...seed, ...m }));
    setRows((prev) => {
      if (offset === 0 || !prev) return list;
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...list.filter((r) => !seen.has(r.id))];
    });
    setHasMore(k !== "all" && list.length >= PAGE);
    /* Record the search once results came back for it (not per keystroke). */
    if (offset === 0 && recordedRef.current !== q) {
      recordedRef.current = q;
      setRecent((prev) => {
        const next = [q, ...prev.filter((p) => p.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
        if (!userId) writeLocalRecent(next);
        return next;
      });
      if (userId) supabase.from("search_history").insert({ user_id: userId, query: q }).then(() => { /* best effort */ });
    }
  }, [supabase, setFollowing, userId]);

  useEffect(() => {
    if (!open) return;
    if (!query) return;
    run(query, kind, 0);
  }, [open, query, kind, run]);

  const clearRecent = async () => {
    setRecent([]);
    writeLocalRecent([]);
    if (userId) await supabase.from("search_history").delete().eq("user_id", userId);
  };

  const openPost = (id: string, commentId?: string | null) => shellNavigate(pathFor.post(id, commentId));

  const vote = useCallback(async (post: SearchPost, value: number) => {
    if (!userId) { window.location.href = "/login"; return; }
    const delta = value - (post.my_vote ?? 0);
    const patch = (fn: (p: SearchPost) => SearchPost) =>
      setRows((list) => list?.map((r) => r.kind === "post" && r.id === post.id ? { ...r, payload: fn(r.payload) } : r) ?? list);
    patch((p) => ({ ...p, score: p.score + delta, my_vote: value === 0 ? null : value }));
    const { error } = await supabase.rpc("vote_post", { p_post: post.id, p_value: value });
    if (error) patch((p) => ({ ...p, score: post.score, my_vote: post.my_vote }));
  }, [supabase, userId]);

  /* Join / leave: same direct table writes as CommunitiesPage (private
     boards go through request_to_join; they only appear here to members
     anyway, so the leave path is all that applies to them). */
  const toggleJoin = useCallback(async (c: CommunityPayload) => {
    if (!userId) { window.location.href = "/login"; return; }
    setJoinBusy(c.id);
    const { error } = c.joined
      ? await supabase.from("community_members").delete().eq("community_id", c.id).eq("user_id", userId)
      : await supabase.from("community_members").insert({ community_id: c.id, user_id: userId });
    setJoinBusy(null);
    if (error) return;
    setRows((list) => list?.map((r) =>
      r.kind === "community" && r.id === c.id
        ? { ...r, payload: { ...r.payload, joined: !c.joined, members: Math.max(0, c.members + (c.joined ? -1 : 1)) } }
        : r) ?? list);
  }, [supabase, userId]);

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

  const counts = useMemo(() => {
    const c: Partial<Record<SearchKind, number>> = {};
    for (const r of rows ?? []) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [rows]);

  if (!open) return null;

  const renderDebate = (r: Extract<Row, { kind: "debate" }>) => {
    const d = r.payload;
    const ended = d.status === "ended";
    return (
      <div key={r.id} className="shrink-0 relative">
        <RoomCard room={d} size={168} />
        {ended && (
          <span
            className="absolute inline-flex items-center gap-1"
            style={{
              top: 8, left: 8, zIndex: 2, pointerEvents: "none",
              background: d.recording_url ? "rgba(74,158,255,0.92)" : "rgba(60,60,70,0.92)",
              color: "#fff", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 6,
            }}
          >
            {d.recording_url ? <><Icon name="play" size={9} /> REPLAY</> : "ENDED"}
          </span>
        )}
        <p className="m-0 mt-1 text-[10px] truncate" style={{ color: "rgba(238,238,245,0.38)", maxWidth: 168 }}>
          {ended ? `Ended ${d.ended_at ? timeAgo(d.ended_at) + " ago" : ""}` : d.status === "live" ? "Live now" : d.scheduled_start ? "Scheduled" : "Open"}
        </p>
      </div>
    );
  };

  const renderRow = (r: Row) => {
    switch (r.kind) {
      case "post": {
        const p = r.payload;
        return (
          <PostCard
            key={r.id}
            post={p}
            onOpen={(x) => openPost(x.id)}
            onVote={vote}
            showCommunity
            onOpenCommunity={() => shellNavigate(pathFor.community(null))}
            author={authorChip(p.author_id, p.author_username, p.author_display_name, p.author_avatar_url)}
            embed={<RepostEmbed post={p} onOpenOriginal={openPost} />}
          />
        );
      }
      case "comment": {
        const c = r.payload;
        const excerpt = c.excerpt?.trim() || excerptAround(c.body, query);
        return (
          <div
            key={r.id}
            role="link"
            tabIndex={0}
            className="px-4 py-3 mb-3 cursor-pointer"
            style={card}
            onClick={() => openPost(c.post_id, c.id)}
            onKeyDown={(e) => { if (e.key === "Enter") openPost(c.post_id, c.id); }}
          >
            <p className="m-0 text-[11.5px] flex items-center gap-1.5 flex-wrap" style={{ color: "rgba(238,238,245,0.6)" }}>
              <Icon name="message-circle" size={12} />
              {c.author ? authorChip(c.author.id, c.author.username, c.author.display_name, c.author.avatar_url) : <span>(deleted)</span>}
              <span>commented on</span>
              <span className="truncate" style={{ color: "#eeeef5", maxWidth: 360 }}><Highlight text={c.post_title} query={query} /></span>
              <span>· {c.community_name} · {timeAgo(c.created_at)}</span>
            </p>
            <p className="m-0 mt-1 text-[12.5px]" style={{ color: "rgba(238,238,245,0.72)", lineHeight: 1.5 }}>
              <Highlight text={excerpt} query={query} />
            </p>
          </div>
        );
      }
      case "community": {
        const c = r.payload;
        return (
          <div
            key={r.id}
            role="link"
            tabIndex={0}
            className="px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer"
            style={card}
            onClick={() => shellNavigate(pathFor.community(c.id))}
            onKeyDown={(e) => { if (e.key === "Enter") shellNavigate(pathFor.community(c.id)); }}
          >
            {c.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.avatar_url} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <span
                className="inline-flex items-center justify-center shrink-0"
                style={{ width: 40, height: 40, borderRadius: 10, background: c.color ?? "#4a9eff", color: "#fff", fontSize: 16, fontWeight: 700 }}
              >
                {c.name.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className="m-0 text-[13.5px] font-semibold truncate inline-flex items-center gap-1.5" style={{ color: "#eeeef5" }}>
                <Highlight text={c.name} query={query} />
                {c.is_private && <Icon name="lock" size={11} />}
              </p>
              <p className="m-0 text-[11px]" style={{ color: "rgba(238,238,245,0.45)" }}>
                {c.members} {c.members === 1 ? "member" : "members"}
                {c.description && <> · <span className="truncate"><Highlight text={c.description.slice(0, 120)} query={query} /></span></>}
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); toggleJoin(c); }}
              disabled={joinBusy === c.id}
              className="cursor-pointer shrink-0"
              style={{
                fontFamily: "inherit", fontSize: 11.5, fontWeight: 600, padding: "5px 12px", borderRadius: 99,
                background: c.joined ? "rgba(255,255,255,0.06)" : "#4a9eff",
                border: c.joined ? "0.5px solid rgba(255,255,255,0.18)" : "0.5px solid transparent",
                color: c.joined ? "rgba(238,238,245,0.8)" : "#fff",
                opacity: joinBusy === c.id ? 0.6 : 1,
              }}
            >
              {c.joined ? "Joined" : "Join"}
            </button>
          </div>
        );
      }
      default:
        return null;
    }
  };

  const debates = (rows ?? []).filter((r): r is Extract<Row, { kind: "debate" }> => r.kind === "debate");
  const people = (rows ?? []).filter((r): r is Extract<Row, { kind: "person" }> => r.kind === "person");
  const others = (rows ?? []).filter((r) => r.kind !== "debate" && r.kind !== "person");

  const personFor = (p: PersonPayload): Suggestion => ({
    id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url,
    verified: p.verified, reason: p.bio?.trim() || `${p.followers} ${p.followers === 1 ? "follower" : "followers"}`,
    mutual_count: 0, debates_30d: 0,
  });

  const empty = query && rows !== null && rows.length === 0 && !loading && status === "ok";

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
      <div className="max-w-[860px] mx-auto px-6 py-5">
        <div className="flex items-center gap-3 mb-4">
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>
            Search
          </span>
          <button onClick={onClose} className="ml-auto cursor-pointer text-[12px] px-3 py-1 rounded-lg" style={btnGhost} aria-label="Close search">
            Close
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); setQuery(input.trim()); }}
          className="flex items-center gap-2 px-4 mb-4"
          style={{ ...card, borderRadius: 14, height: 52 }}
        >
          <Icon name="search" size={18} style={{ color: "rgba(238,238,245,0.5)" }} />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search debates, posts, communities, people…"
            aria-label="Search"
            autoComplete="off"
            className="flex-1 bg-transparent border-0 outline-none"
            style={{ color: "#f5f5f0", fontSize: 16, fontFamily: "inherit" }}
          />
          {input && (
            <button type="button" onClick={() => { setInput(""); inputRef.current?.focus(); }} className="cursor-pointer text-[11px] px-2 py-1 rounded-md" style={btnGhost} aria-label="Clear">
              Clear
            </button>
          )}
        </form>

        <div className="flex gap-2 mb-5 flex-wrap" role="tablist">
          {TABS.map((t) => {
            const n = t.id === "all" ? undefined : counts[t.id];
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={kind === t.id}
                onClick={() => setKind(t.id)}
                className="cursor-pointer text-[12px] px-3.5 py-1 rounded-lg"
                style={
                  kind === t.id
                    ? { background: "rgba(255,255,255,0.12)", border: "0.5px solid #4a4a54", color: "#f5f5f0" }
                    : { background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#c0c0c8" }
                }
              >
                {t.label}{n !== undefined && n > 0 ? <span style={{ opacity: 0.55 }}> {n}{hasMore && kind === t.id ? "+" : ""}</span> : null}
              </button>
            );
          })}
        </div>

        {status === "warming" && (
          <div className="p-8 text-center mb-4" style={card}>
            <p className="m-0 mb-1 text-[15px] font-semibold" style={{ color: "#eeeef5", fontFamily: "'Space Grotesk', sans-serif" }}>
              Search is warming up
            </p>
            <p className="m-0 text-[12px]" style={{ color: "rgba(238,238,245,0.5)" }}>
              The search index isn&apos;t ready on this server yet. Try again in a moment.
            </p>
          </div>
        )}
        {status === "error" && (
          <p className="text-[12px] px-4 py-3 mb-3 rounded-xl" style={{ background: "rgba(226,120,120,0.08)", border: "0.5px solid rgba(226,120,120,0.3)", color: "#f09595" }}>
            Couldn&apos;t search right now — try again.
          </p>
        )}

        {!query && (
          <div>
            <p className="m-0 mb-3 text-[13px]" style={{ color: "rgba(238,238,245,0.5)" }}>
              Search for debates, posts, people, communities and comments.
            </p>
            {recent.length > 0 && (
              <div className="p-4" style={card}>
                <div className="flex items-center mb-2">
                  <p className="m-0 text-[12px] font-semibold inline-flex items-center gap-1.5" style={{ color: "rgba(238,238,245,0.7)" }}>
                    <Icon name="clock" size={13} /> Recent searches
                  </p>
                  <button onClick={clearRecent} className="ml-auto cursor-pointer text-[11px]" style={{ background: "none", border: 0, color: "rgba(238,238,245,0.45)", fontFamily: "inherit" }}>
                    Clear
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {recent.map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); setQuery(q); }}
                      className="cursor-pointer text-[12px] px-3 py-1 rounded-full"
                      style={btnGhost}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {query && loading && rows === null && (
          <p className="text-[12px] text-center py-8" style={{ color: "rgba(238,238,245,0.32)" }}>Searching…</p>
        )}

        {empty && (
          <div className="p-8 text-center mb-4" style={card}>
            <p className="m-0 mb-1 text-[15px] font-semibold" style={{ color: "#eeeef5", fontFamily: "'Space Grotesk', sans-serif" }}>
              No results for &ldquo;{query}&rdquo;
            </p>
            <p className="m-0 text-[12px]" style={{ color: "rgba(238,238,245,0.5)" }}>
              {kind === "all" ? "Try a different spelling or fewer words." : "Try another tab, or fewer words."}
            </p>
          </div>
        )}

        {query && rows !== null && rows.length > 0 && (
          <>
            {debates.length > 0 && (
              <section className="mb-5">
                {kind === "all" && (
                  <p className="m-0 mb-2 text-[12px] font-semibold" style={{ color: "rgba(238,238,245,0.7)" }}>Debates</p>
                )}
                <div className={kind === "all" ? "flex gap-3 overflow-x-auto pb-1" : "flex gap-3 flex-wrap"} style={kind === "all" ? { scrollbarWidth: "thin" } : undefined}>
                  {debates.map(renderDebate)}
                </div>
              </section>
            )}

            {people.length > 0 && (
              <section className="mb-5">
                {kind === "all" && (
                  <p className="m-0 mb-2 text-[12px] font-semibold" style={{ color: "rgba(238,238,245,0.7)" }}>People</p>
                )}
                <div className={kind === "all" ? "flex gap-3 overflow-x-auto pb-1" : "flex gap-3 flex-wrap"} style={kind === "all" ? { scrollbarWidth: "thin" } : undefined}>
                  {people.map((r) => (
                    <PersonCard
                      key={r.id}
                      person={personFor(r.payload)}
                      following={following[r.id] ?? r.payload.is_following}
                      busy={followBusy === r.id}
                      compact={kind === "all"}
                      onToggle={(id, cur) => { toggleFollow(id, cur); }}
                    />
                  ))}
                </div>
              </section>
            )}

            {others.length > 0 && kind === "all" && (
              <p className="m-0 mb-2 text-[12px] font-semibold" style={{ color: "rgba(238,238,245,0.7)" }}>Posts &amp; comments</p>
            )}
            {others.map(renderRow)}

            {hasMore && (
              <button
                onClick={() => run(query, kind, rows.length)}
                disabled={loadingMore}
                className="block w-full cursor-pointer text-[12px] py-2.5 rounded-xl"
                style={{ ...btnGhost, opacity: loadingMore ? 0.6 : 1 }}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
