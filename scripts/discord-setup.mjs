#!/usr/bin/env node
/* Sets up the AgoraSphere beta Discord server.

   Discord keeps two things for a human: making the empty server and
   inviting a bot into it. Everything after that is here — the icon, the
   roles (Founder, Team, Moderator; iPhone, Android, Desktop for
   onboarding) and the @everyone permissions, five categories and eleven
   channels (forums for bugs and feedback with triage tags, a voice
   backchannel, a town-hall stage, a private team room), Community mode,
   the rules newcomers accept and the welcome screen, the onboarding
   question, AutoMod, the welcome and rules cards pinned (with the
   "Get my beta key" button), the /beta command, an :as: emoji, one
   webhook per channel the site posts into, and a never-expiring invite.
   Safe to run again: existing roles and channels are found by name and
   brought up to date, nothing is duplicated, pinned cards are edited
   in place.

   Once:
     1. Discord → + → Create My Own → For me and my friends → name it
        "AgoraSphere beta" → Create. Leave it empty.
     2. discord.com/developers/applications → New Application →
        "AgoraSphere" → Bot → Reset Token → copy it. Put it in .env.local
        as DISCORD_BOT_TOKEN=... (the file is git-ignored).
     3. OAuth2 → URL Generator → scopes "bot" and "applications.commands"
        → permission "Administrator" → open the generated URL → pick the
        server.
     4. Server Settings → Widget → copy the Server ID (or turn on
        Developer Mode and right-click the server → Copy Server ID).
        Put it in .env.local as DISCORD_GUILD_ID=...
     5. node scripts/discord-setup.mjs

   The webhook URLs (secrets: whoever holds one can post as the site)
   are written to .env.discord.local, never printed. Paste them into
   Vercel → Settings → Environment Variables → Production, redeploy, and
   /api/health says "discord": true. The invite link is printed.

   The door (optional). Set DISCORD_GATE_GUILDS in .env.local to make a
   partner server's members the only people who can get in:
     DISCORD_GATE_GUILDS=367092205539557376:POLITICS:https://discord.gg/politics
   The script then adds a role named after the partner, words the cards
   for it, and, once the site reports the door live (/api/health says
   "discordGate": true — DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and
   DISCORD_GATE_GUILDS set there, and the callback URL registered under
   OAuth2 → Redirects in the Developer Portal), deletes every invite
   link. Until then the invites stay, so nobody is locked out. The way
   in becomes https://agorasphere.net/discord.

   No dependencies: Node 18+ and the Discord REST API (v10). */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ── env ──────────────────────────────────────────────────────────── */

function loadEnvLocal() {
  const p = path.join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnvLocal();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const API = (process.env.DISCORD_API_BASE || "https://discord.com/api/v10").replace(/\/$/, "");
const WEBHOOK_HOST = process.env.DISCORD_WEBHOOK_HOST || "https://discord.com";
const OUT = process.env.DISCORD_OUT_FILE || path.join(ROOT, ".env.discord.local");
const SITE = process.env.DISCORD_SITE_ORIGIN || "https://agorasphere.net";
/* Partner servers whose members may come in (id:Label:invite, comma-separated; see the notes). */
const GATES = (process.env.DISCORD_GATE_GUILDS ?? "")
  .split(",")
  .map((e) => e.trim().split(":"))
  .filter(([id]) => /^\d{15,22}$/.test(id ?? ""))
  .map(([id, label, ...rest]) => ({ id, label: (label ?? "").trim() || "a partner server", invite: rest.join(":").trim() || null }));
const GATED = GATES.length > 0;
const GATE_LABEL = GATES.map((g) => g.label).join(" or ");
const DOOR = `${SITE}/discord`;

if (!TOKEN || !GUILD) {
  console.error("Need DISCORD_BOT_TOKEN and DISCORD_GUILD_ID (in .env.local or the environment). See the notes at the top of this file.");
  process.exit(1);
}

/* ── Discord REST ─────────────────────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, route, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(API + route, {
      method,
      headers: {
        Authorization: `Bot ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://agorasphere.net, 1.0)",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      await sleep(Math.ceil((j.retry_after ?? 1) * 1000) + 50);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${method} ${route} → ${res.status}${text ? `: ${text.slice(0, 4000)}` : ""}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`${method} ${route}: rate limited too many times`);
}

/* Permission bits (BigInt: the useful ones sit past bit 31). */
const P = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n,
  CREATE_GUILD_EXPRESSIONS: 1n << 43n,
  SEND_VOICE_MESSAGES: 1n << 46n,
  SEND_POLLS: 1n << 49n,
};
const bits = (...names) => names.reduce((acc, n) => acc | P[n], 0n).toString();

const T = { TEXT: 0, VOICE: 2, CATEGORY: 4, STAGE: 13, FORUM: 15 };

const YELLOW = 0xffb700;
const BLUE = 0x4a9eff;
const OFF_WHITE = 0xf4f2ec;

/* ── The plan ─────────────────────────────────────────────────────── */

