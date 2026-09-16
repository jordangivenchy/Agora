/* A past discussion, read the way the site's replay page reads it
   (components/agora/DebateReplay.tsx): the room with its speakers and
   recording (get_debate_replay), the transcript (the polished
   replay_transcripts lines when they exist, else the live utterances from
   get_debate_transcript), the discussion thread (ensure_debate_discussion
   makes the post on first use; get_post_comments reads it), likes
   (replay_like_state, toggle_replay_like), the view count
   (bump_replay_view), and more recorded discussions to watch next. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTimeline, type TimelineSpan } from "../../src/components/agora/hlsTimeline";
import type { CommentRow } from "./communities";

export interface ReplayPerson { id: string; username: string; display_name: string | null; avatar_url: string | null }
export interface ReplaySpeaker extends ReplayPerson { role: "host" | "cohost" | "speaker"; side: "pro" | "con" | "PRO" | "CON" | null }

export interface ReplayRoom {
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
  host: ReplayPerson | null;
  speakers: ReplaySpeaker[];
  recording_url: string | null;
  recording_started_at: string | null;
  recording_ended_at: string | null;
  discussion_post_id: string | null;
  discussion_comment_count: number;
  /** The comments are also a thread in a community — someone made one. */
  discussion_listed: boolean;
  /** That community's name, for the line that points at it. */
  discussion_community: string | null;
  transcript_count: number;
}

export interface TranscriptLine {
  id: string;
  user_id: string | null;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  content: string;
  created_at: string;
  /** Seconds from recording_started_at; null when the room wasn't recorded. */
  offset_seconds: number | null;
}

export interface MoreReplay {
  id: string;
  motion: string;
  topic_key: string | null;
  thumbnail_url: string | null;
  started_at: string | null;
  ended_at: string | null;
  host: { username: string; display_name: string | null; avatar_url: string | null } | null;
}

type PolishedLine = { offset_seconds: number; text: string; user_id: string | null; username: string | null; display_name: string | null; avatar_url: string | null };
const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

/* Without get_debate_replay (an older database), the header from the base tables. */
async function loadFallback(supabase: SupabaseClient, roomId: string): Promise<{ room: ReplayRoom | null; lines: TranscriptLine[] }> {
  const { data: row } = await supabase.from("debate_rooms").select("*").eq("id", roomId).maybeSingle();
  if (!row) return { room: null, lines: [] };
  const r = row as Record<string, unknown> & { id: string; host_id: string };
  const [{ data: host }, { data: parts }, { data: utt }] = await Promise.all([
    supabase.from("users").select("id, username, display_name, avatar_url").eq("id", r.host_id).maybeSingle(),
    supabase.from("debate_participants").select("user_id, role, stance, stage_role, joined_at, user:users(id, username, display_name, avatar_url)").eq("room_id", roomId).order("joined_at", { ascending: true }),
    supabase.from("debate_utterances").select("id, user_id, content, created_at, user:users(username, display_name, avatar_url)").eq("room_id", roomId).order("created_at", { ascending: true }).limit(2000),
  ]);
  const seen = new Set<string>();
  const speakers: ReplaySpeaker[] = [];
  for (const p of (parts ?? []) as unknown as { user_id: string; role: string; stance: ReplaySpeaker["side"]; stage_role: string | null; user: ReplayPerson | ReplayPerson[] | null }[]) {
    const u = one(p.user);
    if (!u || seen.has(p.user_id)) continue;
    const isHost = p.user_id === r.host_id;
    const staged = !!p.stage_role && ["host", "cohost", "speaker"].includes(p.stage_role);
    if (!isHost && p.role !== "debater" && !staged) continue;
    seen.add(p.user_id);
    speakers.push({ ...u, role: isHost ? "host" : p.stage_role === "cohost" ? "cohost" : "speaker", side: p.stance ?? null });
  }
  speakers.sort((a, b) => (a.role === "host" ? -1 : b.role === "host" ? 1 : 0));
  const startedAt = (r.recording_started_at as string | null) ?? null;
  const lines = ((utt ?? []) as unknown as { id: string; user_id: string; content: string; created_at: string; user: Partial<ReplayPerson> | Partial<ReplayPerson>[] | null }[]).map((x) => {
    const u = one(x.user);
    return {
      id: x.id,
      user_id: x.user_id,
      username: u?.username ?? "(deleted)",
      display_name: u?.display_name ?? null,
      avatar_url: u?.avatar_url ?? null,
      content: x.content,
      created_at: x.created_at,
      offset_seconds: startedAt ? Math.max(0, (new Date(x.created_at).getTime() - new Date(startedAt).getTime()) / 1000) : null,
    };
  });
  return {
    room: {
      id: r.id,
      motion: String(r.motion ?? ""),
      topic_key: (r.topic_key as string | null) ?? null,
      status: String(r.status ?? ""),
      created_at: String(r.created_at ?? ""),
      started_at: (r.started_at as string | null) ?? null,
      ended_at: (r.ended_at as string | null) ?? null,
      viewer_count: (r.viewer_count as number | null) ?? null,
      community_id: (r.community_id as string | null) ?? null,
      thumbnail_url: (r.thumbnail_url as string | null) ?? null,
      host: (host as ReplayPerson | null) ?? null,
      speakers,
      recording_url: (r.recording_url as string | null) ?? null,
      recording_started_at: startedAt,
      recording_ended_at: (r.recording_ended_at as string | null) ?? null,
      discussion_post_id: (r.discussion_post_id as string | null) ?? null,
      discussion_comment_count: 0,
      discussion_listed: false,
      discussion_community: null,
      transcript_count: lines.length,
    },
    lines,
  };
}

