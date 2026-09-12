/* Discord, for the beta server. Three channels hear from the app:

     #live-now          one card per public room, edited as it goes:
                        scheduled → live → ended → recorded    DISCORD_WEBHOOK_LIVE
     #past-discussions  a recording is ready                   DISCORD_WEBHOOK_RECORDINGS
     #announcements     a moderator features a post, and
                        every production deploy                 DISCORD_WEBHOOK_ANNOUNCEMENTS

   Each variable holds a Discord webhook URL (channel → Edit channel →
   Integrations → Webhooks → New webhook → Copy webhook URL). One that is
   missing falls back to DISCORD_WEBHOOK_URL, so a single channel can
   take everything. Nothing set → nothing posts, and /api/health says so.

   The database raises the room and post events (trigger → pg_net →
   /api/internal/discord, migrations 20260905 and 20260906); the route
   re-reads the row and hands it to the builders below. Vercel raises
   deploys (/api/webhook/vercel); a cron writes the morning digest
   (/api/cron/discord-digest); the beta key is answered to a button or
   /beta (/api/webhook/discord). The builders are pure so they can be
   tested; postDiscord and editDiscord never throw — Discord being down
   must never fail the caller. Server-only: the webhook URLs are secrets.

   Every message is one embed, in the shape of a good status card: the
   title is the link, the body opens with what to do, then the facts in
   bold with tree sub-lines and Discord's own time chips (<t:…>), then
   an italic note; the black tile top right; the footer carries the
   standing caveat and the brand. */

import { displayName } from "@/lib/names";
import { pathFor } from "@/lib/routes";
import { replayPath, roomPath, userPath } from "@/lib/urls";

export type DiscordChannel = "live" | "recordings" | "announcements" | "team";

const ENV: Record<DiscordChannel, string> = {
  live: "DISCORD_WEBHOOK_LIVE",
  recordings: "DISCORD_WEBHOOK_RECORDINGS",
  announcements: "DISCORD_WEBHOOK_ANNOUNCEMENTS",
  team: "DISCORD_WEBHOOK_TEAM",
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
export const DISCORD_GREY = 0x4e5058;
export const DISCORD_RED = 0xe0655a;

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  footer?: { text: string; icon_url?: string };
  thumbnail?: { url: string };
}

export interface DiscordComponent {
  type: number;
  components?: DiscordComponent[];
  style?: number;
  label?: string;
  custom_id?: string;
  url?: string;
  emoji?: { name: string };
}

export interface DiscordMessage {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordComponent[];
  allowed_mentions?: { parse: string[] };
}