const EVERYONE_PERMS = bits(
  "VIEW_CHANNEL",
  "READ_MESSAGE_HISTORY",
  "SEND_MESSAGES",
  "SEND_MESSAGES_IN_THREADS",
  "CREATE_PUBLIC_THREADS",
  "ATTACH_FILES",
  "EMBED_LINKS",
  "ADD_REACTIONS",
  "USE_EXTERNAL_EMOJIS",
  "USE_EXTERNAL_STICKERS",
  "USE_APPLICATION_COMMANDS",
  "CHANGE_NICKNAME",
  "CONNECT",
  "SPEAK",
  "USE_VAD",
  "STREAM",
  "REQUEST_TO_SPEAK",
  "SEND_VOICE_MESSAGES",
  "SEND_POLLS"
);

/* Top to bottom in the member list. The owner is Founder; Team is the
   @agorasphere account and whoever builds the product. */
const ROLES = [
  { name: "Founder", color: YELLOW, hoist: true, mentionable: false, permissions: bits("ADMINISTRATOR") },
  { name: "Team", color: OFF_WHITE, hoist: true, mentionable: true, permissions: bits("ADMINISTRATOR") },
  {
    name: "Moderator",
    color: BLUE,
    hoist: true,
    mentionable: true,
    permissions: bits(
      "MANAGE_MESSAGES",
      "MANAGE_THREADS",
      "MODERATE_MEMBERS",
      "KICK_MEMBERS",
      "MANAGE_NICKNAMES",
      "MUTE_MEMBERS",
      "DEAFEN_MEMBERS",
      "MOVE_MEMBERS",
      "VIEW_AUDIT_LOG"
    ),
  },
];

/* One role per partner server, worn by everyone the door lets in, so
   the team can see where people came from. No colour, no powers. */
const PARTNER_ROLES = GATES.map((g) => ({ name: g.label, color: 0, hoist: false, mentionable: false, permissions: "0" }));

/* Picked in onboarding ("What are you testing on?"), so the team can
   reach the right testers: "@iPhone, the mic fix is up". */
const PLATFORM_ROLES = [
  { name: "iPhone", emoji: "📱" },
  { name: "Android", emoji: "🤖" },
  { name: "Desktop", emoji: "💻" },
].map((r) => ({ ...r, color: 0, hoist: false, mentionable: true, permissions: "0" }));

const CATEGORIES = ["Start here", "Testing", "Live", "Talk", "Team"];

const TRIAGE = ["Confirmed", "In progress", "Fixed", "Can't reproduce", "By design"];

const CHANNELS = [
  { name: "welcome", cat: "Start here", type: T.TEXT, topic: "Start here. What the beta is, what to try this week, and where things go.", readOnly: true, noThreads: true },
  { name: "rules", cat: "Start here", type: T.TEXT, topic: "Six rules. Read them once.", readOnly: true, noThreads: true },
  { name: "announcements", cat: "Start here", type: T.TEXT, topic: "From the team: what was featured on the home page, and every new build.", readOnly: true, webhook: "DISCORD_WEBHOOK_ANNOUNCEMENTS" },
  {
    name: "bugs",
    cat: "Testing",
    type: T.FORUM,
    needsCommunity: true,
    fallback: T.TEXT,
    guidelines:
      'One bug per post. Title it like a headline: "Mic stays muted after rejoining on iPhone".\n\nWhat you did\nWhat happened\nWhat you expected\nDevice and browser (iPhone 15 Safari, Pixel 8 Chrome, Mac Chrome)\nA screenshot or screen recording if you have one\n\nTag it: Calls, Communities, Home, Queue, Phone, Desktop, Account. The team adds the state: Confirmed, In progress, Fixed, Can\'t reproduce, By design.',
    tags: [
      ...["Calls", "Communities", "Home", "Queue", "Phone", "Desktop", "Account"].map((name) => ({ name, moderated: false })),
      ...TRIAGE.map((name) => ({ name, moderated: true })),
    ],
  },
  {
    name: "feedback",
    cat: "Testing",
    type: T.FORUM,
    needsCommunity: true,
    fallback: T.TEXT,
    guidelines: "What felt off, slow, or confusing, and what you would change. One thing per post, so the team can answer each one.\n\nTag it: Idea, Confusing, Slow, Love it. The team adds: Planned, Done, Not now.",
    tags: [
      ...["Idea", "Confusing", "Slow", "Love it"].map((name) => ({ name, moderated: false })),
      ...["Planned", "Done", "Not now"].map((name) => ({ name, moderated: true })),
    ],
  },
  { name: "live-now", cat: "Live", type: T.TEXT, topic: "One card per public room, kept up to date as it goes: scheduled, live, ended, recorded. Hop in while it says live.", readOnly: true, noThreads: true, webhook: "DISCORD_WEBHOOK_LIVE" },
  { name: "past-discussions", cat: "Live", type: T.TEXT, topic: "Recordings as they land. Reply in a thread.", readOnly: true, webhook: "DISCORD_WEBHOOK_RECORDINGS" },
  { name: "general", cat: "Talk", type: T.TEXT, topic: "Everything else." },
  { name: "backchannel", cat: "Talk", type: T.VOICE, aliases: ["General"] },
  { name: "town-hall", cat: "Talk", type: T.STAGE, needsCommunity: true, fallback: T.VOICE, stageMods: true, topic: "The weekly call with the team: what broke, what's next." },
  { name: "team", cat: "Team", type: T.TEXT, topic: "Team and moderators. Triage, decisions, who is fixing what. The morning digest, call trouble and reports land here.", teamOnly: true, aliases: ["moderator-only"], webhook: "DISCORD_WEBHOOK_TEAM" },
];