export async function fetchReplay(supabase: SupabaseClient, roomId: string): Promise<{ room: ReplayRoom | null; lines: TranscriptLine[] }> {
  const [{ data: replay, error: rErr }, { data: tx }, { data: polishedRow }] = await Promise.all([
    supabase.rpc("get_debate_replay", { p_room: roomId }),
    supabase.rpc("get_debate_transcript", { p_room: roomId, p_limit: 2000 }),
    supabase.from("replay_transcripts").select("status, lines").eq("room_id", roomId).maybeSingle(),
  ]);
  let room = (replay as ReplayRoom | null) ?? null;
  let lines = (tx as TranscriptLine[] | null) ?? [];
  /* The post-run transcript (full coverage, punctuation, speakers aligned)
     replaces the live lines whenever it exists; its offsets share the
     recording_started_at frame. */
  const polished = polishedRow as { status: string; lines: PolishedLine[] | null } | null;
  const hasPolished = polished?.status === "done" && Array.isArray(polished.lines) && polished.lines.length > 0;
  if (hasPolished) {
    lines = polished!.lines!.map((pl, i) => ({
      id: `pt-${i}`,
      user_id: pl.user_id,
      username: pl.username ?? "speaker",
      display_name: pl.display_name ?? (pl.username ? null : "Speaker"),
      avatar_url: pl.avatar_url,
      content: pl.text,
      created_at: "",
      offset_seconds: pl.offset_seconds,
    }));
  }
  if (rErr || !room) {
    const fb = await loadFallback(supabase, roomId);
    room = fb.room;
    if (!tx && !hasPolished) lines = fb.lines;
  }
  return { room, lines: lines.filter((l) => l && l.content) };
}

/** The thread under the replay, newest first, as the site lists it. */
export async function fetchDiscussion(supabase: SupabaseClient, postId: string): Promise<CommentRow[]> {
  const { data } = await supabase.rpc("get_post_comments", { p_post: postId, p_limit: 60, p_offset: 0 });
  return ((data as CommentRow[] | null) ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The room's discussion post, made (by the host, in the room's public community or Replays) the first time. */
export async function ensureDiscussion(supabase: SupabaseClient, roomId: string): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_debate_discussion", { p_room: roomId });
  if (error || !data) throw new Error(error?.message.includes("suspended") ? "Your account is suspended." : "Couldn't open the discussion — try again in a moment.");
  return data as string;
}

