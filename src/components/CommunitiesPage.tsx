"use client";

/* Communities — a forum, not just a membership list. Each community is
   a board of posts with up/down votes and threaded comments
   (Reddit/Quora-style), backed by 20260815_community_posts.sql:
   - feed + scores via get_community_posts (votes are private rows;
     only aggregates and your own vote leave the database)
   - voting via vote_post (±1, 0 clears)
   - posts/comments written directly under RLS (as yourself, not
     suspended, rate-limited by trigger)
   Guests can read everything; any interaction routes to /login. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import useEscapeClose from "@/lib/useEscapeClose";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Community = {
  id: string;
  name: string;
  kind: string;
  color: string;
  members: number;
  joined: boolean;
};

type Post = {
  id: string;
  community_id: string;
  community_name: string;
  author_id: string | null;
  author_username: string;
  title: string;
  body: string | null;
  created_at: string;
  score: number;
  my_vote: number | null;
  comment_count: number;
};

type Comment = {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string | null;
  author_username: string;
  body: string;
  created_at: string;
  score: number;
  my_vote: number | null;
};

const KINDS = [
  { key: "topic-circle", label: "Topic circle" },
  { key: "university", label: "University" },
  { key: "hs-team", label: "HS team" },
  { key: "mun", label: "Model UN" },
  { key: "pre-law", label: "Pre-law" },
];

const card: React.CSSProperties = {
  background: "rgba(18,18,24,0.92)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

const inputStyle: React.CSSProperties = {
  background: "rgba(10,10,14,0.8)",
  border: "0.5px solid #34343c",
  borderRadius: 9,
  color: "#f5f5f0",
  fontSize: 13,
  padding: "9px 12px",
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - +new Date(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/* Vote column shared by feed cards and the detail view. */
function VoteBox({
  post, onVote, size = 13,
}: { post: Post; onVote: (p: Post, v: number) => void; size?: number }) {
  return (
    <div className="flex flex-col items-center shrink-0" style={{ width: 34 }}>
      <button
        onClick={(e) => { e.stopPropagation(); onVote(post, post.my_vote === 1 ? 0 : 1); }}
        className="cursor-pointer bg-transparent border-none px-1"
        style={{ color: post.my_vote === 1 ? "#f4d47c" : "#6b6b74", fontSize: size + 1 }}
        aria-label="Upvote"
      >
        ▲
      </button>
      <span className="text-center" style={{ color: "#f5f5f0", fontSize: size, fontWeight: 600 }}>
        {post.score}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onVote(post, post.my_vote === -1 ? 0 : -1); }}
        className="cursor-pointer bg-transparent border-none px-1"
        style={{ color: post.my_vote === -1 ? "#85b7eb" : "#6b6b74", fontSize: size + 1 }}
        aria-label="Downvote"
      >
        ▼
      </button>
    </div>
  );
}