export interface DiscordRoom {
  id: string;
  motion: string | null;
  status: string | null;
  is_private?: boolean | null;
  scheduled_start?: string | null;
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

export interface DigestItem {
  kind: "bug" | "feedback";
  title: string;
  url: string;
  author: string | null;
  createdAt: string;
  tags: string[];
}

/** Yesterday on the site, for the digest. */
export interface PulseCounts {
  signups: number;
  rooms: number;
  minutes: number;
  posts: number;
  comments: number;
  matches: number;
}

/** One row of room_call_events, with the person resolved. */
export interface TroubleEvent {
  event: string;
  reason: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  user: DiscordUser | null;
}

export interface DiscordReport {
  id: string;
  reason: string | null;
  description: string | null;
  context: string | null;
  message_content: string | null;
  created_at: string;
  status?: string | null;
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

/* The black tile with the mark sits top right of every card: Discord
   paints the card's background itself, so this is the brand's black. */
function card(origin: string, embed: DiscordEmbed & { note: string; lines: Array<string | null> }): DiscordMessage {
  const { note, lines, ...rest } = embed;
  return {
    username: "AgoraSphere",
    avatar_url: `${origin}/mark-512.png`,
    embeds: [
      {
        ...rest,
        description: lines.filter((l) => l !== null).join("\n"),
        thumbnail: { url: `${origin}/mark-512.png` },
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

/* ── Rooms: one card, edited as the room moves along ─────────────── */

export type RoomPhase = "scheduled" | "live" | "ended" | "recorded" | "cancelled";

/** Where a room is in its life, or null when it has nothing to show yet. */
export function roomPhase(room: DiscordRoom): RoomPhase | null {
  if (room.status === "live") return "live";
  if (room.status === "ended") return room.recording_url && room.recording_ended_at ? "recorded" : "ended";
  if (room.status === "cancelled") return "cancelled";
  if (room.scheduled_start && (room.status === "created" || room.status === "scheduled")) return "scheduled";
  return null;
}

/** The #live-now card for a room in its current phase. */
export function roomCardMessage(
  room: DiscordRoom,
  host: DiscordUser | null,
  community: { name: string | null } | null,
  origin: string
): DiscordMessage | null {
  const phase = roomPhase(room);
  if (!phase) return null;
  if (phase === "recorded") return recordingReadyMessage(room, host, community, origin);
  if (phase === "live") return roomLiveMessage(room, host, community, origin);
  const url = `${origin}${roomPath(room)}`;
  const who = [
    `${TREE}Host: **${person(host, origin)}**`,
    community?.name ? `${TREE}Community: **${escapeMd(community.name)}**` : null,
    isDuel(room) ? `${TREE}**1 v 1**, matched from the queue` : null,
  ];
  if (phase === "scheduled") {
    return card(origin, {
      title: motionOf(room),
      url,
      color: DISCORD_GREY,
      lines: [
        `Tap the title or **[Open the room](${url})** to be there when it starts.`,
        "",
        `**Scheduled** for ${timeChip(room.scheduled_start, "f")} (${timeChip(room.scheduled_start, "R")})`,
        ...who,
        "",
        "*This card changes when the room goes live.*",
      ],
      note: "Public rooms only",
    });
  }
  if (phase === "cancelled") {
    return card(origin, {
      title: motionOf(room),
      url,
      color: DISCORD_GREY,
      lines: ["**Cancelled** before it started.", ...who, "", "*Keep an eye on this channel for the next one.*"],
      note: "Public rooms only",
    });
  }
  const run = runLabel(room.started_at, room.ended_at);
  const ago = timeChip(room.ended_at, "R");
  return card(origin, {
    title: motionOf(room),
    url,
    color: DISCORD_GREY,
    lines: [
      `Tap the title or **[Open the room](${url})** to see what was said.`,
      "",
      `**Ended**${ago ? ` ${ago}` : ""}${run ? ` · \`${run}\`` : ""}`,
      ...who,
      "",
      room.recording_url ? "*The recording lands here when it's ready.*" : "*No recording for this one.*",
    ],
    note: "Public rooms only",
  });
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

/* ── For the team: call trouble and reports ──────────────────────── */

/** "iPhone · Safari", "Mac · Chrome": the device behind a user agent. */
export function deviceLabel(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua) || /CriOS\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  return [os, browser].filter(Boolean).join(" · ") || null;
}

const TROUBLE_LABEL: Record<string, string> = {
  connect_fail: "connect failed",
  token_fail: "token failed",
  reopened_after_unclean_exit: "came back after an unclean exit",
};

/** The #team card for a room's call trouble: one per room, rewritten as events pile up. Newest first. */
export function callTroubleMessage(room: DiscordRoom, events: TroubleEvent[], origin: string): DiscordMessage {
  const url = `${origin}${roomPath(room)}`;
  const line = (e: TroubleEvent) => {
    const meta = e.meta ?? {};
    const bits = [
      timeChip(e.created_at, "t"),
      `**${escapeMd(TROUBLE_LABEL[e.event] ?? e.event.replace(/_/g, " "))}**`,
      e.user ? person(e.user, origin) : null,
      deviceLabel(typeof meta.ua === "string" ? meta.ua : null),
      typeof meta.net === "string" && meta.net ? meta.net : null,
      e.reason ? escapeMd(e.reason) : null,
    ].filter(Boolean);
    return `${TREE}${bits.join(" · ")}`;
  };
  const latest = events[0];
  return card(origin, {
    title: `Call trouble: ${motionOf(room)}`,
    url,
    color: DISCORD_RED,
    lines: [
      "Tap the title to open the room.",
      "",
      `**${events.length} ${events.length === 1 ? "event" : "events"}** in this room${latest ? ` · latest ${timeChip(latest.created_at, "R")}` : ""}`,
      ...events.slice(0, 8).map(line),
      events.length > 8 ? `${TREE}and ${events.length - 8} more` : null,
      "",
      "*From the room's own telemetry: connect and token failures, and returns after an unclean exit.*",
    ],
    note: "One card per room, updated as it goes",
  });
}

/* The app's report reasons and places, as people would say them. */
const REASON_LABEL: Record<string, string> = {
  harassment: "Harassment",
  hate_speech: "Hate speech",
  threats_violence: "Threats or violence",
  spam: "Spam",
  sexual_content: "Sexual content",
  misinformation: "Misinformation",
  impersonation: "Impersonation",
  inappropriate_username: "Inappropriate username",
  other: "Other",
};
const CONTEXT_LABEL: Record<string, string> = { room: "in a room", profile: "on a profile", chat: "in chat", history: "in the history" };

function reasonLabel(reason: string | null): string {
  const raw = (reason ?? "").trim();
  const known = REASON_LABEL[raw.toLowerCase()];
  if (known) return known;
  const t = plainText(raw.replace(/_/g, " "));
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/** The #team card for a report filed in the app. */
export function reportMessage(
  report: DiscordReport,
  reporter: DiscordUser | null,
  reported: DiscordUser | null,
  room: DiscordRoom | null,
  origin: string
): DiscordMessage {
  const target = reported?.username ? `${origin}${userPath(reported.username)}` : undefined;
  const quote = (s: string | null, max: number) =>
    s?.trim()
      ? escapeMd(clip(plainText(s), max))
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n")
      : null;
  const when = timeChip(report.created_at, "R");
  return card(origin, {
    title: `Report: ${clip(reasonLabel(report.reason) || "no reason given", 120)}`,
    url: target,
    color: DISCORD_YELLOW,
    lines: [
      target ? "Tap the title to open the reported profile." : "The reported account could not be found.",
      "",
      `**${person(reporter, origin)}** reported **${person(reported, origin)}**${when ? ` ${when}` : ""}`,
      report.context ? `${TREE}Where: **${CONTEXT_LABEL[report.context] ?? escapeMd(report.context)}**` : null,
      room ? `${TREE}Room: **[${escapeMd(motionOf(room))}](${origin}${roomPath(room)})**` : null,
      quote(report.description, 400),
      report.message_content ? `${TREE}The message:` : null,
      quote(report.message_content, 200),
      "",
      "*Handle it in the app, then say what was done in a thread here.*",
    ],
    note: "Reports from the app",
  });
}

/* ── Posts, deploys, the digest, the key ─────────────────────────── */

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

/** A production deploy went out. */
export function deployMessage(
  d: { sha: string | null; message: string | null; author?: string | null; at?: string | null },
  origin: string
): DiscordMessage {
  const first = clip(plainText(d.message).split("\n")[0] || "A new build", 200);
  const ago = timeChip(d.at, "R");
  return card(origin, {
    title: "A new build is live",
    url: origin,
    color: DISCORD_YELLOW,
    lines: [
      `Tap the title to open the site. A hard refresh gets you the new build.`,
      "",
      `**Deployed**${ago ? ` ${ago}` : ""}`,
      `${TREE}${escapeMd(first)}`,
      d.sha ? `${TREE}\`${d.sha.slice(0, 7)}\`${d.author ? ` · ${escapeMd(d.author)}` : ""}` : null,
      "",
      "*If something you reported is in there, try it again and say so on the post.*",
    ],
    note: "Every production deploy",
  });
}

export interface KeyCounts {
  minted: number;
  redeemed: number;
  testers: number;
}

function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** The morning digest for the team; null when there is nothing to say. */
export function digestMessage(items: DigestItem[], origin: string, keys?: KeyCounts, pulse?: PulseCounts): DiscordMessage | null {
  const keyNews = Boolean(keys && (keys.minted || keys.redeemed));
  const pulseNews = Boolean(pulse && (pulse.signups || pulse.rooms || pulse.posts || pulse.comments || pulse.matches));
  if (!items.length && !keyNews && !pulseNews) return null;
  const bugs = items.filter((i) => i.kind === "bug");
  const fb = items.filter((i) => i.kind === "feedback");
  const line = (i: DigestItem) =>
    `${TREE}[${escapeMd(clip(i.title, 80))}](${i.url})${i.author ? ` · ${escapeMd(i.author)}` : ""}${i.tags.length ? ` · ${i.tags.map(escapeMd).join(", ")}` : ""}`;
  const group = (name: string, list: DigestItem[]) =>
    list.length ? [`**${name}**`, ...list.slice(0, 10).map(line), list.length > 10 ? `${TREE}and ${list.length - 10} more` : null] : [];
  const n = (k: number, one: string, many: string) => `**${k} ${k === 1 ? one : many}**`;
  return card(origin, {
    title: "Since yesterday on AgoraSphere",
    color: DISCORD_YELLOW,
    lines: [
      pulse
        ? `${n(pulse.signups, "sign-up", "sign-ups")} · ${n(pulse.rooms, "room", "rooms")} held${pulse.minutes ? ` (\`${minutesLabel(pulse.minutes)}\` in all)` : ""} · ${n(pulse.posts, "post", "posts")}, ${n(pulse.comments, "comment", "comments")} · ${n(pulse.matches, "queue match", "queue matches")}`
        : null,
      `${n(bugs.length, "new bug", "new bugs")} · ${n(fb.length, "new feedback post", "new feedback posts")}`,
      keys ? `${n(keys.redeemed, "key used", "keys used")} · ${n(keys.minted, "handed out", "handed out")} · **${keys.testers}** ${keys.testers === 1 ? "tester" : "testers"} in so far` : null,
      "",
      ...group("Bugs", bugs),
      bugs.length && fb.length ? "" : null,
      ...group("Feedback", fb),
      "",
      "*Tag each bug as you go: Confirmed, In progress, Fixed, Can't reproduce or By design.*",
    ],
    note: "Every morning, for the team",
  });
}

/** What the key desk has for this person. */
export type BetaKeyState =
  | { kind: "key"; key: string; used: number; total: number }
  | { kind: "none-left"; total: number }
  | { kind: "revoked" }
  | { kind: "unavailable" }
  | { kind: "open" };

/** The reply to the button or /beta, for that person's eyes only. */
export function betaKeyEmbed(state: BetaKeyState, origin: string): DiscordEmbed {
  const base = {
    color: DISCORD_YELLOW,
    thumbnail: { url: `${origin}/mark-512.png` },
    footer: { text: `Yours alone, from this server • ${BRAND}` },
  };
  const only = "*Only you can see this message.*";
  switch (state.kind) {
    case "key": {
      const left = state.total - state.used - 1;
      return {
        ...base,
        title: "Your beta key",
        url: `${origin}/beta`,
        description: [
          `Go to **[agorasphere.net/beta](${origin}/beta)** and enter:`,
          "```",
          state.key,
          "```",
          `${TREE}One use, on one device. It stops working after that, and after 48 hours unused.`,
          left > 0
            ? `${TREE}Another device later? Press the button again. **${left} more** after this one.`
            : `${TREE}This is your last one. Ask in #general if you need more.`,
          "",
          only,
        ].join("\n"),
      };
    }
    case "none-left":
      return {
        ...base,
        title: "No keys left",
        description: [
          `You have used all **${state.total}** of yours, one per device.`,
          `${TREE}Ask in #general if you need another; the team can add one.`,
          "",
          only,
        ].join("\n"),
      };
    case "revoked":
      return {
        ...base,
        title: "No key for you right now",
        description: `Your access to the beta was switched off. If that is a surprise, ask in #general.\n\n${only}`,
      };
    case "unavailable":
      return {
        ...base,
        title: "The key desk is closed",
        description: `Something is wrong on our side. Try again in a minute; if it keeps happening, say so in #general.\n\n${only}`,
      };
    case "open":
      return {
        ...base,
        title: "The door is open",
        url: origin,
        description: `No key is needed right now: **[agorasphere.net](${origin})** lets you straight in.\n\n${only}`,
      };
  }
}

/* ── Delivery ─────────────────────────────────────────────────────── */

async function send(url: string, init: RequestInit): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
      if (res.status === 429 && attempt === 0) {
        const j = (await res.json().catch(() => null)) as { retry_after?: number } | null;
        const wait = Math.min(5000, Math.max(500, Number(j?.retry_after ?? 1) * 1000));
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return res;
    } catch (e) {
      console.error("[discord] request failed", e instanceof Error ? e.message : e);
      return null;
    }
  }
  return null;
}

/** Posts one message; the message id when Discord accepted it. Never throws. */
export async function postDiscord(url: string, message: DiscordMessage): Promise<{ ok: boolean; id: string | null }> {
  const res = await send(`${url}${url.includes("?") ? "&" : "?"}wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...message, allowed_mentions: { parse: [] } }),
  });
  if (!res) return { ok: false, id: null };
  if (!res.ok) {
    console.error("[discord] webhook refused", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return { ok: false, id: null };
  }
  const j = (await res.json().catch(() => null)) as { id?: string } | null;
  return { ok: true, id: j?.id ?? null };
}

/** Rewrites a message the webhook sent earlier. "gone" when Discord no longer has it. Never throws. */
export async function editDiscord(url: string, messageId: string, message: DiscordMessage): Promise<"ok" | "gone" | "failed"> {
  const { embeds, components } = message;
  const res = await send(`${url}/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds, components, allowed_mentions: { parse: [] } }),
  });
  if (!res) return "failed";
  if (res.ok) return "ok";
  if (res.status === 404) return "gone";
  console.error("[discord] edit refused", res.status, (await res.text().catch(() => "")).slice(0, 200));
  return "failed";
}
