/* The home screen's data, read the way the website reads it: the news
   from the site's /api/news (cached there), the featured posts and the
   rooms straight from the tables under the viewer's own row security,
   and the standing questions from the same RPC (lib/homeData.ts and
   components/TopicsHome.tsx on the web). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiFetch, type ApiAuth } from "./api";

/* ── News ── */
export interface NewsSource { name: string; domain: string }
export interface NewsStory {
  id: string;
  headline: string;
  url: string | null;
  publishedAt: string | null;
  sources: NewsSource[];
  imageUrl?: string | null;
  summary?: string | null;
  category?: string | null;
  major?: boolean;
}

export async function fetchNews(auth: ApiAuth): Promise<NewsStory[]> {
  const res = await apiFetch("/api/news", auth).catch(() => null);
  if (!res || !res.ok) return [];
  const body = (await res.json().catch(() => null)) as { stories?: NewsStory[] } | null;
  return Array.isArray(body?.stories) ? body.stories.filter((s) => s && s.headline) : [];
}

/* ── People and rooms, as the joins return them ── */
export interface Person { id?: string; username: string | null; display_name: string | null; avatar_url: string | null }
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export function personName(p: Person | null): string {
  return p?.display_name?.trim() || (p?.username ? `@${p.username}` : "Someone");
}

/* ── Featured posts: the ones a moderator put on the home page ── */
const FEATURED_DAYS = 14;
const HERO_POSTS = 3;

export type NoticeItem = { lead: string; detail: string };
export type NoticeHighlights = { heading: string | null; items: NoticeItem[] };

export interface FeaturedPost {
  id: string;
  title: string;
  excerpt: string;
  /* The post's first list — its heading, each item's lead and detail
     ("Live rooms" — "Start one from the + button…") — when it has two or more. */
  highlights: NoticeHighlights | null;
  createdAt: string;
  community: { name: string; color: string | null } | null;
  comments: number;
  imageUrl: string | null;
}

type PostRow = {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  created_at: string;
  community: { name: string; color: string | null } | { name: string; color: string | null }[] | null;
  comments: { count: number }[] | null;
};

/* Markdown as plain text: marks, images and bare links dropped. */
function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).trimEnd() + "…";
}
/* The notice's copy, as the site reads it (lib/homeData.ts noticeCopy):
   the opening paragraph (the first block that is neither a heading nor a
   list), and when the post goes on to a list, that list's heading and
   each item's lead with the rest of the item as its detail. Items written
   with a blank line between them count as one list. */
function postCopy(md: string): { excerpt: string; highlights: NoticeHighlights | null } {
  const blocks = md.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const isItem = (line: string) => /^([-*+]|\d+\.)\s+/.test(line);
  const isList = (b: string) => b.split("\n").map((l) => l.trim()).filter(Boolean).every(isItem);
  const isHeading = (b: string) => /^#{1,6}\s/.test(b) || (!b.includes("\n") && b.length <= 60 && !/[.!?]$/.test(b));
  const opening = blocks.find((b) => !isList(b) && !isHeading(b)) ?? blocks[0] ?? "";
  const raw: string[] = [];
  let heading: string | null = null;
  for (let i = 0; i < blocks.length; i++) {
    if (isList(blocks[i])) {
      if (!raw.length && i > 0 && isHeading(blocks[i - 1])) heading = plain(blocks[i - 1]);
      for (const line of blocks[i].split("\n")) {
        const t = line.trim();
        if (isItem(t)) raw.push(t.replace(/^([-*+]|\d+\.)\s+/, ""));
      }
    } else if (raw.length) break;
  }
  const items = raw
    .map((t): NoticeItem => {
      const text = plain(t);
      const m = /[.!?:]\s|\s[—–-]\s/.exec(text);
      const lead = (m ? text.slice(0, m.index) : text).replace(/[.:!?]+$/, "").trim();
      const detail = m ? text.slice(m.index + m[0].length).trim() : "";
      return { lead: lead.length > 40 ? lead.slice(0, 39).trimEnd() + "…" : lead, detail: cutAtWord(detail, 110) };
    })
    .filter((it) => it.lead)
    .slice(0, 5);
  return { excerpt: cutAtWord(plain(opening), 320), highlights: items.length >= 2 ? { heading, items } : null };
}