export default function CommunitiesPage({ open, onClose }: Props) {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null>(null);

  const [communities, setCommunities] = useState<Community[]>([]);
  const [selected, setSelected] = useState<string>("all"); // 'all' | community id
  const [posts, setPosts] = useState<Post[]>([]);
  const [sort, setSort] = useState<"new" | "top">("new");
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Post detail
  const [openPost, setOpenPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [commentSort, setCommentSort] = useState<"top" | "new">("top");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Composers
  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [composeCommunity, setComposeCommunity] = useState<string>("");
  const [creatingCommunity, setCreatingCommunity] = useState(false);
  const [newCommunityName, setNewCommunityName] = useState("");
  const [newCommunityKind, setNewCommunityKind] = useState("topic-circle");
  const [busy, setBusy] = useState(false);

  const requireAuth = useCallback((): boolean => {
    if (!userId) { window.location.href = "/login"; return false; }
    return true;
  }, [userId]);

  /* ── loading ── */

  const loadCommunities = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    setUserId(auth?.user?.id ?? null);
    const { data } = await supabase
      .from("communities")
      .select("id, name, kind, color, community_members(user_id)");
    setCommunities(
      (data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        color: c.color ?? "#4a9eff",
        members: (c.community_members ?? []).length,
        joined: (c.community_members ?? []).some(
          (m: { user_id: string }) => m.user_id === auth?.user?.id
        ),
      }))
    );
  }, [supabase]);

  const loadPosts = useCallback(async () => {
    setLoadingPosts(true);
    const { data, error: err } = await supabase.rpc("get_community_posts", {
      p_community: selected === "all" ? null : selected,
      p_sort: sort,
      p_limit: 50,
    });
    setLoadingPosts(false);
    if (err) { setError(err.message); return; }
    setError(null);
    setPosts((data ?? []) as Post[]);
  }, [supabase, selected, sort]);

  const loadComments = useCallback(async (postId: string) => {
    const { data } = await supabase.rpc("get_post_comments", { p_post: postId });
    setComments((data ?? []) as Comment[]);
  }, [supabase]);

  useEffect(() => { if (open) loadCommunities(); }, [open, loadCommunities]);
  useEffect(() => { if (open) loadPosts(); }, [open, loadPosts]);

  useEscapeClose(open, () => (openPost ? setOpenPost(null) : onClose()));

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

  const submitPost = useCallback(async () => {
    if (!requireAuth()) return;
    const communityId = selected !== "all" ? selected : composeCommunity;
    const title = newTitle.trim();
    if (!communityId || !title) return;
    setBusy(true);
    const { error: err } = await supabase.from("community_posts").insert({
      community_id: communityId,
      author_id: userId,
      title,
      body: newBody.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(err.message.includes("rate_limited")
        ? "You're posting too quickly — try again in a few minutes."
        : err.message);
      return;
    }
    setComposing(false);
    setNewTitle(""); setNewBody("");
    loadPosts();
  }, [supabase, requireAuth, selected, composeCommunity, newTitle, newBody, userId, loadPosts]);

  const submitComment = useCallback(async (parentId: string | null, body: string) => {
    if (!openPost || !requireAuth()) return;
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    const { error: err } = await supabase.from("community_comments").insert({
      post_id: openPost.id,
      parent_id: parentId,
      author_id: userId,
      body: text,
    });
    setBusy(false);
    if (err) {
      setError(err.message.includes("rate_limited")
        ? "Slow down — you're commenting too quickly."
        : err.message);
      return;
    }
    setCommentText(""); setReplyTo(null); setReplyText("");
    loadComments(openPost.id);
    const bump = (p: Post): Post =>
      p.id === openPost.id ? { ...p, comment_count: p.comment_count + 1 } : p;
    setPosts((ps) => ps.map(bump));
    setOpenPost((p) => (p ? bump(p) : p));
  }, [supabase, requireAuth, openPost, userId, loadComments]);

  const deletePost = useCallback(async (post: Post) => {
    if (!confirm("Delete this post? Its comments go with it.")) return;
    const { error: err } = await supabase.from("community_posts").delete().eq("id", post.id);
    if (!err) {
      setOpenPost(null);
      setPosts((ps) => ps.filter((p) => p.id !== post.id));
    }
  }, [supabase]);

  const deleteComment = useCallback(async (comment: Comment) => {
    if (!openPost) return;
    if (!confirm("Delete this comment? Replies to it go with it.")) return;
    const { error: err } = await supabase.from("community_comments").delete().eq("id", comment.id);
    if (!err) loadComments(openPost.id);
  }, [supabase, openPost, loadComments]);

  const toggleJoin = useCallback(async (c: Community) => {
    if (!requireAuth()) return;
    if (c.joined) {
      await supabase.from("community_members").delete()
        .eq("community_id", c.id).eq("user_id", userId!);
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
      .insert({ name, kind: newCommunityKind, created_by: userId })
      .select("id")
      .single();
    if (!err && data) {
      await supabase.from("community_members").insert({ community_id: data.id, user_id: userId, role: "owner" });
      setCreatingCommunity(false);
      setNewCommunityName("");
      setSelected(data.id);
      loadCommunities();
    }
  }, [supabase, requireAuth, newCommunityName, newCommunityKind, userId, loadCommunities]);

  /* ── derived ── */

  const selectedCommunity = useMemo(
    () => communities.find((c) => c.id === selected) ?? null,
    [communities, selected]
  );

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
    roots.sort(bySort);
    for (const list of children.values()) list.sort(bySort);
    const subtreeSize = (id: string): number => {
      const direct = children.get(id) ?? [];
      return direct.reduce((n, d) => n + 1 + subtreeSize(d.id), 0);
    };
    return { roots, children, subtreeSize };
  }, [comments, commentSort]);

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

  /* One thread node: collapse toggle, vote pips, body, actions, reply
     box, then children — visual indent caps at MAX_INDENT so deep
     chains stay readable while true nesting is preserved. */
  const renderThread = (c: Comment, depth: number): React.ReactNode => {
    const kids = commentTree.children.get(c.id) ?? [];
    const isCollapsed = collapsed.has(c.id);
    const hidden = commentTree.subtreeSize(c.id);
    return (
      <div key={c.id} style={{ marginLeft: depth > 0 ? 18 : 0 }}>
        <div
          className="pl-3 mb-2"
          style={depth > 0 ? { borderLeft: "2px solid rgba(255,255,255,0.08)" } : undefined}
        >
          <div className="px-3.5 py-2.5" style={{ ...card, borderRadius: 10 }}>
            <div className="flex items-center gap-2 flex-wrap">
              {kids.length > 0 && (
                <button
                  onClick={() => toggleCollapse(c.id)}
                  className="cursor-pointer bg-transparent border-none p-0 text-[11px]"
                  style={{ color: "#6b6b74", fontFamily: "inherit", width: 16 }}
                  aria-label={isCollapsed ? "Expand thread" : "Collapse thread"}
                >
                  {isCollapsed ? "[+]" : "[\u2013]"}
                </button>
              )}
              <span className="text-[11px]" style={{ color: "#8b8b94" }}>
                @{c.author_username} · {timeAgo(c.created_at)}
              </span>
              {isCollapsed && hidden > 0 && (
                <span className="text-[10px]" style={{ color: "#c9b06a" }}>
                  {hidden} repl{hidden === 1 ? "y" : "ies"} hidden
                </span>
              )}
            </div>
            {!isCollapsed && (
              <>
                <p className="m-0 mt-1 text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: "#e5e5ec" }}>
                  {c.body}
                </p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="flex items-center gap-1">
                    <button
                      onClick={() => voteComment(c, c.my_vote === 1 ? 0 : 1)}
                      className="cursor-pointer bg-transparent border-none p-0 text-[11px]"
                      style={{ color: c.my_vote === 1 ? "#f4d47c" : "#6b6b74" }}
                      aria-label="Upvote comment"
                    >
                      ▲
                    </button>
                    <span className="text-[11px]" style={{ color: "#c0c0c8", fontWeight: 600, minWidth: 12, textAlign: "center" }}>
                      {c.score}
                    </span>
                    <button
                      onClick={() => voteComment(c, c.my_vote === -1 ? 0 : -1)}
                      className="cursor-pointer bg-transparent border-none p-0 text-[11px]"
                      style={{ color: c.my_vote === -1 ? "#85b7eb" : "#6b6b74" }}
                      aria-label="Downvote comment"
                    >
                      ▼
                    </button>
                  </span>
                  <button
                    onClick={() => { if (requireAuth()) { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(""); } }}
                    className="cursor-pointer bg-transparent border-none p-0 text-[10px]"
                    style={{ color: "#9cc4f0", fontFamily: "inherit" }}
                  >
                    Reply
                  </button>
                  {c.author_id === userId && (
                    <button
                      onClick={() => deleteComment(c)}
                      className="cursor-pointer bg-transparent border-none p-0 text-[10px]"
                      style={{ color: "#6b6b74", fontFamily: "inherit" }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                {replyTo === c.id && (
                  <div className="flex gap-2 mt-2">
                    <input
                      style={inputStyle}
                      placeholder={`Reply to @${c.author_username}\u2026`}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitComment(c.id, replyText); }}
                      autoFocus
                    />
                    <button
                      onClick={() => submitComment(c.id, replyText)}
                      disabled={busy || !replyText.trim()}
                      className="cursor-pointer text-[11px] px-3 rounded-lg shrink-0"
                      style={{ background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0", fontFamily: "inherit" }}
                    >
                      Reply
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          {!isCollapsed && kids.map((k) => renderThread(k, depth < MAX_INDENT ? depth + 1 : depth))}
        </div>
      </div>
    );
  };

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
        background: "var(--bg-primary, #0a0a0c)",
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-5">

        {/* header */}
        <div className="flex items-center gap-3.5 mb-4 flex-wrap">
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>
            Communities
          </span>
          <span className="text-[12px]" style={{ color: "#8b8b94" }}>
            Boards for your school, team, or topic
          </span>
          <button
            onClick={() => { if (requireAuth()) setCreatingCommunity((v) => !v); }}
            className="cursor-pointer text-[12px] font-medium px-4 py-1.5 rounded-full border-none ml-auto"
            style={{ background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402" }}
          >
            + New community
          </button>
        </div>

        {error && (
          <p className="mb-3 px-4 py-2.5 rounded-lg text-[12px]"
            style={{ background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
            {error}
            <button onClick={() => setError(null)} className="ml-3 cursor-pointer bg-transparent border-none text-[11px]" style={{ color: "#8b8b94" }}>
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
              style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#e5e5ec" }}
            >
              {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <button
              onClick={createCommunity}
              disabled={!newCommunityName.trim()}
              className="cursor-pointer text-[12px] px-4 py-2 rounded-lg"
              style={{ background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0", fontFamily: "inherit" }}
            >
              Create
            </button>
          </div>
        )}

        <div className="flex gap-5 items-start flex-col md:flex-row">

          {/* community rail */}
          <nav className="w-full md:w-[230px] shrink-0">
            <button
              onClick={() => { setSelected("all"); setOpenPost(null); }}
              className="block w-full text-left cursor-pointer mb-1 px-3.5 py-2.5 border-none"
              style={{
                borderRadius: 10, fontFamily: "inherit",
                background: selected === "all" ? "rgba(255,255,255,0.07)" : "transparent",
              }}
            >
              <span className="text-[13px]" style={{ color: "#f5f5f0" }}>All posts</span>
            </button>
            {communities.map((c) => (
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
                  className="flex items-center justify-center shrink-0"
                  style={{ width: 26, height: 26, borderRadius: 8, background: c.color, color: "#fff", fontSize: 12, fontFamily: "'Syne', sans-serif", fontWeight: 700 }}
                >
                  {c.name.charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] truncate" style={{ color: "#f5f5f0" }}>{c.name}</span>
                  <span className="block text-[10px]" style={{ color: "#6b6b74" }}>
                    {c.members} member{c.members === 1 ? "" : "s"}
                  </span>
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleJoin(c); }}
                  className="cursor-pointer text-[10px] px-2 py-1 rounded-md shrink-0"
                  style={
                    c.joined
                      ? { background: "transparent", border: "0.5px solid #3a5a3a", color: "#97c459", fontFamily: "inherit" }
                      : { background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0", fontFamily: "inherit" }
                  }
                >
                  {c.joined ? "✓" : "Join"}
                </button>
              </div>
            ))}
            {communities.length === 0 && (
              <p className="px-3.5 text-[11px]" style={{ color: "#6b6b74" }}>
                No communities yet — create the first one.
              </p>
            )}
          </nav>

          {/* main column */}
          <main className="flex-1 min-w-0 w-full">

            {openPost ? (
              /* ── post detail ── */
              <div>
                <button
                  onClick={() => setOpenPost(null)}
                  className="cursor-pointer text-[12px] px-3 py-1.5 rounded-lg mb-3"
                  style={{ background: "transparent", border: "0.5px solid #3a3a42", color: "#c0c0c8", fontFamily: "inherit" }}
                >
                  ← Back to {selectedCommunity?.name ?? "all posts"}
                </button>

                <div className="p-4 mb-4 flex gap-3" style={card}>
                  <VoteBox post={openPost} onVote={vote} size={14} />
                  <div className="flex-1 min-w-0">
                    <p className="m-0 text-[11px]" style={{ color: "#8b8b94" }}>
                      {openPost.community_name} · @{openPost.author_username} · {timeAgo(openPost.created_at)}
                    </p>
                    <h2 className="m-0 mt-1 text-[17px]" style={{ color: "#f5f5f0", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>
                      {openPost.title}
                    </h2>
                    {openPost.body && (
                      <p className="m-0 mt-2 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "#d5d5dc" }}>
                        {openPost.body}
                      </p>
                    )}
                    {openPost.author_id === userId && (
                      <button
                        onClick={() => deletePost(openPost)}
                        className="cursor-pointer bg-transparent border-none p-0 mt-2 text-[11px]"
                        style={{ color: "#6b6b74", fontFamily: "inherit" }}
                      >
                        Delete post
                      </button>
                    )}
                  </div>
                </div>

                {/* comment composer */}
                <div className="flex gap-2 mb-4">
                  <input
                    style={inputStyle}
                    placeholder={userId ? "Add a comment…" : "Sign in to comment"}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitComment(null, commentText); }}
                    onFocus={() => { if (!userId) window.location.href = "/login"; }}
                  />
                  <button
                    onClick={() => submitComment(null, commentText)}
                    disabled={busy || !commentText.trim()}
                    className="cursor-pointer text-[12px] px-4 rounded-lg shrink-0"
                    style={{ background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0", fontFamily: "inherit" }}
                  >
                    Comment
                  </button>
                </div>

                {/* comments */}
                {commentTree.roots.length > 0 && (
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[11px]" style={{ color: "#6b6b74" }}>Sort:</span>
                    {(["top", "new"] as const).map((cs) => (
                      <button
                        key={cs}
                        onClick={() => setCommentSort(cs)}
                        className="cursor-pointer text-[11px] px-2.5 py-1 rounded-full"
                        style={{
                          background: commentSort === cs ? "rgba(255,255,255,0.1)" : "transparent",
                          border: "0.5px solid " + (commentSort === cs ? "#4a4a54" : "#34343c"),
                          color: commentSort === cs ? "#f5f5f0" : "#8b8b94",
                          fontFamily: "inherit",
                        }}
                      >
                        {cs === "top" ? "Top" : "New"}
                      </button>
                    ))}
                  </div>
                )}
                {commentTree.roots.length === 0 ? (
                  <p className="text-[12px] text-center py-6" style={{ color: "#6b6b74" }}>
                    No comments yet — start the discussion.
                  </p>
                ) : (
                  commentTree.roots.map((root) => renderThread(root, 0))
                )}
              </div>
            ) : (
              /* ── feed ── */
              <div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {(["new", "top"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSort(s)}
                      className="cursor-pointer text-[12px] px-3.5 py-1.5 rounded-full"
                      style={{
                        background: sort === s ? "rgba(255,255,255,0.1)" : "rgba(20,20,26,0.85)",
                        border: "0.5px solid " + (sort === s ? "#4a4a54" : "#34343c"),
                        color: sort === s ? "#f5f5f0" : "#c0c0c8",
                        fontFamily: "inherit",
                      }}
                    >
                      {s === "new" ? "New" : "Top"}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      if (!requireAuth()) return;
                      setComposing((v) => !v);
                      setComposeCommunity(selected !== "all" ? selected : (communities.find((c) => c.joined)?.id ?? communities[0]?.id ?? ""));
                    }}
                    className="cursor-pointer text-[12px] px-4 py-1.5 rounded-full ml-auto"
                    style={{ background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0", fontFamily: "inherit" }}
                  >
                    + New post
                  </button>
                </div>

                {composing && (
                  <div className="p-4 mb-4 flex flex-col gap-2.5" style={card}>
                    {selected === "all" && (
                      <select
                        value={composeCommunity}
                        onChange={(e) => setComposeCommunity(e.target.value)}
                        className="text-[13px] px-3 py-2 rounded-lg self-start"
                        style={{ background: "rgba(20,20,26,0.85)", border: "0.5px solid #34343c", color: "#e5e5ec" }}
                      >
                        {communities.length === 0 && <option value="">No communities yet</option>}
                        {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                    <input
                      style={inputStyle}
                      placeholder="Title"
                      maxLength={200}
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                    <textarea
                      style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
                      placeholder="Text (optional)"
                      maxLength={10000}
                      value={newBody}
                      onChange={(e) => setNewBody(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={submitPost}
                        disabled={busy || !newTitle.trim() || (selected === "all" && !composeCommunity)}
                        className="cursor-pointer text-[12px] px-4 py-2 rounded-lg"
                        style={{ background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0", fontFamily: "inherit" }}
                      >
                        {busy ? "Posting…" : "Post"}
                      </button>
                      <button
                        onClick={() => setComposing(false)}
                        className="cursor-pointer text-[12px] px-4 py-2 rounded-lg"
                        style={{ background: "transparent", border: "0.5px solid #3a3a42", color: "#c0c0c8", fontFamily: "inherit" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {loadingPosts && posts.length === 0 && (
                  <p className="text-[12px] text-center py-8" style={{ color: "#6b6b74" }}>Loading…</p>
                )}

                {!loadingPosts && posts.length === 0 && (
                  <div className="p-8 text-center" style={card}>
                    <p className="m-0 mb-1 text-[13px]" style={{ color: "#f5f5f0" }}>
                      {selectedCommunity ? `No posts in ${selectedCommunity.name} yet` : "No posts yet"}
                    </p>
                    <p className="m-0 text-[11px]" style={{ color: "#8b8b94" }}>
                      Start the first thread — a question, a take, a topic worth arguing about.
                    </p>
                  </div>
                )}

                {posts.map((p) => (
                  <div
                    key={p.id}
                    className="p-3.5 mb-2.5 flex gap-3 cursor-pointer"
                    style={card}
                    onClick={() => { setOpenPost(p); loadComments(p.id); setCommentText(""); setReplyTo(null); }}
                  >
                    <VoteBox post={p} onVote={vote} />
                    <div className="flex-1 min-w-0">
                      <p className="m-0 text-[10.5px]" style={{ color: "#8b8b94" }}>
                        {selected === "all" && <><span style={{ color: "#c9b06a" }}>{p.community_name}</span> · </>}
                        @{p.author_username} · {timeAgo(p.created_at)}
                      </p>
                      <p className="m-0 mt-0.5 text-[14px] font-medium" style={{ color: "#f5f5f0" }}>
                        {p.title}
                      </p>
                      {p.body && (
                        <p className="m-0 mt-1 text-[12px] leading-relaxed" style={{
                          color: "#9a9aa2",
                          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                        }}>
                          {p.body}
                        </p>
                      )}
                      <p className="m-0 mt-1.5 text-[11px]" style={{ color: "#6b6b74" }}>
                        💬 {p.comment_count} comment{p.comment_count === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