/* The two pinned cards, in the same shape as the cards the site posts:
   title, the facts in bold with tree sub-lines, an italic note, the
   black tile, a footer. {#name} becomes a real channel mention once the
   ids are known. */
const MARK_URL = process.env.DISCORD_MARK_URL || `${SITE}/mark-512.png`;
const TREE = " └ · ";

const WELCOME_CARD = {
  title: "Welcome to the AgoraSphere beta",
  color: YELLOW,
  description: [
    "AgoraSphere is a place to argue well: live rooms where people take the floor and make their point, communities where the threads carry on after the call, and a queue that pairs you with someone who disagrees.",
    "",
    "This server is where the beta lives. Say what broke, what confused you, and what you would change. Nothing is too small.",
    "",
    "**Your key**",
    "Tap **Get my beta key** below, or type `/beta` anywhere. Each key works once, on one device, and only you see it. A few per person.",
    "",
    "**Try this first**",
    "**1.** Open a room from the **+** menu and hold a call with someone. Phone and desktop both.",
    "**2.** Post a thread in a community and reply to someone else's.",
    "**3.** Queue for a match from the home screen and pick **someone who disagrees**.",
    "**4.** Open a past discussion and leave a comment.",
    "",
    "**Where things go**",
    `${TREE}{#bugs} for anything broken, one post per bug.`,
    `${TREE}{#feedback} for what felt off or what you would want.`,
    `${TREE}{#live-now} shows rooms as they go live. Hop in.`,
    `${TREE}{#general} for everything else.`,
    "",
    GATED
      ? `*The beta is closed. Membership comes through ${GATE_LABEL}, at ${DOOR}; there are no invite links. Keep the key and screenshots to yourself for now.*`
      : "*The beta is closed. Keep the key, this server, and screenshots to yourself for now.*",
  ].join("\n"),
  footer: { text: "Read the rules once, then say hello in general • AgoraSphere beta" },
};

const RULES_CARD = {
  title: "Six rules",
  color: YELLOW,
  description: [
    "**1. Argue the point, not the person.** Same as in the app.",
    "**2. One bug per post in {#bugs}**, with your device and what you expected.",
    GATED
      ? "**3. The beta is closed.** Do not share the key or screenshots outside this server."
      : "**3. The beta is closed.** Do not share the key, the invite link, or screenshots outside this server.",
    "**4. What people say in rooms stays in rooms.** Do not post recordings or transcripts here unless the app itself published them.",
    "**5. No spam, no promotion, no NSFW.**",
    "**6. Moderators can remove anything and anyone.** Unsure? Ask in {#general}.",
    "",
    "*They apply in the app too.*",
  ].join("\n"),
  footer: { text: "By staying in this server you accept these • AgoraSphere beta" },
};

const KEY_BUTTON = [{ type: 1, components: [{ type: 2, style: 1, label: "Get my beta key", custom_id: "beta-key", emoji: { name: "🔑" } }] }];

const DESCRIPTION = "The closed beta of AgoraSphere, a place to argue well.";

/* ── Helpers ──────────────────────────────────────────────────────── */

const log = (s) => console.log(s);

/* Whether the site can open the door: /api/health reports the OAuth
   pair, the bot and a partner all set. Any doubt counts as no. */
async function doorLive() {
  try {
    const res = await fetch(`${SITE}/api/health`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return false;
    const j = await res.json();
    return j?.discordGate === true;
  } catch {
    return false;
  }
}
/* Discord's validation errors are a nested JSON tree; say the first one. */
function firstError(node, path = []) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node._errors) && node._errors[0]) return `${path.join(".")}: ${node._errors[0].message}`;
  for (const [k, v] of Object.entries(node)) {
    const r = firstError(v, [...path, k]);
    if (r) return r;
  }
  return null;
}
const why = (e) => {
  const s = String(e?.message ?? e);
  const i = s.indexOf(": {");
  if (i >= 0) {
    try {
      const j = JSON.parse(s.slice(i + 2));
      const first = firstError(j.errors);
      return `${j.message ?? ""}${first ? ` (${first})` : ""}`.trim() || s;
    } catch {
      /* not JSON after all */
    }
  }
  return s.split(":").slice(-1)[0].trim();
};
const same = (a, b) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
/* Channel names as people type them: "Back channel" is #backchannel. */
const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function iconDataUri() {
  const p = path.join(ROOT, "public", "mark-512.png");
  if (!existsSync(p)) return null;
  return `data:image/png;base64,${readFileSync(p).toString("base64")}`;
}

async function channelIsEmpty(id) {
  try {
    const msgs = await api("GET", `/channels/${id}/messages?limit=1`);
    return !Array.isArray(msgs) || msgs.length === 0;
  } catch {
    return false;
  }
}

