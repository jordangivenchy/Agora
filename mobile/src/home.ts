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
    .eq("listed", true)
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
/* One side's speaker, with the colour the hero draws their initial on. */
export interface HeroSpeaker { name: string; color: string; open: boolean }

export interface HeroRoom {
  id: string;
  motion: string;
  topicKey: string;
  /* The room's other topics (the database's keys). */
  secondaryTopics: string[];
  /* "Open", "Oxford", "1v1" or "Panel". */
  format: string;
  /* Two letters: "EN". */
  language: string;
  /* The community hosting the room, when one is. */
  community: { name: string; color: string | null } | null;
  /* For and against, as the site's panel lists them: the first always
     (an open seat when nobody holds it), the second when taken. */
  speakers: HeroSpeaker[];
  viewers: number;
  speakerCount: number;
  audience: number;
  host: Person | null;
  imageUrl: string | null;
  liveSince: string | null;
}

type HeroRoomRow = {
  id: string;
  motion: string;
  topic_key: string;
  secondary_topics: string[] | null;
  format: string | null;
  language: string | null;
  community_id: string | null;
  viewer_count: number | null;
  thumbnail_url: string | null;
  started_at: string | null;
  created_at: string | null;
  host: Person | Person[] | null;
  participants: { role: string; left_at: string | null; stance: string | null; user: Person | Person[] | null }[] | null;
};

/* The site's colours for the speakers' initials (lib/homeData.ts). */
const SPEAKER_PALETTE = ["#00b894", "#e17055", "#e2b96b", "#fd79a8", "#4a9eff", "#00cec9", "#64B5F6", "#1976D2"];
const FORMAT_LABEL: Record<string, string> = { open: "Open", oxford: "Oxford", "1v1": "1v1", panel: "Panel" };
const safeColor = (c: string | null | undefined) => (c && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : null);

export async function fetchHeroRooms(supabase: SupabaseClient): Promise<HeroRoom[]> {
  const { data } = await supabase
    .from("debate_rooms")
    .select("id, motion, topic_key, secondary_topics, format, language, community_id, viewer_count, thumbnail_url, started_at, created_at, host:users!host_id(id, username, display_name, avatar_url), participants:debate_participants(role, left_at, stance, user:users(username, display_name, avatar_url))")
    .eq("status", "live")
    .order("viewer_count", { ascending: false, nullsFirst: false })
    .limit(4);
  const rows = (data ?? []) as unknown as HeroRoomRow[];
  /* A community-hosted room goes under the community's name, as on the site. */
  const communities = new Map<string, { name: string; color: string | null }>();
  const ids = [...new Set(rows.map((r) => r.community_id).filter(Boolean))] as string[];
  if (ids.length) {
    const { data: comms } = await supabase.from("communities").select("id, name, color").in("id", ids);
    for (const c of (comms ?? []) as { id: string; name: string; color: string | null }[]) communities.set(c.id, { name: c.name, color: safeColor(c.color) });
  }
  return rows.map((r, i) => {
    const host = one(r.host);
    const active = (r.participants ?? []).filter((p) => !p.left_at);
    const debaters = active.filter((p) => p.role === "debater");
    const side = (stance: string) => one(debaters.find((p) => p.stance === stance)?.user ?? null);
    const pro = side("PRO");
    const con = side("CON");
    const speakers: HeroSpeaker[] = [{ name: pro ? personName(pro) : "Open seat", color: SPEAKER_PALETTE[i % SPEAKER_PALETTE.length], open: !pro }];
    if (con) speakers.push({ name: personName(con), color: SPEAKER_PALETTE[(i + 3) % SPEAKER_PALETTE.length], open: false });
    const pick = r.thumbnail_url || host?.avatar_url || null;
    return {
      id: r.id,
      motion: r.motion,
      topicKey: r.topic_key,
      secondaryTopics: r.secondary_topics ?? [],
      format: FORMAT_LABEL[r.format ?? ""] ?? "Open",
      language: (r.language ?? "EN").toUpperCase().slice(0, 2),
      community: r.community_id ? communities.get(r.community_id) ?? null : null,
      speakers,
      viewers: r.viewer_count ?? 0,
      speakerCount: debaters.length,
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
