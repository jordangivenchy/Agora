/* The home page's first view: the hero's rooms — the busiest live ones,
   shaped for the carousel — the featured posts for its post slides, and
   the signed-in user for the navbar. The route (app/page.tsx) fetches
   it on the server so the page arrives complete; the page refreshes it
   in the browser on realtime changes and every 30s with the same
   functions. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { HeroPost, HeroRoom } from "@/components/HeroCarousel";
import { displayName } from "@/lib/names";

export type HomeNavUser = { id: string; name: string; username: string | null; avatarUrl: string | null };

export type HomeInitial = {
  heroRooms: HeroRoom[];
  featured: HeroPost[];
  navUser: HomeNavUser | null;
};

/* The featured posts: the ones a site moderator put on the home page
   ("Feature on home" in a post's menu, any board), newest first, from
   the last fortnight, reposts left out. Row security keeps a private
   board's post to its members. */
const FEATURED_DAYS = 14;
const HERO_POSTS = 3;

/* A colour that lands in a CSS variable, so only a strict hex value may
   pass (the DB also constrains the format). */
const safeColor = (c: string | null | undefined) => (c && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : null);

/* The shell's topic keys (the database's `ethics` is `politics-ethics`). */
const TOPIC_MAP: Record<string, string> = {
  "politics-law": "politics-law",
  ethics: "politics-ethics",
  sports: "sports",
  culture: "culture",
  economics: "economics",
  "science-tech": "science-tech",
  "foreign-policy": "foreign-policy",
  philosophy: "philosophy",
};

const GRADIENTS = [
  "linear-gradient(135deg, #0d1b3e 0%, #1e0533 100%)",
  "linear-gradient(135deg, #1a1000 0%, #002d3d 100%)",
  "linear-gradient(135deg, #0d2b1a 0%, #2d1a00 100%)",
  "linear-gradient(135deg, #001a2e 0%, #002214 100%)",
  "linear-gradient(135deg, #2d0a1a 0%, #1a1500 100%)",
  "linear-gradient(135deg, #0d0a2e 0%, #2e0d0d 100%)",
  "linear-gradient(135deg, #001e2e 0%, #0d001a 100%)",
  "linear-gradient(135deg, #001a3d 0%, #1a001a 100%)",
];

const PALETTE = ["#00b894", "#e17055", "#e2b96b", "#fd79a8", "#4a9eff", "#00cec9", "#64B5F6", "#1976D2"];

const FORMAT_LABEL: Record<string, string> = {
  open: "Open",
  oxford: "Oxford",
  "1v1": "1v1",
  panel: "Panel",
};

type Participant = { left_at: string | null; role: string; stance: string | null; user: { username?: string | null; display_name?: string | null } | null };
type RoomRow = {
  id: string;
  motion: string;
  status: string;
  topic_key: string;
  secondary_topics: string[] | null;
  format: string;
  language: string | null;
  community_id: string | null;
  thumbnail_url: string | null;
  viewer_count: number | null;
  started_at: string | null;
  created_at: string | null;
  host: { avatar_url?: string | null } | { avatar_url?: string | null }[] | null;
  participants: Participant[] | null;
};

/* The hero features live rooms only, ranked by viewers — its slide says
   "Watch Live", so anything else up there would lie. Colours and
   gradients are keyed to the room's place in the list, as the viewer
   sees it (row security applies). */
