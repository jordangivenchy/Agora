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
   caller. Server-only: the webhook URLs are secrets. */

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
  timestamp?: string;
  footer?: { text: string; icon_url?: string };
  thumbnail?: { url: string };
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

const FOOTER = "AgoraSphere beta";

/** Discord renders markdown in content and descriptions; user text must not. */
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

function httpsUrl(u: string | null | undefined): string | undefined {
  return u && /^https:\/\//.test(u) ? u : undefined;
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

function brand(origin: string, embed: DiscordEmbed, content: string): DiscordMessage {
  return {
    content: clip(content, 300),
    username: "AgoraSphere",
    avatar_url: `${origin}/mark-512.png`,
    embeds: [{ footer: { text: FOOTER }, ...embed }],
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
  const where = community?.name ? ` in **${escapeMd(community.name)}**` : "";
  const how = isDuel(room) ? " · matched from the queue" : "";
  return brand(
    origin,
    {
      description: `Hosted by ${person(host, origin)}${where}${how}\n**[Join the room](${origin}${roomPath(room)})**`,
      color: DISCORD_YELLOW,
      timestamp: room.started_at ?? new Date().toISOString(),
      thumbnail: host?.avatar_url ? { url: httpsUrl(host.avatar_url) ?? "" } : undefined,
    },
    `🔴 **Live now:** ${escapeMd(motionOf(room))}`
  );
}

export function recordingReadyMessage(
  room: DiscordRoom,
  host: DiscordUser | null,
  community: { name: string | null } | null,
  origin: string
): DiscordMessage {
  const where = community?.name ? ` in **${escapeMd(community.name)}**` : "";
  const run = runLabel(room.started_at, room.ended_at);
  return brand(
    origin,
    {
      description: `Hosted by ${person(host, origin)}${where}${run ? ` · ${run}` : ""}\n**[Open the past discussion](${origin}${replayPath(room)})**`,
      color: DISCORD_BLUE,
      timestamp: room.recording_ended_at ?? room.ended_at ?? new Date().toISOString(),
      thumbnail: host?.avatar_url ? { url: httpsUrl(host.avatar_url) ?? "" } : undefined,
    },
    `🎧 **Past discussion:** ${escapeMd(motionOf(room))}`
  );
}

export function featuredPostMessage(
  post: DiscordPost,
  author: DiscordUser | null,
  origin: string
): DiscordMessage {
  const title = clip(plainText(post.title) || "A post from the team", 200);
  const excerpt = clip(plainText(post.body), 600);
  const url = `${origin}${pathFor.post(post.id)}`;
  return brand(
    origin,
    {
      title: title,
      url,
      description: `${excerpt ? `${escapeMd(excerpt)}\n\n` : ""}Posted by ${person(author, origin)} · **[Read the post](${url})**`,
      color: DISCORD_YELLOW,
      timestamp: post.featured_at ?? new Date().toISOString(),
      footer: { text: `${FOOTER} · featured on the home page` },
    },
    `📣 **From the AgoraSphere team:** ${escapeMd(title)}`
  );
}

/* ── Delivery ─────────────────────────────────────────────────────── */

/** Posts one message; true when Discord accepted it. Retries a rate limit once. Never throws. */
export async function postDiscord(url: string, message: DiscordMessage): Promise<boolean> {
  const embeds = message.embeds?.map((e) => {
    const copy = { ...e };
    if (!copy.thumbnail?.url) delete copy.thumbnail;
    return copy;
  });
  const body = JSON.stringify({ ...message, embeds, allowed_mentions: { parse: [] } });
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
