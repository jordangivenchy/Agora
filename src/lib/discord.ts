/* Discord, for the beta server. Three channels hear from the app:

     #live-now          a public room goes live       DISCORD_WEBHOOK_LIVE
     #past-discussions  a recording is ready          DISCORD_WEBHOOK_RECORDINGS
     #announcements     a moderator features a post   DISCORD_WEBHOOK_ANNOUNCEMENTS

   Each variable holds a Discord webhook URL (channel → Edit channel →
   Integrations → Webhooks → New webhook → Copy webhook URL). One that is
   missing falls back to DISCORD_WEBHOOK_URL, so a single channel can
   take everything. Nothing set → nothing posts, and /api/health says so.

   The database raises the events (trigger → pg_net → /api/internal/
   discord, migration 20260905); the route re-reads the row and hands it
   to the builders below. The builders are pure so they can be tested;
   postDiscord never throws — Discord being down must never fail the
   caller. Server-only: the webhook URLs are secrets.

   Every message is one embed, in the shape of a good status card: the
   title is the link, the body opens with what to do, then the facts in
   bold with tree sub-lines and Discord's own time chips (<t:…>), then
   an italic note; the footer carries the standing caveat and the brand. */

import { displayName } from "@/lib/names";
import { pathFor } from "@/lib/routes";
import { replayPath, roomPath, userPath } from "@/lib/urls";

export type DiscordChannel = "live" | "recordings" | "announcements";

const ENV: Record<DiscordChannel, string> = {
  live: "DISCORD_WEBHOOK_LIVE",
  recordings: "DISCORD_WEBHOOK_RECORDINGS",
  announcements: "DISCORD_WEBHOOK_ANNOUNCEMENTS",
};

const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/** The webhook for a channel, or null when neither it nor the shared fallback is set. */
export function discordWebhook(channel: DiscordChannel): string | null {
  const url = (process.env[ENV[channel]] || process.env.DISCORD_WEBHOOK_URL || "").trim();
  return WEBHOOK_RE.test(url) ? url : null;
}

export function discordConfigured(): boolean {
  return (Object.keys(ENV) as DiscordChannel[]).some((c) => discordWebhook(c) !== null);
}

/* ── Messages ─────────────────────────────────────────────────────── */

export const DISCORD_YELLOW = 0xffb700;
export const DISCORD_BLUE = 0x2f7fe0;

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  footer?: { text: string; icon_url?: string };
}

export interface DiscordMessage {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: { parse: string[] };
}

export interface DiscordRoom {
  id: string;
  motion: string | null;
  status: string | null;
  is_private?: boolean | null;
  started_at?: string | null;
  ended_at?: string | null;
  recording_url?: string | null;
  recording_ended_at?: string | null;
  pro_size?: number | null;
  con_size?: number | null;
}

export interface DiscordUser {
  username: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
}

export interface DiscordPost {
  id: string;
  title: string | null;
  body: string | null;
  featured_at?: string | null;
}

const BRAND = "AgoraSphere beta";
const TREE = " └ · ";