export async function fetchFeatured(supabase: SupabaseClient): Promise<FeaturedPost[]> {
  const since = new Date(Date.now() - FEATURED_DAYS * 86400000).toISOString();
  const { data } = await supabase
    .from("community_posts")
    .select("id, title, body, image_url, created_at, community:communities!community_id(name, color), comments:community_comments(count)")
    .not("featured_at", "is", null)
    .gte("featured_at", since)
    .or("is_repost.is.null,is_repost.eq.false")
    .order("featured_at", { ascending: false })
    .limit(HERO_POSTS);
  return ((data ?? []) as unknown as PostRow[]).map((p) => {
    const copy = postCopy(p.body ?? "");
    return {
      id: p.id,
      title: p.title,
      excerpt: copy.excerpt,
      highlights: copy.highlights,
      createdAt: p.created_at,
      community: one(p.community),
      comments: p.comments?.[0]?.count ?? 0,
      imageUrl: p.image_url && /^https:\/\//.test(p.image_url) ? p.image_url : null,
    };
  });
}

/* ── The hero's rooms: live ones, the most watched first ── */
export interface HeroRoom {
  id: string;
  motion: string;
  topicKey: string;
  viewers: number;
  speakers: number;
  audience: number;
  host: Person | null;
  imageUrl: string | null;
  liveSince: string | null;
}

type HeroRoomRow = {
  id: string;
  motion: string;
  topic_key: string;
  viewer_count: number | null;
  thumbnail_url: string | null;
  started_at: string | null;
  created_at: string | null;
  host: Person | Person[] | null;
  participants: { role: string; left_at: string | null }[] | null;
};

export async function fetchHeroRooms(supabase: SupabaseClient): Promise<HeroRoom[]> {
  const { data } = await supabase
    .from("debate_rooms")
    .select("id, motion, topic_key, viewer_count, thumbnail_url, started_at, created_at, host:users!host_id(id, username, display_name, avatar_url), participants:debate_participants(role, left_at)")
    .eq("status", "live")
    .order("viewer_count", { ascending: false, nullsFirst: false })
    .limit(4);
  return ((data ?? []) as unknown as HeroRoomRow[]).map((r) => {
    const host = one(r.host);
    const active = (r.participants ?? []).filter((p) => !p.left_at);
    const pick = r.thumbnail_url || host?.avatar_url || null;
    return {
      id: r.id,
      motion: r.motion,
      topicKey: r.topic_key,
      viewers: r.viewer_count ?? 0,
      speakers: active.filter((p) => p.role === "debater").length,
      audience: active.filter((p) => p.role === "spectator").length,
      host,
      imageUrl: pick && /^https:\/\//.test(pick) ? pick : null,
      liveSince: r.started_at ?? r.created_at ?? null,
    };
  });
}

/* ── The board under "Browse": rooms by field, and the standing questions ── */
export interface TopicRow {
  id: string;
  question: string;
  topic_key: string;
  queue_count: number;
  pro_count: number;
  con_count: number;
  am_queued: boolean;
  my_stance: "PRO" | "CON" | null;
}

export interface BoardRoom {
  id: string;
  motion: string;
  topic_key: string;
  status: string;
  format: string;
  scheduled_start: string | null;
  created_at: string;
  viewer_count: number | null;
  thumbnail_url: string | null;
  is_private?: boolean | null;
  host: Person | Person[] | null;
  community: { id: string; name: string; color: string | null } | { id: string; name: string; color: string | null }[] | null;
}

export const isScheduled = (r: { status: string; scheduled_start: string | null }) =>
  r.status !== "live" && !!r.scheduled_start;

export async function fetchBoard(supabase: SupabaseClient): Promise<{ topics: TopicRow[]; rooms: BoardRoom[] }> {
  const [t, r] = await Promise.all([
    supabase.rpc("get_debate_topics"),
    supabase
      .from("debate_rooms")
      .select("id, motion, topic_key, status, format, scheduled_start, created_at, viewer_count, thumbnail_url, is_private, host:users!host_id(id, username, display_name, avatar_url), community:communities!community_id(id, name, color)")
      .in("status", ["live", "created", "scheduled"])
      /* Queue-matched duels (1/1 seats) are pairings, not shows. */
      .or("pro_size.neq.1,con_size.neq.1")
      .order("created_at", { ascending: false })
      .limit(80),
  ]);
  return {
    topics: t.error ? [] : ((t.data ?? []) as TopicRow[]),
    rooms: r.error ? [] : ((r.data ?? []) as unknown as BoardRoom[]),
  };
}

export function roomHost(r: BoardRoom): Person | null {
  return one(r.host);
}
export function roomCommunity(r: BoardRoom): { id: string; name: string; color: string | null } | null {
  return one(r.community);
}

/* The daily rotation: how long until the next set of questions. */
export function msToUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, next - now.getTime());
}
export function fmtRotate(ms: number): string {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}
