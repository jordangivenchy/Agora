"use client";

/* Ended-room replay: the HLS VOD recording (when the host streamed),
   the stage transcript synced to playback, and the post-debate
   discussion thread. Rendered by /agora/<room> once status === 'ended'
   so every existing room link becomes the replay link.

   Data comes from three RPCs (20260851_debate_recordings.sql):
     get_debate_replay(p_room)          — room + host + speakers + recording
     get_debate_transcript(p_room)      — ordered utterances with offsets
     ensure_debate_discussion(p_room)   — lazily creates the discussion post */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { roomPath, userPath } from "@/lib/urls";
import { pathFor } from "@/lib/routes";
import { displayName } from "@/lib/names";
import { TOPICS } from "@/types/database";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import ReplayPlayer from "./ReplayPlayer";
import "./debate-replay.css";

type Person = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type ReplayRoom = {
  id: string;
  motion: string;
  topic_key: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  viewer_count: number | null;
  community_id: string | null;
  thumbnail_url: string | null;
  host: Person | null;
  speakers: (Person & { role: "host" | "cohost" | "speaker"; side: "pro" | "con" | null })[];
  recording_url: string | null;
  recording_started_at: string | null;
  recording_ended_at: string | null;
  discussion_post_id: string | null;
  discussion_comment_count: number;
  transcript_count: number;
};

type Line = {
  id: string;
  user_id: string | null;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  content: string;
  created_at: string;
  offset_seconds: number | null;
};

type Comment = {
  id: string;
  parent_id: string | null;
  author_id: string | null;
  author_username: string;
  author_display_name: string | null;
  body: string;
  created_at: string;
};

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

type Client = ReturnType<typeof createClient>;

async function loadFallback(supabase: Client, roomId: string): Promise<{ room: ReplayRoom | null; lines: Line[] }> {
  const { data: row } = await supabase.from("debate_rooms").select("*").eq("id", roomId).maybeSingle();
  if (!row) return { room: null, lines: [] };
  const [{ data: host }, { data: parts }, { data: utt }] = await Promise.all([
    supabase.from("users").select("id, username, display_name, avatar_url").eq("id", row.host_id).maybeSingle(),
    supabase
      .from("debate_participants")
      .select("user_id, role, stance, stage_role, joined_at, user:users(id, username, display_name, avatar_url)")
      .eq("room_id", roomId)
      .order("joined_at", { ascending: true }),
    supabase
      .from("debate_utterances")
      .select("id, user_id, content, created_at, user:users(username, display_name, avatar_url)")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(2000),
  ]);
  const seen = new Set<string>();
  const speakers: ReplayRoom["speakers"] = [];
  type PRow = {
    user_id: string;
    role: string;
    stance: "pro" | "con" | null;
    stage_role?: string | null;
    user: Person | Person[] | null;
  };
  for (const p of ((parts ?? []) as unknown as PRow[])) {
    const u = Array.isArray(p.user) ? p.user[0] : p.user;
    if (!u || seen.has(p.user_id)) continue;
    const isHost = p.user_id === row.host_id;
    const staged = p.stage_role && ["host", "cohost", "speaker"].includes(p.stage_role);
    if (!isHost && p.role !== "debater" && !staged) continue;
    seen.add(p.user_id);
    speakers.push({
      ...u,
      role: isHost ? "host" : p.stage_role === "cohost" ? "cohost" : "speaker",
      side: p.stance ?? null,
    });
  }
  speakers.sort((a, b) => (a.role === "host" ? -1 : b.role === "host" ? 1 : 0));
  const startedAt: string | null = row.recording_started_at ?? null;
  type URow = { id: string; user_id: string; content: string; created_at: string; user: Partial<Person> | Partial<Person>[] | null };
  const lines: Line[] = ((utt ?? []) as unknown as URow[]).map((x) => {
    const u = Array.isArray(x.user) ? x.user[0] : x.user;
    return {
      id: x.id,
      user_id: x.user_id,
      username: u?.username ?? "(deleted)",
      display_name: u?.display_name ?? null,
      avatar_url: u?.avatar_url ?? null,
      content: x.content,
      created_at: x.created_at,
      offset_seconds: startedAt
        ? Math.max(0, (new Date(x.created_at).getTime() - new Date(startedAt).getTime()) / 1000)
        : null,
    };
  });
  return {
    room: {
      id: row.id,
      motion: row.motion,
      topic_key: row.topic_key,
      status: row.status,
      created_at: row.created_at,
      started_at: row.started_at,
      ended_at: row.ended_at,
      viewer_count: row.viewer_count,
      community_id: row.community_id ?? null,
      thumbnail_url: row.thumbnail_url ?? null,
      host: (host as Person | null) ?? null,
      speakers,
      recording_url: row.recording_url ?? null,
      recording_started_at: startedAt,
      recording_ended_at: row.recording_ended_at ?? null,
      discussion_post_id: row.discussion_post_id ?? null,
      discussion_comment_count: 0,
      transcript_count: lines.length,
    },
    lines,
  };
}