/** Discord renders markdown in descriptions; user text must not. */
export function escapeMd(s: string): string {
  return s.replace(/([\\*_~`|>#[\]()-])/g, "\\$1");
}

/** Markdown → plain text, for excerpts. */
export function plainText(md: string | null | undefined): string {
  return (md ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/^[ \t]*\d+\.[ \t]+/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** At most `max` characters, cut on a word where one is near, with an ellipsis. */
export function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  const cut = head.lastIndexOf(" ");
  return (cut > max * 0.6 ? head.slice(0, cut) : head).trimEnd() + "…";
}

/** Discord's time chip: t = 3:12 PM, f = 11 September 2026 15:12, R = 7 days ago. Viewer's own zone. */
export function timeChip(iso: string | null | undefined, style: "t" | "f" | "R"): string | null {
  const s = Math.floor(Date.parse(iso ?? "") / 1000);
  return Number.isFinite(s) ? `<t:${s}:${style}>` : null;
}

function person(u: DiscordUser | null | undefined, origin: string): string {
  const name = escapeMd(displayName(u) || "someone");
  return u?.username ? `[${name}](${origin}${userPath(u.username)})` : name;
}

/** "3 min", "1 h 12 min", "45 s" — null unless both ends are known. */
function runLabel(startedAt: string | null | undefined, endedAt: string | null | undefined): string | null {
  if (!startedAt || !endedAt) return null;
  const s = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(s) || s <= 0) return null;
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

function card(origin: string, embed: DiscordEmbed & { note: string; lines: Array<string | null> }): DiscordMessage {
  const { note, lines, ...rest } = embed;
  return {
    username: "AgoraSphere",
    avatar_url: `${origin}/mark-512.png`,
    embeds: [
      {
        ...rest,
        description: lines.filter((l) => l !== null).join("\n"),
        footer: { text: `${note} • ${BRAND}` },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

function motionOf(room: DiscordRoom): string {
  return clip(plainText(room.motion) || "Untitled room", 200);
}

function isDuel(room: DiscordRoom): boolean {
  return (room.pro_size ?? 10) === 1 && (room.con_size ?? 10) === 1;
}

export function roomLiveMessage(
  room: DiscordRoom,
  host: DiscordUser | null,
  community: { name: string | null } | null,
  origin: string
): DiscordMessage {
  const url = `${origin}${roomPath(room)}`;
  const at = timeChip(room.started_at, "t");
  const ago = timeChip(room.started_at, "R");
  return card(origin, {
    title: motionOf(room),
    url,
    color: DISCORD_YELLOW,
    lines: [
      `Tap the title or **[Join the room](${url})** to take a seat in the audience.`,
      "",
      at ? `**Live** since ${at} (${ago})` : "**Live** now",
      `${TREE}Host: **${person(host, origin)}**`,
      community?.name ? `${TREE}Community: **${escapeMd(community.name)}**` : null,
      isDuel(room) ? `${TREE}**1 v 1**, matched from the queue` : null,
      "",
      "*Raise a hand in the room if you want the floor.*",
    ],
    note: "Public rooms only, the moment they open",
  });
}

export function recordingReadyMessage(
  room: DiscordRoom,
  host: DiscordUser | null,
  community: { name: string | null } | null,
  origin: string
): DiscordMessage {
  const url = `${origin}${replayPath(room)}`;
  const run = runLabel(room.started_at, room.ended_at);
  const ago = timeChip(room.recording_ended_at ?? room.ended_at, "R");
  const when = timeChip(room.started_at, "f");
  return card(origin, {
    title: motionOf(room),
    url,
    color: DISCORD_BLUE,
    lines: [
      `Tap the title or **[Open the past discussion](${url})** to watch it back.`,
      "",
      `**Recorded**${ago ? ` ${ago}` : ""}${run ? ` · \`${run}\`` : ""}`,
      `${TREE}Host: **${person(host, origin)}**`,
      community?.name ? `${TREE}Community: **${escapeMd(community.name)}**` : null,
      when ? `${TREE}Held ${when}` : null,
      "",
      "*Comments are open under the recording.*",
    ],
    note: "Recordings land here as they finish",
  });
}

export function featuredPostMessage(
  post: DiscordPost,
  author: DiscordUser | null,
  origin: string
): DiscordMessage {
  const url = `${origin}${pathFor.post(post.id)}`;
  const excerpt = clip(plainText(post.body), 600);
  const ago = timeChip(post.featured_at, "R");
  return card(origin, {
    title: clip(plainText(post.title) || "A post from the team", 200),
    url,
    color: DISCORD_YELLOW,
    lines: [
      `Tap the title or **[Read the post](${url})** for the whole thing.`,
      "",
      excerpt ? escapeMd(excerpt).split("\n").map((l) => `> ${l}`).join("\n") : null,
      excerpt ? "" : null,
      `**Featured**${ago ? ` ${ago}` : ""} · by **${person(author, origin)}**`,
      "*On the home page for the next two weeks.*",
    ],
    note: "Featured on the home page by the team",
  });
}

/* ── Delivery ─────────────────────────────────────────────────────── */

/** Posts one message; true when Discord accepted it. Retries a rate limit once. Never throws. */
export async function postDiscord(url: string, message: DiscordMessage): Promise<boolean> {
  const body = JSON.stringify({ ...message, allowed_mentions: { parse: [] } });
  const target = `${url}${url.includes("?") ? "&" : "?"}wait=true`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return true;
      if (res.status === 429 && attempt === 0) {
        const j = (await res.json().catch(() => null)) as { retry_after?: number } | null;
        const wait = Math.min(5000, Math.max(500, Number(j?.retry_after ?? 1) * 1000));
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      console.error("[discord] webhook refused", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return false;
    } catch (e) {
      console.error("[discord] webhook failed", e instanceof Error ? e.message : e);
      return false;
    }
  }
  return false;
}