/** Is the comment thread also a post in a community, and which? */
export async function fetchDiscussionPlacement(supabase: SupabaseClient, postId: string): Promise<{ listed: boolean; community: string | null }> {
  const { data } = await supabase
    .from("community_posts")
    .select("listed, community:communities!community_id(name)")
    .eq("id", postId)
    .maybeSingle();
  const row = data as { listed?: boolean; community?: { name?: string } | { name?: string }[] | null } | null;
  const c = Array.isArray(row?.community) ? row?.community[0] : row?.community;
  return { listed: !!row?.listed, community: c?.name ?? null };
}

/** The host turns the comments into a thread in one of their communities. */
export async function publishDiscussion(supabase: SupabaseClient, roomId: string, communityId: string): Promise<string> {
  const { data, error } = await supabase.rpc("publish_debate_discussion", { p_room: roomId, p_community: communityId });
  if (error || !data) throw new Error(error?.message.replace(/^.*?:\s*/, "") || "Couldn't make the thread — try again.");
  return data as string;
}

export async function fetchLikes(supabase: SupabaseClient, roomId: string): Promise<{ count: number; liked: boolean } | null> {
  const { data } = await supabase.rpc("replay_like_state", { p_room: roomId });
  const d = data as { count?: number; liked?: boolean } | null;
  return d ? { count: Number(d.count ?? 0), liked: !!d.liked } : null;
}

export async function toggleLike(supabase: SupabaseClient, roomId: string): Promise<{ count: number; liked: boolean }> {
  const { data, error } = await supabase.rpc("toggle_replay_like", { p_room: roomId });
  if (error) throw new Error(error.message.includes("suspended") ? "Your account is suspended." : "Couldn't like it — try again.");
  const d = data as { count?: number; liked?: boolean } | null;
  return { count: Number(d?.count ?? 0), liked: !!d?.liked };
}

/** Every watch counts, as on the site; resolves to the new total. */
export async function bumpReplayView(supabase: SupabaseClient, roomId: string): Promise<number | null> {
  const { data } = await supabase.rpc("bump_replay_view", { p_room: roomId });
  return typeof data === "number" ? data : null;
}

/* Line offsets count from recording_started_at, stamped when the recorder
   was requested; the first frame lands seconds later, and a recording in
   parts skips the gaps between parts. Every segment's
   EXT-X-PROGRAM-DATE-TIME places it on the wall clock — the site's own
   timeline (src/components/agora/hlsTimeline) maps every match, seek and printed time.
   No playlist, no tags: offsets are video time. */
export async function fetchTimeline(recordingUrl: string): Promise<TimelineSpan[]> {
  try {
    const res = await fetch(recordingUrl);
    return res.ok ? parseTimeline(await res.text()) : [];
  } catch {
    return [];
  }
}

/** Recent recorded public discussions, this one's field first. */
export async function fetchMoreReplays(supabase: SupabaseClient, selfId: string, topicKey: string | null): Promise<MoreReplay[]> {
  const { data } = await supabase
    .from("debate_rooms")
    .select("id, motion, topic_key, thumbnail_url, started_at, ended_at, host:users!debate_rooms_host_id_fkey(username, display_name, avatar_url)")
    .eq("status", "ended")
    .eq("is_private", false)
    .not("recording_url", "is", null)
    .neq("id", selfId)
    .order("ended_at", { ascending: false })
    .limit(12);
  const rows = ((data ?? []) as unknown as (MoreReplay & { host: MoreReplay["host"] | MoreReplay["host"][] })[]).map((r) => ({ ...r, host: one(r.host) }));
  rows.sort((a, b) => Number(b.topic_key === topicKey) - Number(a.topic_key === topicKey));
  return rows.slice(0, 6);
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function fmtDurationLong(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
