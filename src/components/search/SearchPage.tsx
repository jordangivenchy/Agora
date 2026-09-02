"use client";

/* Search panel — ONE surface anchored under the navbar search box.

   The navbar #searchInput (mvp-home-html.ts) is the only input; page.tsx
   binds it through useNavbarSearch and hands this panel `query`,
   `setQuery`, `open`, `pinned`, `onClose`, `onPin` plus a keyHandlerRef
   the navbar forwards ↑/↓/Enter into.

   Two modes of the same component:
     • unpinned — transient UI state, no URL change. Empty query shows
       Recent searches + Trending now; typing shows search_suggest rows
       (first one highlighted) and instant search_all results underneath.
     • pinned   — Enter with nothing highlighted / "See all results" /
       visiting /search?q= directly. Same panel; the URL becomes
       /search?q=… (the panel replaceStates as the user types), tabs,
       counts and Load more are fully active.

   Results come from the search_all RPC (migration 20260853; visibility
   is enforced inside it so this works signed out — public content only).
   Kind tabs page independently ("Load more" = offset); the All tab is a
   fixed mixed quota from the RPC and doesn't page. */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import useEscapeClose from "@/lib/useEscapeClose";
import { pathFor, setSectionTitle, sectionTitle } from "@/lib/routes";
import { userPath, roomPath } from "@/lib/urls";
import { highlightSegments, excerptAround } from "@/lib/highlight";
import RoomCard, { type RoomCardRoom } from "@/components/RoomCard";
import UserAvatar from "@/components/UserAvatar";
import PostCard, { RepostEmbed, authorLabel, timeAgo, type PostRow } from "@/components/community/PostCard";
import { PersonCard, useFollowToggle, type Suggestion as PersonSuggestion } from "@/components/people/PeopleSuggestions";
import { useUserMenu } from "@/components/userMenuContext";

export type SearchKeyHandler = (e: KeyboardEvent, value: string) => boolean | void;

interface Props {
  open: boolean;
  pinned: boolean;
  query: string;
  setQuery: (q: string) => void;
  onClose: () => void;
  /** Promote the panel to /search?q=… */
  onPin: (q: string) => void;
  /** Navbar keydown → panel (set by the panel, read by useNavbarSearch). */
  keyHandlerRef: MutableRefObject<SearchKeyHandler | null>;
}

export type SearchKind = "all" | "debate" | "post" | "comment" | "community" | "person";
const TABS: { id: SearchKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "debate", label: "Discussions" },
  { id: "post", label: "Posts" },
  { id: "comment", label: "Comments" },
  { id: "community", label: "Communities" },
  { id: "person", label: "People" },
];
const PAGE = 20;
const INSTANT_LIMIT = 12;
const DEBOUNCE = 120;
const RECENT_KEY = "agora:recent-searches";
const RECENT_MAX = 8;
const ANIM_MS = 180;

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

type SuggestKind = "person" | "community" | "debate";
type Suggest = {
  kind: SuggestKind;
  id: string;
  label: string;
  sublabel: string | null;
  avatar_url: string | null;
  href_hint: string | null;
};
const KIND_LABEL: Record<SuggestKind, string> = { person: "Person", community: "Community", debate: "Discussion" };

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
const sectionLabel: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: "0.06em",
  color: "rgba(255,255,255,0.45)",
  margin: "0 0 8px",
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