export async function fetchHeroRooms(supabase: SupabaseClient): Promise<HeroRoom[]> {
  const { data: roomsData } = await supabase
    .from("debate_rooms")
    .select(`*, host:users!host_id(avatar_url), participants:debate_participants(*, user:users(username, display_name, avatar_url))`)
    .in("status", ["live", "created", "scheduled"])
    .order("created_at", { ascending: false })
    .limit(100);
  const rooms = (roomsData ?? []) as unknown as RoomRow[];

  /* Community-hosted rooms are presented under the community's name. */
  const communityById = new Map<string, { name: string; color: string | null }>();
  const communityIds = [...new Set(rooms.map((r) => r.community_id).filter(Boolean))] as string[];
  if (communityIds.length) {
    const { data: comms } = await supabase.from("communities").select("id, name, color").in("id", communityIds);
    for (const c of (comms ?? []) as { id: string; name: string; color: string | null }[]) {
      communityById.set(c.id, { name: c.name, color: safeColor(c.color) });
    }
  }

  return rooms
    .map((room, i) => ({ room, i }))
    .filter(({ room }) => room.status === "live")
    .sort((a, b) => (b.room.viewer_count ?? 0) - (a.room.viewer_count ?? 0))
    .slice(0, 4)
    .map(({ room, i }) => {
      const active = (room.participants ?? []).filter((p) => !p.left_at);
      const debaters = active.filter((p) => p.role === "debater");
      const audienceCount = active.filter((p) => p.role === "spectator").length;
      const proD = debaters.find((p) => p.stance === "PRO");
      const conD = debaters.find((p) => p.stance === "CON");
      const hostAvatar = Array.isArray(room.host) ? room.host[0]?.avatar_url : room.host?.avatar_url;
      // Same fallback as the room cards: uploaded thumbnail, else the host's avatar.
      const pick = room.thumbnail_url || hostAvatar || null;
      return {
        roomId: room.id,
        motion: room.motion,
        // "Open seat" rather than an empty string: the panel shows its initial.
        debater1: proD?.user ? displayName(proD.user) : "Open seat",
        debater2: conD?.user ? displayName(conD.user) : "Open seat",
        color1: PALETTE[i % PALETTE.length],
        color2: PALETTE[(i + 3) % PALETTE.length],
        gradient: GRADIENTS[i % GRADIENTS.length],
        thumbnailUrl: typeof pick === "string" && /^https:\/\//.test(pick) ? pick : null,
        topicKey: TOPIC_MAP[room.topic_key] ?? "culture",
        secondaryTopics: (room.secondary_topics ?? []).map((k) => TOPIC_MAP[k] ?? k),
        format: FORMAT_LABEL[room.format] ?? "Open",
        language: (room.language ?? "EN").toUpperCase().slice(0, 2),
        community: room.community_id ? (communityById.get(room.community_id)?.name ?? null) : null,
        communityColor: room.community_id ? (communityById.get(room.community_id)?.color ?? null) : null,
        liveSince: room.started_at ?? room.created_at ?? null,
        speakerCount: debaters.length,
        audienceCount,
        viewersNum: room.viewer_count ?? 0,
      };
    });
}

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

/* The notice's copy from a post: its opening paragraph (the first block
   that is neither a heading nor a list); when the post goes on to a
   list, that list's heading and each item's lead with the rest of the
   item as its detail; and the paragraph after the list with its heading,
   if there is one. Lists written with a blank line between items count
   as one list. */