export default function DebateReplay({
  roomId,
  initialRoom,
}: {
  roomId: string;
  /** Optional: pass the already-loaded room row to skip the header flash. */
  initialRoom?: { motion: string; topic_key: string; ended_at: string | null } | null;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [room, setRoom] = useState<ReplayRoom | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [discussBusy, setDiscussBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const recordingUrl = room?.recording_url ?? null;
  /* Load errors surface from the shared ReplayPlayer (which owns the
     HLS attach); seeking from the transcript is gated on them. */
  const [playerError, setPlayerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      supabase.auth
        .getUser()
        .then(({ data }) => setSignedIn(!!data.user))
        .catch(() => setSignedIn(false));
      const [{ data: replay, error: rErr }, { data: tx }] = await Promise.all([
        supabase.rpc("get_debate_replay", { p_room: roomId }),
        supabase.rpc("get_debate_transcript", { p_room: roomId, p_limit: 2000 }),
      ]);
      let r = (replay as ReplayRoom | null) ?? null;
      let txLines = (tx as Line[] | null) ?? [];
      if (rErr || !r) {
        /* Migration drift (20260851 not applied yet): assemble the header
           from the base tables so an ended room still opens. */
        if (rErr) console.warn("get_debate_replay unavailable, falling back", rErr.message);
        const fb = await loadFallback(supabase, roomId);
        r = fb.room;
        if (!tx) txLines = fb.lines;
      }
      setRoom(r);
      setLines(txLines.filter((l) => l && l.content));
      if (r?.discussion_post_id) {
        const { data: cs } = await supabase.rpc("get_post_comments", {
          p_post: r.discussion_post_id,
          p_limit: 60,
          p_offset: 0,
        });
        /* Full thread inline, newest first — YouTube-style under the VOD. */
        const list = ((cs as Comment[] | null) ?? [])
          .slice()
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        setComments(list);
      } else {
        setComments([]);
      }
    } catch (e) {
      console.error("replay load failed", e);
    } finally {
      setLoaded(true);
    }
  }, [roomId, supabase]);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (alive) void load();
    });
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  /* Follow playback: the line whose offset most recently passed is current. */
  const seekable = lines.some((l) => l.offset_seconds !== null);
  const currentId = useMemo(() => {
    if (!seekable || !recordingUrl) return null;
    let found: string | null = null;
    for (const l of lines) {
      if (l.offset_seconds !== null && l.offset_seconds <= currentTime + 0.5) found = l.id;
      else if (l.offset_seconds !== null && l.offset_seconds > currentTime) break;
    }
    return found;
  }, [lines, currentTime, seekable, recordingUrl]);

  const [userScrolled, setUserScrolled] = useState(false);
  useEffect(() => {
    if (!currentId || userScrolled || query) return;
    const el = lineRefs.current.get(currentId);
    const box = transcriptRef.current;
    if (!el || !box) return;
    const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    box.scrollTo({ top, behavior: "smooth" });
  }, [currentId, userScrolled, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) =>
        l.content.toLowerCase().includes(q) ||
        displayName(l).toLowerCase().includes(q) ||
        l.username.toLowerCase().includes(q)
    );
  }, [lines, query]);

  const seekTo = (sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, sec - 1);
    v.play().catch(() => {});
    setUserScrolled(false);
  };

  const share = async () => {
    if (!room) return;
    const url = `${window.location.origin}${roomPath({ id: room.id, motion: room.motion })}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast("Replay link copied");
    } catch {
      setToast(url);
    }
  };

  const openDiscussion = async () => {
    if (!room) return;
    if (room.discussion_post_id) {
      router.push(pathFor.post(room.discussion_post_id));
      return;
    }
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(roomPath({ id: room.id, motion: room.motion }))}`);
      return;
    }
    setDiscussBusy(true);
    const { data, error } = await supabase.rpc("ensure_debate_discussion", { p_room: room.id });
    setDiscussBusy(false);
    if (error || !data) {
      console.error("ensure_debate_discussion failed", error);
      setToast("Couldn't open the discussion — try again in a moment.");
      return;
    }
    router.push(pathFor.post(data as string));
  };

  /* ── Inline comments (YouTube-style, under the VOD) ────────────────
     Same thread as the community post: comments written here land in
     community_comments on the room's discussion post, lazily creating
     the post on the first comment. Top-level only — replies and voting
     live in the full thread. */
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const submitReplayComment = async () => {
    if (!room || commentBusy) return;
    const text = commentDraft.trim();
    if (!text) return;
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(roomPath({ id: room.id, motion: room.motion }))}`);
      return;
    }
    setCommentBusy(true);
    try {
      let postId = room.discussion_post_id;
      if (!postId) {
        const { data, error } = await supabase.rpc("ensure_debate_discussion", { p_room: room.id });
        if (error || !data) throw error ?? new Error("no post");
        postId = data as string;
        setRoom((r) => (r ? { ...r, discussion_post_id: postId } : r));
      }
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("not signed in");
      const { error: insErr } = await supabase.from("community_comments").insert({
        post_id: postId,
        parent_id: null,
        author_id: auth.user.id,
        body: text,
      });
      if (insErr) throw insErr;
      setCommentDraft("");
      setRoom((r) => (r ? { ...r, discussion_comment_count: r.discussion_comment_count + 1 } : r));
      const { data: cs } = await supabase.rpc("get_post_comments", {
        p_post: postId,
        p_limit: 60,
        p_offset: 0,
      });
      setComments(
        ((cs as Comment[] | null) ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
      );
    } catch (e) {
      console.error("replay comment failed", e);
      setToast(
        e instanceof Error && /rate_limited/.test(e.message)
          ? "Slow down — you're commenting too quickly."
          : "Couldn't post the comment — try again."
      );
    } finally {
      setCommentBusy(false);
    }
  };

  if (!loaded) {
    return (
      <div className="ag-root ag-loading">
        <div className="ag-spinner" />
        <span>Opening the replay…</span>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="dr-root">
        <div className="dr-wrap">
          <div className="dr-empty" style={{ paddingTop: 80 }}>
            This discussion isn&apos;t available.
            <div style={{ marginTop: 16 }}>
              <button className="dr-btn" onClick={() => router.push("/")}>
                ← Back to home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const motion = room.motion || initialRoom?.motion || "Discussion";
  const topic = TOPICS.find((t) => t.key === (room.topic_key ?? initialRoom?.topic_key));
  const recorded = !!room.recording_url;
  const startMs = room.recording_started_at ?? room.started_at;
  const endMs = room.recording_ended_at ?? room.ended_at;
  const durationLabel =
    startMs && endMs ? fmtDuration(new Date(endMs).getTime() - new Date(startMs).getTime()) : null;
  const when = room.ended_at ?? room.started_at ?? room.created_at;
  const hasTranscript = lines.length > 0;
  const posterStyle = room.thumbnail_url
    ? { backgroundImage: `url(${room.thumbnail_url})`, backgroundSize: "cover", backgroundPosition: "center" }
    : undefined;

  return (
    <div className="dr-root">
      <div className="dr-wrap">
        <div className="dr-topbar">
          <button className="dr-back" onClick={() => router.push("/")} title="Back to home">
            ←
          </button>
          <span className="dr-tag">
            <span className="dr-tag-dot" /> {recorded ? "Replay" : "Ended discussion"}
          </span>
          <span className="dr-spacer" />
          <button className="dr-btn" onClick={share} title="Copy the replay link">
            <Icon name="share" size={13} /> Share
          </button>
        </div>

        <header className="dr-head">
          <h1 className="dr-motion">{motion}</h1>
          <div className="dr-meta">
            {topic && (
              <span className="dr-chip" style={{ borderColor: `${topic.color}55` }}>
                <span aria-hidden>{topic.emoji}</span> {topic.label}
              </span>
            )}
            <span>
              {new Date(when).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}
            </span>
            {recorded && durationLabel && (
              <span>
                <Icon name="video" size={12} /> Recorded · {durationLabel}
              </span>
            )}
            {!recorded && durationLabel && <span>Lasted {durationLabel}</span>}
            {!!room.viewer_count && (
              <span>
                <Icon name="eye" size={12} /> {room.viewer_count} watched
              </span>
            )}
          </div>
          <div className="dr-people">
            {room.speakers.map((p) => (
              <a key={p.id} className="dr-person" href={userPath(p.username)}>
                <UserAvatar username={p.username} avatarUrl={p.avatar_url} seed={p.id} size={22} />
                <span>{displayName(p)}</span>
                <span className={`dr-person-role ${p.side ?? ""}`}>
                  {p.role === "host" ? "Host" : p.role === "cohost" ? "Co-host" : p.side ? p.side : "Speaker"}
                </span>
              </a>
            ))}
            {room.speakers.length === 0 && room.host && (
              <a className="dr-person" href={userPath(room.host.username)}>
                <UserAvatar username={room.host.username} avatarUrl={room.host.avatar_url} seed={room.host.id} size={22} />
                <span>{displayName(room.host)}</span>
                <span className="dr-person-role">Host</span>
              </a>
            )}
          </div>
        </header>

        <div className="dr-grid">
          <div className="dr-player" style={posterStyle}>
            {recorded ? (
              <>
                <ReplayPlayer
                  ref={videoRef}
                  src={recordingUrl}
                  poster={room.thumbnail_url ?? room.host?.avatar_url ?? undefined}
                  onTimeUpdate={setCurrentTime}
                  onSeeking={() => setUserScrolled(false)}
                  onError={setPlayerError}
                  errorFallback={
                    <div className="dr-player-error">
                      This recording couldn&apos;t be loaded. It may still be finalizing — try again in a minute.
                    </div>
                  }
                  style={{ height: "100%", borderRadius: 0 }}
                />
              </>
            ) : (
              <div className="dr-player-empty">
                {room.host && (
                  <UserAvatar username={room.host.username} avatarUrl={room.host.avatar_url} seed={room.host.id} size={56} />
                )}
                <strong>This discussion wasn&apos;t recorded</strong>
                <span>
                  {hasTranscript
                    ? "The host didn't stream it, but the stage transcript is here — and the discussion is open."
                    : "The host didn't stream it, and no transcript was captured. The discussion is still open."}
                </span>
              </div>
            )}
          </div>

          <aside className="dr-panel">
            <div className="dr-panel-head">
              <span className="dr-panel-title">Transcript{lines.length ? ` · ${lines.length}` : ""}</span>
              {hasTranscript && (
                <label className="dr-search">
                  <Icon name="search" size={12} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search the transcript"
                    aria-label="Search the transcript"
                  />
                </label>
              )}
            </div>
            <div
              className="dr-transcript"
              ref={transcriptRef}
              onWheel={() => setUserScrolled(true)}
              onTouchMove={() => setUserScrolled(true)}
            >
              {!hasTranscript && (
                <div className="dr-empty">
                  No transcript for this discussion.
                  <br />
                  Transcripts are captured when speakers have live listening on.
                </div>
              )}
              {hasTranscript && filtered.length === 0 && (
                <div className="dr-empty">Nothing matches &ldquo;{query}&rdquo;.</div>
              )}
              {filtered.map((l) => {
                const canSeek = recorded && l.offset_seconds !== null && !playerError;
                return (
                  <div
                    key={l.id}
                    ref={(el) => {
                      if (el) lineRefs.current.set(l.id, el);
                      else lineRefs.current.delete(l.id);
                    }}
                    className={`dr-line${canSeek ? " seekable" : ""}${l.id === currentId ? " current" : ""}`}
                    onClick={canSeek ? () => seekTo(l.offset_seconds!) : undefined}
                    role={canSeek ? "button" : undefined}
                    title={canSeek ? "Jump to this moment" : undefined}
                  >
                    <UserAvatar username={l.username} avatarUrl={l.avatar_url} seed={l.user_id ?? l.username} size={24} />
                    <div>
                      <div className="dr-line-name">{displayName(l)}</div>
                      <div className="dr-line-text">{highlight(l.content, query.trim())}</div>
                    </div>
                    <span className="dr-line-time">
                      {l.offset_seconds !== null
                        ? fmtClock(l.offset_seconds)
                        : new Date(l.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>

        <section className="dr-section">
          <div className="dr-section-head">
            <div>
              <h2 className="dr-section-title">Discussion</h2>
              <p className="dr-section-sub">
                {room.discussion_post_id
                  ? room.discussion_comment_count === 1
                    ? "1 comment"
                    : `${room.discussion_comment_count} comments`
                  : "Nobody has weighed in yet — be the first."}
              </p>
            </div>
            <button className="dr-btn" onClick={openDiscussion} disabled={discussBusy}>
              <Icon name="megaphone" size={13} />
              {discussBusy ? "Opening…" : "Open full thread"}
            </button>
          </div>

          {/* Composer — comments land in the room's community thread. */}
          <div className="dr-comment-composer">
            <textarea
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitReplayComment();
              }}
              placeholder={signedIn ? "Add a comment… (⌘↩ to post)" : "Sign in to comment"}
              rows={2}
              maxLength={4000}
            />
            <button
              className="dr-btn primary"
              onClick={submitReplayComment}
              disabled={commentBusy || !commentDraft.trim()}
            >
              {commentBusy ? "Posting…" : "Comment"}
            </button>
          </div>

          {comments.length > 0 && (
            <div className="dr-comments">
              {comments.map((c) => (
                <div key={c.id} className="dr-comment">
                  <UserAvatar
                    username={c.author_username}
                    avatarUrl={null}
                    seed={c.author_id ?? c.author_username}
                    size={28}
                  />
                  <div>
                    <div className="dr-comment-meta">
                      <strong>{displayName({ display_name: c.author_display_name, username: c.author_username })}</strong>{" "}
                      · {timeAgo(c.created_at)}
                    </div>
                    <div className="dr-comment-body">{c.body}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {toast && (
        <div className="dr-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