async function pinnedMessages(id) {
  try {
    const r = await api("GET", `/channels/${id}/messages/pins`);
    return Array.isArray(r?.items) ? r.items.map((i) => i.message ?? i) : Array.isArray(r) ? r : [];
  } catch {
    const r = await api("GET", `/channels/${id}/pins`).catch(() => []);
    return Array.isArray(r) ? r : [];
  }
}

async function pinMessage(channelId, messageId) {
  try {
    await api("PUT", `/channels/${channelId}/messages/pins/${messageId}`);
  } catch {
    await api("PUT", `/channels/${channelId}/pins/${messageId}`);
  }
}

/* ── Run ──────────────────────────────────────────────────────────── */

async function main() {
  const me = await api("GET", "/users/@me");
  const guild = await api("GET", `/guilds/${GUILD}`);
  log(`Server: ${guild.name}  (bot: ${me.username})`);

  /* Icon, once. */
  const icon = iconDataUri();
  if (!guild.icon && icon) {
    await api("PATCH", `/guilds/${GUILD}`, { icon });
    log("✓ icon set");
  }

  /* Roles. */
  const roles = await api("GET", `/guilds/${GUILD}/roles`);
  const everyone = roles.find((r) => r.id === GUILD);
  if (everyone.permissions !== EVERYONE_PERMS) {
    await api("PATCH", `/guilds/${GUILD}/roles/${GUILD}`, { permissions: EVERYONE_PERMS });
    log("✓ @everyone permissions set (testers: talk, thread, react, attach, voice; no invites, no @everyone)");
  }
  /* A role dragged above the bot's own is out of the bot's reach from
     then on (Discord's hierarchy): it is found and left as it is. */
  const roleId = {};
  for (const spec of [...ROLES, ...PLATFORM_ROLES, ...PARTNER_ROLES]) {
    const body = { ...spec };
    delete body.emoji;
    const found = roles.find((r) => same(r.name, spec.name));
    if (found) {
      roleId[spec.name] = found.id;
      try {
        await api("PATCH", `/guilds/${GUILD}/roles/${found.id}`, body);
        log(`✓ role ${spec.name} (updated)`);
      } catch (e) {
        if (e.status !== 403) throw e;
        log(`✓ role ${spec.name} (above the bot's role, left as it is)`);
      }
    } else {
      const made = await api("POST", `/guilds/${GUILD}/roles`, body);
      roleId[spec.name] = made.id;
      log(`✓ role ${spec.name} (created)`);
    }
  }
  /* Founder above Team above Moderator, so the member list groups in
     that order. A new role lands at the bottom otherwise. Skipped once
     the order is already right, or when a role is out of reach. */
  const order = ["Moderator", "Team", "Founder"].map((n) => roles.find((r) => r.id === roleId[n])).filter(Boolean);
  const ordered = order.length === 3 && order[0].position < order[1].position && order[1].position < order[2].position;
  if (!ordered) {
    try {
      await api("PATCH", `/guilds/${GUILD}/roles`, [
        { id: roleId.Moderator, position: 1 },
        { id: roleId.Team, position: 2 },
        { id: roleId.Founder, position: 3 },
      ]);
    } catch (e) {
      log(`! role order could not be set by the bot (${why(e)}). Drag AgoraSphere (the bot's role) to the top, then Founder, Team, Moderator beneath it, in Server Settings → Roles.`);
    }
  }
  /* The owner is the Founder. */
  try {
    await api("PUT", `/guilds/${GUILD}/members/${guild.owner_id}/roles/${roleId.Founder}`);
  } catch (e) {
    if (e.status !== 403) throw e;
    log("! Founder is above the bot's role, so the bot cannot hand it out; give it to yourself in Server Settings → Members if you lack it.");
  }

  /* Categories. */
  let channels = await api("GET", `/guilds/${GUILD}/channels`);
  const catId = {};
  for (const [i, name] of CATEGORIES.entries()) {
    const found = channels.find((c) => c.type === T.CATEGORY && norm(c.name) === norm(name));
    if (found) {
      if (found.position !== i || found.name !== name) await api("PATCH", `/channels/${found.id}`, { name, position: i });
      catId[name] = found.id;
    } else {
      const made = await api("POST", `/guilds/${GUILD}/channels`, { name, type: T.CATEGORY, position: i });
      catId[name] = made.id;
      log(`✓ category ${name} (created)`);
    }
  }

  /* Channels. Two passes: everything that doesn't need Community mode,
     then Community mode (it needs the rules and updates channels to
     exist), then the forums and the stage, which need it. */
  const chanId = {};
  const overwritesFor = (spec) => {
    const ow = [];
    if (spec.readOnly) {
      let deny = P.SEND_MESSAGES;
      if (spec.noThreads) deny |= P.CREATE_PUBLIC_THREADS | P.SEND_MESSAGES_IN_THREADS | P.CREATE_PRIVATE_THREADS;
      ow.push({ id: GUILD, type: 0, allow: "0", deny: deny.toString() });
    }
    if (spec.teamOnly) {
      ow.push({ id: GUILD, type: 0, allow: "0", deny: P.VIEW_CHANNEL.toString() });
      for (const r of ["Founder", "Team", "Moderator"]) ow.push({ id: roleId[r], type: 0, allow: P.VIEW_CHANNEL.toString(), deny: "0" });
    }
    if (spec.stageMods) {
      /* Stage moderators: Manage Channel plus mute and move, which the role has. */
      ow.push({ id: roleId.Moderator, type: 0, allow: P.MANAGE_CHANNELS.toString(), deny: "0" });
    }
    return ow;
  };

  async function ensureChannel(spec, position, community) {
    const wantType = spec.needsCommunity && !community ? spec.fallback : spec.type;
    const names = [spec.name, ...(spec.aliases ?? [])];
    /* Same kind of channel, by name or alias. Kind first: the template's
       "General" voice channel is not the text #general. */
    let found = channels.find((c) => c.type === wantType && names.some((n) => norm(c.name) === norm(n)));
    if (!found && spec.fallback !== undefined) {
      /* A text #bugs (or voice town-hall) left by a run before Community
         mode was on, or the other way round: replace it while it is
         still empty. */
      const other = wantType === spec.type ? spec.fallback : spec.type;
      const twin = channels.find((c) => c.type === other && norm(c.name) === norm(spec.name));
      if (twin && (await channelIsEmpty(twin.id))) {
        await api("DELETE", `/channels/${twin.id}`);
        channels.splice(channels.indexOf(twin), 1);
        log(`✓ #${twin.name} replaced with ${wantType === T.FORUM ? "a forum" : wantType === T.STAGE ? "a stage" : "a plain channel"}`);
      } else if (twin) {
        log(`! #${twin.name} already has posts, so it stays as it is`);
        found = twin;
      }
    }
    const type = found ? found.type : wantType;
    const body = {
      name: spec.name,
      type,
      parent_id: catId[spec.cat],
      position,
      permission_overwrites: overwritesFor(spec),
    };
    if (type === T.TEXT) body.topic = (spec.topic ?? spec.guidelines ?? "").slice(0, 1024);
    if (type === T.FORUM) {
      body.topic = spec.guidelines;
      body.default_sort_order = 0;
      body.default_forum_layout = 1;
      const existing = found?.available_tags ?? [];
      body.available_tags = spec.tags.map((t) => {
        const keep = existing.find((x) => same(x.name, t.name));
        return keep ? { id: keep.id, name: t.name, moderated: t.moderated } : { name: t.name, moderated: t.moderated };
      });
    }
    if (found) {
      const patch = { ...body };
      delete patch.type;
      const was = found.name;
      const updated = await api("PATCH", `/channels/${found.id}`, patch);
      chanId[spec.name] = found.id;
      Object.assign(found, updated ?? patch);
      log(`✓ #${spec.name} (updated${was !== spec.name ? `, was #${was}` : ""})`);
    } else {
      const made = await api("POST", `/guilds/${GUILD}/channels`, body);
      chanId[spec.name] = made.id;
      channels.push(made);
      log(`✓ #${spec.name} (created)`);
    }
  }

  const pos = {};
  const nextPos = (cat) => (pos[cat] = (pos[cat] ?? -1) + 1);
  for (const spec of CHANNELS) if (!spec.needsCommunity) await ensureChannel(spec, nextPos(spec.cat), false);

  /* Community mode: forums, the stage, and the rules channel shown to
     newcomers. */
  let community = (guild.features ?? []).includes("COMMUNITY");
  if (!community) {
    try {
      await api("PATCH", `/guilds/${GUILD}`, {
        features: [...new Set([...(guild.features ?? []), "COMMUNITY"])],
        rules_channel_id: chanId.rules,
        public_updates_channel_id: chanId.team,
        explicit_content_filter: 2,
        verification_level: Math.max(1, guild.verification_level ?? 0),
        default_message_notifications: 1,
      });
      community = true;
      log("✓ Community mode on (rules: #rules, updates: #team)");
    } catch (e) {
      log(`! Community mode could not be turned on by the bot (${why(e)}).`);
      log("  Turn it on by hand: Server Settings → Enable Community, pick #rules and #team. Then run this again and #bugs and #feedback become forums.");
    }
  } else {
    const patch = {};
    if (guild.rules_channel_id !== chanId.rules) patch.rules_channel_id = chanId.rules;
    if (guild.public_updates_channel_id !== chanId.team) patch.public_updates_channel_id = chanId.team;
    if (Object.keys(patch).length) await api("PATCH", `/guilds/${GUILD}`, patch);
  }

  for (const spec of CHANNELS) if (spec.needsCommunity) await ensureChannel(spec, nextPos(spec.cat), community);

  /* Hand-made twins of the planned channels (a second #team, a "back
     channel" beside #backchannel): removed while they are empty. */
  channels = await api("GET", `/guilds/${GUILD}/channels`);
  for (const spec of CHANNELS) {
    const names = [spec.name, ...(spec.aliases ?? [])].map(norm);
    const kinds = [spec.type, spec.fallback].filter((k) => k !== undefined);
    for (const c of channels.filter((c) => c.id !== chanId[spec.name] && kinds.includes(c.type) && names.includes(norm(c.name)))) {
      if (await channelIsEmpty(c.id)) {
        await api("DELETE", `/channels/${c.id}`);
        channels.splice(channels.indexOf(c), 1);
        log(`✓ duplicate #${c.name} removed (it was empty)`);
      } else {
        log(`! duplicate #${c.name} has messages; left for you to merge or delete`);
      }
    }
  }

  /* The template's empty categories. */
  channels = await api("GET", `/guilds/${GUILD}/channels`);
  for (const c of channels.filter((c) => c.type === T.CATEGORY && !CATEGORIES.some((n) => same(c.name, n)))) {
    if (!channels.some((k) => k.parent_id === c.id)) {
      await api("DELETE", `/channels/${c.id}`);
      log(`✓ empty category "${c.name}" removed`);
    }
  }

  /* Welcome and rules: one pinned card each. The bot's own pinned
     message is brought up to date in place (an older plain-text one
     becomes the card); a pin someone else made is left alone. */
  const mention = (s) => s.replace(/\{#([a-z-]+)\}/g, (_, n) => (chanId[n] ? `<#${chanId[n]}>` : `#${n}`));
  const shape = (e, buttons) => JSON.stringify({ t: e?.title, d: e?.description, c: e?.color, f: e?.footer?.text, i: e?.thumbnail?.url, b: buttons ? 1 : 0 });
  for (const [name, spec, components] of [
    ["welcome", WELCOME_CARD, KEY_BUTTON],
    ["rules", RULES_CARD, []],
  ]) {
    const id = chanId[name];
    const embed = { ...spec, description: mention(spec.description), thumbnail: { url: MARK_URL } };
    const pins = await pinnedMessages(id);
    const mine = pins.find((p) => p.author?.id === me.id);
    if (mine) {
      if (shape(mine.embeds?.[0], mine.components?.length) !== shape(embed, components.length) || mine.content) {
        await api("PATCH", `/channels/${id}/messages/${mine.id}`, { content: "", embeds: [embed], components, allowed_mentions: { parse: [] } });
        log(`✓ #${name} card updated`);
      }
    } else if (pins.length) {
      log(`! #${name} has a pinned message by someone else; left alone`);
    } else {
      const msg = await api("POST", `/channels/${id}/messages`, { embeds: [embed], components, allowed_mentions: { parse: [] } });
      await pinMessage(id, msg.id);
      log(`✓ #${name} card posted and pinned`);
    }
    /* Discord adds a "pinned a message" notice (type 6) to the channel
       for every pin: an empty grey line under the card. Not in these two. */
    const recent = await api("GET", `/channels/${id}/messages?limit=50`).catch(() => []);
    const notices = (Array.isArray(recent) ? recent : []).filter((m) => m.type === 6);
    for (const m of notices) await api("DELETE", `/channels/${id}/messages/${m.id}`);
    if (notices.length) log(`✓ #${name}: ${notices.length} "pinned a message" notice${notices.length > 1 ? "s" : ""} removed`);
  }

  /* Joining. Two things Discord itself shows a newcomer, so nothing has
     to be running: Rules Screening (the six rules, accepted before they
     can talk) and the Welcome Screen (a line about the place and the
     five channels to start in). Both need Community mode. */
  if (community) {
    const rules = RULES_CARD.description
      .split("\n")
      .filter((l) => /^\*\*\d\./.test(l))
      .map((l) => l.replace(/\*\*/g, "").replace(/\{#([a-z-]+)\}/g, "#$1").replace(/^\d\.\s*/, ""));
    const screening = {
      enabled: true,
      description: "The AgoraSphere beta is closed and small. Read these once; you accept them by joining.",
      form_fields: [{ field_type: "TERMS", label: "Read and agree to the following rules", values: rules, required: true }],
    };
    try {
      /* The form comes as a JSON string on this endpoint; older docs and
         some servers take the array. Try the string first. */
      await api("PATCH", `/guilds/${GUILD}/member-verification`, { ...screening, form_fields: JSON.stringify(screening.form_fields) }).catch(() =>
        api("PATCH", `/guilds/${GUILD}/member-verification`, screening)
      );
      log(`✓ rules screening on: newcomers accept the ${rules.length} rules before they can talk`);
    } catch (e) {
      log(`! rules screening could not be set by the bot (${why(e)}).`);
      log("  By hand: Server Settings → Safety Setup → Rules Screening → Set up → paste the six rules → Enable.");
    }
    try {
      await api("PATCH", `/guilds/${GUILD}/welcome-screen`, {
        enabled: true,
        description: "A place to argue well. Say what broke, what confused you, and what you would change.",
        welcome_channels: [
          { channel_id: chanId.welcome, description: "Start here", emoji_name: "👋" },
          { channel_id: chanId.bugs, description: "One post per bug", emoji_name: "🐛" },
          { channel_id: chanId.feedback, description: "What felt off, what you would change", emoji_name: "💬" },
          { channel_id: chanId["live-now"], description: "Rooms as they go live", emoji_name: "🔴" },
          { channel_id: chanId.general, description: "Everything else", emoji_name: "💭" },
        ].filter((c) => c.channel_id),
      });
      log("✓ welcome screen on: five channels to start in");
    } catch (e) {
      log(`! welcome screen could not be set by the bot (${why(e)}).`);
      log("  By hand: Server Settings → Onboarding → Welcome Screen → add welcome, bugs, feedback, live-now, general.");
    }

    /* Onboarding: one question, "What are you testing on?", which hands
       out the platform roles. Discord wants every public channel listed
       as a default, and an id on every prompt and option: the existing
       ones are reused so answers already given survive a re-run; new
       ones get placeholders Discord replaces. */
    try {
      const QUESTION = "What are you testing on?";
      const publicIds = CHANNELS.filter((s) => !s.teamOnly).map((s) => chanId[s.name]).filter(Boolean);
      const current = await api("GET", `/guilds/${GUILD}/onboarding`).catch(() => null);
      const prev = (current?.prompts ?? []).find((p) => p.title === QUESTION);
      await api("PUT", `/guilds/${GUILD}/onboarding`, {
        enabled: true,
        mode: 0,
        default_channel_ids: publicIds,
        prompts: [
          {
            id: prev?.id ?? "0",
            type: 0,
            title: QUESTION,
            single_select: false,
            required: true,
            in_onboarding: true,
            options: PLATFORM_ROLES.map((r, i) => ({
              id: (prev?.options ?? []).find((o) => o.title === r.name)?.id ?? String(i + 1),
              title: r.name,
              description: "",
              emoji_name: r.emoji,
              role_ids: [roleId[r.name]],
              channel_ids: [],
            })),
          },
        ],
      });
      log("✓ onboarding on: newcomers pick iPhone, Android or Desktop and get the role");
    } catch (e) {
      log(`! onboarding could not be set by the bot (${why(e)}).`);
      log("  By hand: Server Settings → Onboarding → Default Channels: all public ones → Questions: \"What are you testing on?\" → iPhone / Android / Desktop → the matching role → Enable.");
    }

    /* The line under the server name in the invite preview. */
    if (guild.description !== DESCRIPTION) {
      await api("PATCH", `/guilds/${GUILD}`, { description: DESCRIPTION }).then(
        () => log("✓ server description set"),
        (e) => log(`! server description could not be set (${why(e)})`)
      );
    }
  }

  /* AutoMod: the rules the testers agreed to, kept by Discord. Invite
     links are the team's to share; mention floods and spam are blocked.
     Alerts land in #team. Founder, Team and Moderator are exempt. */
  const exempt = ["Founder", "Team", "Moderator"].map((r) => roleId[r]).filter(Boolean);
  const alert = chanId.team ? [{ type: 2, metadata: { channel_id: chanId.team } }] : [];
  const AUTOMOD = [
    {
      name: "No invite links",
      event_type: 1,
      trigger_type: 1,
      trigger_metadata: { regex_patterns: ["(?:discord\\.gg|discord(?:app)?\\.com/invite)/[A-Za-z0-9-]+"], keyword_filter: [], allow_list: [] },
      actions: [{ type: 1, metadata: { custom_message: "Invites are the team's to share. Ask in #general if someone should be here." } }, ...alert],
    },
    {
      name: "No mention floods",
      event_type: 1,
      trigger_type: 5,
      trigger_metadata: { mention_total_limit: 5, mention_raid_protection_enabled: true },
      actions: [{ type: 1, metadata: { custom_message: "That's a lot of people at once. Say it without the pings." } }, ...alert],
    },
    {
      name: "No spam",
      event_type: 1,
      trigger_type: 3,
      trigger_metadata: {},
      actions: [{ type: 1, metadata: {} }, ...alert],
    },
  ];
  try {
    const existing = (await api("GET", `/guilds/${GUILD}/auto-moderation/rules`)) ?? [];
    for (const rule of AUTOMOD) {
      const body = { ...rule, enabled: true, exempt_roles: exempt, exempt_channels: [] };
      const found = existing.find((r) => same(r.name, rule.name) || r.trigger_type === rule.trigger_type);
      if (found) {
        await api("PATCH", `/guilds/${GUILD}/auto-moderation/rules/${found.id}`, body);
      } else {
        await api("POST", `/guilds/${GUILD}/auto-moderation/rules`, body);
        log(`✓ AutoMod: ${rule.name} (created)`);
      }
    }
  } catch (e) {
    log(`! AutoMod could not be set by the bot (${why(e)}). By hand: Server Settings → AutoMod.`);
  }

  /* An :as: emoji, from the mark. */
  if (icon) {
    try {
      const emojis = (await api("GET", `/guilds/${GUILD}/emojis`)) ?? [];
      if (!emojis.some((e) => e.name === "as")) {
        await api("POST", `/guilds/${GUILD}/emojis`, { name: "as", image: icon });
        log("✓ emoji :as: added");
      }
    } catch (e) {
      log(`! emoji could not be added (${why(e)})`);
    }
  }

  /* The /beta command. Needs the applications.commands scope on this
     server: the OAuth2 URL from the notes at the top grants it. */
  let commandNote = null;
  try {
    const app = await api("GET", "/oauth2/applications/@me");
    await api("PUT", `/applications/${app.id}/guilds/${GUILD}/commands`, [{ name: "beta", description: "Get your AgoraSphere beta key", type: 1 }]);
    log("✓ /beta command registered");
  } catch (e) {
    const app = await api("GET", "/oauth2/applications/@me").catch(() => null);
    commandNote = app
      ? `${WEBHOOK_HOST}/oauth2/authorize?client_id=${app.id}&scope=bot%20applications.commands&permissions=8`
      : "the OAuth2 URL with the applications.commands scope";
    log(`! /beta command could not be registered (${why(e)}). Open ${commandNote} once, pick the server, then run this again. The button on the welcome card works regardless.`);
  }

  /* Webhooks: one per channel the site posts into. */
  const out = [];
  for (const spec of CHANNELS.filter((s) => s.webhook)) {
    const id = chanId[spec.name];
    const hooks = await api("GET", `/channels/${id}/webhooks`);
    let hook = (hooks ?? []).find((h) => same(h.name, "AgoraSphere") && h.token);
    if (!hook) {
      hook = await api("POST", `/channels/${id}/webhooks`, { name: "AgoraSphere", ...(icon ? { avatar: icon } : {}) });
      log(`✓ webhook in #${spec.name} (created)`);
    } else {
      log(`✓ webhook in #${spec.name} (kept)`);
    }
    out.push(`${spec.webhook}=${WEBHOOK_HOST}/api/webhooks/${hook.id}/${hook.token}`);
  }

  /* The way in. With a door: every invite link goes, once the site can
     actually open the door (otherwise nobody could get in at all).
     Without one: an invite that never runs out, reused if it exists. */
  const invites = (await api("GET", `/guilds/${GUILD}/invites`).catch(() => [])) ?? [];
  let wayIn;
  if (GATED) {
    const live = await doorLive();
    if (live) {
      for (const i of invites) await api("DELETE", `/invites/${i.code}`);
      log(invites.length ? `✓ ${invites.length} invite link${invites.length === 1 ? "" : "s"} deleted: the door at ${DOOR} is the only way in` : `✓ no invite links: the door at ${DOOR} is the only way in`);
    } else {
      log(`! ${invites.length} invite link${invites.length === 1 ? "" : "s"} kept: ${DOOR} is not live yet (${SITE}/api/health must say "discordGate": true — DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GATE_GUILDS on the site, redirect registered, deployed). Run this again after that.`);
    }
    wayIn = DOOR;
  } else {
    let invite = invites.find((i) => i.max_age === 0 && i.max_uses === 0 && i.inviter?.id === me.id);
    if (!invite) {
      invite = await api("POST", `/channels/${chanId.welcome}/invites`, { max_age: 0, max_uses: 0, unique: true });
      log("✓ invite created (never expires, no use limit)");
    }
    wayIn = `https://discord.gg/${invite.code}`;
  }

  writeFileSync(
    OUT,
    [
      "# Paste these into Vercel → Settings → Environment Variables (Production), then redeploy.",
      "# The webhook URLs are secrets: whoever holds one can post as the site into that channel.",
      ...out,
      "",
      "# For the morning digest (reads the forums as the bot) — the same values as in .env.local:",
      `DISCORD_GUILD_ID=${GUILD}`,
      "# DISCORD_BOT_TOKEN=<the bot token>",
      "",
      "# For the beta-key button and /beta: the application's public key (Developer Portal →",
      "# General Information → Public Key), then set the Interactions Endpoint URL there to",
      `#   ${SITE}/api/webhook/discord`,
      "# DISCORD_PUBLIC_KEY=<the public key>",
      "",
      ...(GATED
        ? [
            `# The door: ${GATE_LABEL} members sign in with Discord there and the bot brings them in.`,
            "# Needs, on the site: DISCORD_CLIENT_ID (Developer Portal → OAuth2 → Client ID), DISCORD_CLIENT_SECRET",
            `# (same page, Reset Secret), and DISCORD_GATE_GUILDS as in .env.local; register ${SITE}/api/discord/callback`,
            "# under OAuth2 → Redirects. Put this link in the partner server's post.",
            `DISCORD_DOOR_URL=${wayIn}`,
          ]
        : ["# Testers' invite (never expires). Put it in the welcome post on AgoraSphere.", `DISCORD_INVITE_URL=${wayIn}`]),
      "",
    ].join("\n"),
    { mode: 0o600 }
  );

  log("");
  log(`Done. Webhook URLs are in ${path.relative(process.cwd(), OUT) || OUT} (not shown here).`);
  log(GATED ? `The door, for ${GATE_LABEL} members: ${wayIn}` : `Invite for testers: ${wayIn}`);
  log("Next: paste the webhook URLs, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN and DISCORD_PUBLIC_KEY into Vercel and redeploy; then set the");
  log(`      Interactions Endpoint URL in the Developer Portal to ${SITE}/api/webhook/discord so the key button answers.`);
  log("      Give Moderator to the site moderators (Server Settings → Members).");
}

main().catch((e) => {
  console.error(`\n✕ ${e.message}`);
  if (e.status === 401) console.error("  The bot token is wrong or was reset. Bot → Reset Token in the Developer Portal, then update .env.local.");
  if (e.status === 403) console.error("  The bot is not in the server, or was invited without Administrator. Re-open the OAuth2 URL with the Administrator permission.");
  if (e.status === 404) console.error("  DISCORD_GUILD_ID does not match a server the bot is in.");
  process.exit(1);
});