export type NoticeItem = { lead: string; detail: string };
export type NoticeHighlights = { heading: string | null; items: NoticeItem[] };
export type NoticeMore = { heading: string | null; text: string };
function noticeCopy(md: string): { excerpt: string; highlights: NoticeHighlights | null; more: NoticeMore | null } {
  const blocks = md.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const isItem = (line: string) => /^([-*+]|\d+\.)\s+/.test(line);
  const isList = (b: string) => b.split("\n").map((l) => l.trim()).filter(Boolean).every(isItem);
  const isHeading = (b: string) => /^#{1,6}\s/.test(b) || (!b.includes("\n") && b.length <= 60 && !/[.!?]$/.test(b));
  const opening = blocks.find((b) => !isList(b) && !isHeading(b)) ?? blocks[0] ?? "";
  const raw: string[] = [];
  let heading: string | null = null;
  let after = -1;
  for (let i = 0; i < blocks.length; i++) {
    if (isList(blocks[i])) {
      if (!raw.length && i > 0 && isHeading(blocks[i - 1])) heading = plain(blocks[i - 1]);
      for (const line of blocks[i].split("\n")) {
        const t = line.trim();
        if (isItem(t)) raw.push(t.replace(/^([-*+]|\d+\.)\s+/, ""));
      }
      after = i + 1;
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
  let more: NoticeMore | null = null;
  if (after > 0) {
    for (let i = after; i < blocks.length; i++) {
      if (isList(blocks[i]) || isHeading(blocks[i])) continue;
      const h = i > after && isHeading(blocks[i - 1]) ? plain(blocks[i - 1]) : null;
      more = { heading: h, text: cutAtWord(plain(blocks[i]), 220) };
      break;
    }
  }
  return { excerpt: cutAtWord(plain(opening), 320), highlights: items.length >= 2 ? { heading, items } : null, more };
}

type Person = { username: string | null; display_name: string | null; avatar_url: string | null };
type Board = { name: string; color: string | null };
type DevPostRow = {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  created_at: string;
  author: Person | Person[] | null;
  community: Board | Board[] | null;
  comments: { count: number }[] | null;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export async function fetchFeatured(supabase: SupabaseClient): Promise<HeroPost[]> {
  const since = new Date(Date.now() - FEATURED_DAYS * 86400000).toISOString();
  const { data } = await supabase
    .from("community_posts")
    .select("id, title, body, image_url, created_at, author:users!author_id(username, display_name, avatar_url), community:communities!community_id(name, color), comments:community_comments(count)")
    .not("featured_at", "is", null)
    .gte("featured_at", since)
    .or("is_repost.is.null,is_repost.eq.false")
    .order("featured_at", { ascending: false })
    .limit(HERO_POSTS);
  return ((data ?? []) as unknown as DevPostRow[]).map((p) => {
    const a = one(p.author);
    const b = one(p.community);
    const copy = noticeCopy(p.body ?? "");
    return {
      id: p.id,
      title: p.title,
      excerpt: copy.excerpt,
      highlights: copy.highlights,
      more: copy.more,
      imageUrl: typeof p.image_url === "string" && /^https:\/\//.test(p.image_url) ? p.image_url : null,
      createdAt: p.created_at,
      author: a?.username ?? "agorasphere",
      authorName: a ? displayName(a) : "AgoraSphere",
      authorAvatar: typeof a?.avatar_url === "string" && /^https:\/\//.test(a.avatar_url) ? a.avatar_url : null,
      board: b?.name ?? "Agora",
      boardColor: safeColor(b?.color),
      commentCount: p.comments?.[0]?.count ?? 0,
    };
  });
}

/* The navbar's user: the profile row's name and avatar, with the
   account's own name or email as the fallback. */
export async function fetchNavUser(
  supabase: SupabaseClient,
  viewer: { id: string; name?: string | null; email?: string | null } | null,
): Promise<HomeNavUser | null> {
  if (!viewer) return null;
  const { data: me } = await supabase
    .from("users")
    .select("username, display_name, avatar_url")
    .eq("id", viewer.id)
    .maybeSingle();
  const row = me as { username?: string | null; display_name?: string | null; avatar_url?: string | null } | null;
  return {
    id: viewer.id,
    name: (row ? displayName(row) : null) || viewer.name || viewer.email || "U",
    username: row?.username ?? null,
    avatarUrl: row?.avatar_url ?? null,
  };
}

/* Everything the route needs, as the viewer (the session's verified
   claims — no auth round trip). */
export async function fetchHomeInitial(supabase: SupabaseClient): Promise<HomeInitial> {
  const [{ data: claims }, heroRooms, featured] = await Promise.all([supabase.auth.getClaims(), fetchHeroRooms(supabase), fetchFeatured(supabase)]);
  const c = claims?.claims;
  const viewer = c?.sub
    ? { id: c.sub, name: (c.user_metadata as { name?: string } | undefined)?.name ?? null, email: c.email ?? null }
    : null;
  const navUser = await fetchNavUser(supabase, viewer);
  return { heroRooms, featured, navUser };
}