export default function SearchPage({ open, pinned, query: rawQuery, setQuery: setNavQuery, onClose, onPin, keyHandlerRef }: Props) {
  const [supabase] = useState(() => createClient());
  const { openUserMenu } = useUserMenu();
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  /* Debounced, trimmed copy of the navbar value that drives the RPCs. */
  const [query, setQuery] = useState(rawQuery.trim());
  const [kind, setKind] = useState<SearchKind>("all");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"ok" | "warming" | "error">("ok");
  const [recent, setRecent] = useState<string[]>([]);
  const [trending, setTrending] = useState<RoomCardRoom[] | null>(null);
  const [suggests, setSuggests] = useState<Suggest[]>([]);
  const [active, setActive] = useState(0);
  const [joinBusy, setJoinBusy] = useState<string | null>(null);
  const { following, busy: followBusy, toggle: toggleFollow, setFollowing } = useFollowToggle();
  const seq = useRef(0);
  const suggestSeq = useRef(0);
  const legacySuggest = useRef(false);
  const recordedRef = useRef<string>("");
  const bodyRef = useRef<HTMLDivElement>(null);

  /* Mount/unmount with the enter/leave transition. */
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), ANIM_MS + 20);
    return () => clearTimeout(t);
  }, [open]);

  useEscapeClose(open, onClose);

  useEffect(() => {
    if (open && pinned) setSectionTitle(sectionTitle("search"));
  }, [open, pinned]);

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

  /* Trending now: live / scheduled rooms (public), fetched once per open. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("debate_rooms")
        .select("id, motion, topic_key, status, format, scheduled_start, viewer_count, thumbnail_url, host:users!host_id(id, username, display_name, avatar_url)")
        .in("status", ["live", "scheduled"])
        .order("status", { ascending: true })
        .order("viewer_count", { ascending: false, nullsFirst: false })
        .limit(3);
      if (cancelled) return;
      const list = ((data ?? []) as unknown as (Omit<RoomCardRoom, "host" | "community"> & { host: RoomCardRoom["host"] | RoomCardRoom["host"][] })[])
        .map((r) => ({ ...r, host: Array.isArray(r.host) ? r.host[0] ?? null : r.host, community: null }));
      setTrending(list);
    })();
    return () => { cancelled = true; };
  }, [open, supabase]);

  /* Debounced: navbar value → query (+ ?q= in the address bar when pinned). */
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const q = rawQuery.trim();
      setQuery(q);
      if (!q) { setRows(null); setHasMore(false); setStatus("ok"); setSuggests([]); }
      if (pinned) {
        const desired = pathFor.search(q);
        if (window.location.pathname + window.location.search !== desired) {
          window.history.replaceState(null, "", desired);
        }
      }
    }, DEBOUNCE);
    return () => clearTimeout(t);
  }, [rawQuery, open, pinned]);

  /* Pre-migration fallback for suggestions (direct table queries). */
  const legacyFetch = useCallback(async (q: string): Promise<Suggest[]> => {
    const cleaned = q.replace(/[%_,()]/g, "");
    if (!cleaned) return [];
    const term = `%${cleaned}%`;
    const [peopleRes, commRes, roomsRes] = await Promise.all([
      supabase.from("users").select("id, username, display_name, avatar_url")
        .or(`username.ilike.${cleaned}%,display_name.ilike.${cleaned}%`).limit(4),
      supabase.from("communities").select("id, name, avatar_url").ilike("name", term).limit(3),
      supabase.from("debate_rooms").select("id, motion, status, thumbnail_url")
        .in("status", ["live", "created", "scheduled"]).ilike("motion", term)
        .order("created_at", { ascending: false }).limit(4),
    ]);
    const out: Suggest[] = [];
    for (const u of (peopleRes.data ?? []) as { id: string; username: string; display_name: string | null; avatar_url: string | null }[]) {
      out.push({ kind: "person", id: u.id, label: u.display_name?.trim() || `@${u.username}`, sublabel: `@${u.username}`, avatar_url: u.avatar_url, href_hint: userPath(u.username) });
    }
    for (const c of (commRes.data ?? []) as { id: string; name: string; avatar_url: string | null }[]) {
      out.push({ kind: "community", id: c.id, label: c.name, sublabel: null, avatar_url: c.avatar_url, href_hint: pathFor.community(c.id) });
    }
    for (const r of (roomsRes.data ?? []) as { id: string; motion: string; status: string; thumbnail_url: string | null }[]) {
      out.push({ kind: "debate", id: r.id, label: r.motion, sublabel: r.status === "live" ? "Live now" : r.status === "scheduled" ? "Scheduled" : "Open", avatar_url: r.thumbnail_url, href_hint: roomPath(r) });
    }
    return out;
  }, [supabase]);

  /* Suggestions follow the debounced query. */
  useEffect(() => {
    if (!open) return;
    const mySeq = ++suggestSeq.current;
    setActive(0);
    if (query.length < 2) { setSuggests([]); return; }
    (async () => {
      let list: Suggest[] = [];
      if (!legacySuggest.current) {
        const { data, error } = await supabase.rpc("search_suggest", { p_q: query, p_limit: 6 });
        if (error) {
          legacySuggest.current = /does not exist|not find|schema cache/i.test(error.message ?? "");
          list = legacySuggest.current ? await legacyFetch(query) : [];
        } else {
          list = (data ?? []) as Suggest[];
        }
      } else {
        list = await legacyFetch(query);
      }
      if (suggestSeq.current !== mySeq) return;
      setSuggests(list);
      setActive(0);
    })();
  }, [query, open, supabase, legacyFetch]);

  const run = useCallback(async (q: string, k: SearchKind, offset: number) => {
    const mySeq = ++seq.current;
    if (offset > 0) setLoadingMore(true); else setLoading(true);
    const limit = pinned || k !== "all" ? PAGE : INSTANT_LIMIT;
    const { data, error } = await supabase.rpc("search_all", {
      p_q: q, p_kind: k, p_limit: limit, p_offset: offset,
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
    setHasMore(k !== "all" && list.length >= limit);
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
  }, [supabase, setFollowing, userId, pinned]);

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

  const openPost = (id: string, commentId?: string | null) => { onClose(); shellNavigate(pathFor.post(id, commentId)); };

  const openSuggest = useCallback((s: Suggest) => {
    if (s.kind === "person") { window.location.href = s.href_hint || userPath(s.label.replace(/^@/, "")); return; }
    if (s.kind === "community") { onClose(); shellNavigate(pathFor.community(s.id)); return; }
    window.location.href = roomPath({ id: s.id, motion: s.label });
  }, [onClose]);

  /* Navbar keys. Highlight indexes: 0..n-1 suggestions, n = "See all
     results" (unpinned only). Enter with nothing highlighted pins. */
  const seeAllIndex = suggests.length;
  const hasSeeAll = !pinned && query.length > 0;
  const maxIndex = hasSeeAll ? seeAllIndex : suggests.length - 1;
  useEffect(() => {
    keyHandlerRef.current = (e, value) => {
      const q = value.trim();
      if (e.key === "Enter") {
        if (q !== query) { if (q) onPin(q); return true; }
        if (active >= 0 && active < suggests.length) { openSuggest(suggests[active]); return true; }
        if (q) onPin(q);
        return true;
      }
      if (e.key === "ArrowDown") { setActive((a) => Math.min(maxIndex, a + 1)); return true; }
      if (e.key === "ArrowUp") { setActive((a) => Math.max(-1, a - 1)); return true; }
      return false;
    };
    return () => { keyHandlerRef.current = null; };
  }, [keyHandlerRef, query, active, suggests, maxIndex, onPin, openSuggest]);

  const vote = useCallback(async (post: SearchPost, value: number) => {
    if (!userId) { window.location.href = "/login"; return; }
    const delta = value - (post.my_vote ?? 0);
    const patch = (fn: (p: SearchPost) => SearchPost) =>
      setRows((list) => list?.map((r) => r.kind === "post" && r.id === post.id ? { ...r, payload: fn(r.payload) } : r) ?? list);
    patch((p) => ({ ...p, score: p.score + delta, my_vote: value === 0 ? null : value }));
    const { error } = await supabase.rpc("vote_post", { p_post: post.id, p_value: value });
    if (error) patch((p) => ({ ...p, score: post.score, my_vote: post.my_vote }));
  }, [supabase, userId]);

  /* Join / leave: same direct table writes as CommunitiesPage. */
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

  if (!mounted) return null;

  const renderDebate = (r: Extract<Row, { kind: "debate" }>) => {
    const d = r.payload;
    const ended = d.status === "ended";
    return (
      <div key={r.id} className="shrink-0 relative">
        <RoomCard room={d} size={168} />
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
            onOpenCommunity={() => { onClose(); shellNavigate(pathFor.community(null)); }}
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
        const go = () => { onClose(); shellNavigate(pathFor.community(c.id)); };
        return (
          <div
            key={r.id}
            role="link"
            tabIndex={0}
            className="px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer"
            style={card}
            onClick={go}
            onKeyDown={(e) => { if (e.key === "Enter") go(); }}
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

  const suggestAvatar = (s: Suggest) => {
    if (s.kind === "person") {
      return <UserAvatar size={30} username={s.sublabel?.replace(/^@/, "") ?? "?"} avatarUrl={s.avatar_url} seed={s.id} />;
    }
    if (s.avatar_url) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={s.avatar_url} alt="" width={30} height={30} style={{ width: 30, height: 30, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />;
    }
    return (
      <span
        className="inline-flex items-center justify-center shrink-0"
        style={{ width: 30, height: 30, borderRadius: 8, background: s.kind === "community" ? "#4a9eff" : "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 700 }}
      >
        {s.kind === "community" ? s.label.charAt(0).toUpperCase() : <Icon name="monitor-play" size={14} />}
      </span>
    );
  };

  const debates = (rows ?? []).filter((r): r is Extract<Row, { kind: "debate" }> => r.kind === "debate");
  const people = (rows ?? []).filter((r): r is Extract<Row, { kind: "person" }> => r.kind === "person");
  const others = (rows ?? []).filter((r) => r.kind !== "debate" && r.kind !== "person");

  const personFor = (p: PersonPayload): PersonSuggestion => ({
    id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url,
    verified: p.verified, reason: p.bio?.trim() || `${p.followers} ${p.followers === 1 ? "follower" : "followers"}`,
    mutual_count: 0, debates_30d: 0,
  });

  const empty = query && rows !== null && rows.length === 0 && !loading && status === "ok";
  const railClass = kind === "all" ? "flex gap-3 overflow-x-auto pb-1" : "flex gap-3 flex-wrap";
  const railStyle = kind === "all" ? { scrollbarWidth: "thin" as const } : undefined;

  return (
    <>
      <div className={`search-panel-scrim${shown ? " is-open" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={onClose} aria-hidden="true" />
      <div
        className={`search-panel${shown ? " is-open" : ""}${pinned ? " is-pinned" : ""}`}
        role="dialog"
        aria-label="Search"
        /* Keep focus in the navbar box while interacting with the panel. */
        onMouseDown={(e) => { const t = e.target as HTMLElement; if (!t.closest("input,textarea,[contenteditable]")) e.preventDefault(); }}
      >
        <div className="search-panel-body" ref={bodyRef}>
          {/* Phones only (CSS): the navbar pill — normally the panel's one
              input — is hidden there, so the panel carries its own. It
              drives the same navbar value, so the debounce/pin logic is
              unchanged. */}
          <input
            className="search-phone-input"
            type="search"
            value={rawQuery}
            onChange={(e) => setNavQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && rawQuery.trim()) onPin(rawQuery.trim());
            }}
            placeholder="Search discussions, posts, people…"
            aria-label="Search"
            autoComplete="off"
            enterKeyHint="search"
          />
          {!query && (
            <div>
              {recent.length > 0 && (
                <section className="mb-4">
                  <div className="flex items-center mb-2">
                    <p style={sectionLabel} className="inline-flex items-center gap-1.5"><Icon name="clock" size={12} /> RECENT SEARCHES</p>
                    <button onClick={clearRecent} className="ml-auto cursor-pointer text-[11px] mb-2" style={{ background: "none", border: 0, color: "rgba(238,238,245,0.45)", fontFamily: "inherit" }}>
                      Clear
                    </button>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {recent.map((q) => (
                      <button
                        key={q}
                        onClick={() => { setNavQuery(q); setQuery(q); }}
                        className="cursor-pointer text-[12px] px-3 py-1 rounded-full"
                        style={btnGhost}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {trending && trending.length > 0 && (
                <section>
                  <p style={sectionLabel} className="inline-flex items-center gap-1.5"><Icon name="flame" size={12} /> TRENDING NOW</p>
                  <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
                    {trending.map((r) => (
                      <div key={r.id} className="shrink-0"><RoomCard room={r} size={168} /></div>
                    ))}
                  </div>
                </section>
              )}
              {recent.length === 0 && (!trending || trending.length === 0) && (
                <p className="m-0 text-[13px]" style={{ color: "rgba(238,238,245,0.5)" }}>
                  Search for discussions, posts, people, communities and comments.
                </p>
              )}
            </div>
          )}

          {query && (
            <>
              {suggests.length > 0 && (
                <div className="search-panel-suggests" role="listbox" aria-label="Search suggestions">
                  <p style={sectionLabel}>SUGGESTIONS</p>
                  {suggests.map((s, i) => (
                    <div
                      key={`${s.kind}-${s.id}`}
                      role="option"
                      aria-selected={active === i}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => openSuggest(s)}
                      className={`search-panel-suggest${active === i ? " is-active" : ""}`}
                    >
                      {suggestAvatar(s)}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p className="m-0 text-[12.5px] truncate" style={{ color: "#f5f5f0", fontWeight: 600 }}>{s.label}</p>
                        <p className="m-0 text-[10.5px]" style={{ color: "#8b8b94" }}>
                          {s.kind === "debate" && s.sublabel === "Live now"
                            ? <span style={{ color: "#e05a5a", fontWeight: 700 }}>LIVE</span>
                            : s.sublabel}
                          {s.sublabel ? " · " : ""}{KIND_LABEL[s.kind]}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mb-4 flex-wrap items-center" role="tablist">
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
                {hasSeeAll && (
                  <div
                    role="option"
                    aria-selected={active === seeAllIndex}
                    onMouseEnter={() => setActive(seeAllIndex)}
                    onClick={() => onPin(query)}
                    className={`search-panel-seeall${active === seeAllIndex ? " is-active" : ""}`}
                  >
                    <Icon name="search" size={12} /> See all results for &ldquo;{query}&rdquo; →
                  </div>
                )}
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

              {loading && rows === null && (
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

              {rows !== null && rows.length > 0 && (
                <>
                  {debates.length > 0 && (
                    <section className="mb-5">
                      {kind === "all" && <p className="m-0 mb-2 text-[12px] font-semibold" style={{ color: "rgba(238,238,245,0.7)" }}>Discussions</p>}
                      <div className={railClass} style={railStyle}>{debates.map(renderDebate)}</div>
                    </section>
                  )}

                  {people.length > 0 && (
                    <section className="mb-5">
                      {kind === "all" && <p className="m-0 mb-2 text-[12px] font-semibold" style={{ color: "rgba(238,238,245,0.7)" }}>People</p>}
                      <div className={railClass} style={railStyle}>
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
            </>
          )}
        </div>
      </div>
    </>
  );
}
