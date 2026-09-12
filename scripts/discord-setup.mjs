#!/usr/bin/env node
/* Sets up the AgoraSphere beta Discord server.

   Discord keeps two things for a human: making the empty server and
   inviting a bot into it. Everything after that is here — the icon, two
   roles and the @everyone permissions, five categories and ten channels
   (forums for bugs and feedback, a voice backchannel, a private team
   room), Community mode, the welcome and rules messages pinned, one
   webhook per channel the site posts into, and a never-expiring invite.
   Safe to run again: existing roles and channels are found by name and
   brought up to date, nothing is duplicated, pinned channels are left
   alone.

   Once:
     1. Discord → + → Create My Own → For me and my friends → name it
        "AgoraSphere beta" → Create. Leave it empty.
     2. discord.com/developers/applications → New Application →
        "AgoraSphere" → Bot → Reset Token → copy it. Put it in .env.local
        as DISCORD_BOT_TOKEN=... (the file is git-ignored).
     3. OAuth2 → URL Generator → scope "bot" → permission
        "Administrator" → open the generated URL → pick the server.
     4. Server Settings → Widget → copy the Server ID (or turn on
        Developer Mode and right-click the server → Copy Server ID).
        Put it in .env.local as DISCORD_GUILD_ID=...
     5. node scripts/discord-setup.mjs

   The webhook URLs (secrets: whoever holds one can post as the site)
   are written to .env.discord.local, never printed. Paste them into
   Vercel → Settings → Environment Variables → Production, redeploy, and
   /api/health says "discord": true. The invite link is printed.

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
      const err = new Error(`${method} ${route} → ${res.status}${text ? `: ${text.slice(0, 400)}` : ""}`);
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

const T = { TEXT: 0, VOICE: 2, CATEGORY: 4, FORUM: 15 };

const YELLOW = 0xffb700;
const BLUE = 0x4a9eff;

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
  "SEND_VOICE_MESSAGES",
  "SEND_POLLS"
);

const ROLES = [
  { name: "Team", color: YELLOW, hoist: true, mentionable: true, permissions: bits("ADMINISTRATOR") },
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

const CATEGORIES = ["Start here", "Testing", "Live", "Talk", "Team"];

const CHANNELS = [
  { name: "welcome", cat: "Start here", type: T.TEXT, topic: "Start here. What the beta is, what to try this week, and where things go.", readOnly: true, noThreads: true },
  { name: "rules", cat: "Start here", type: T.TEXT, topic: "Six rules. Read them once.", readOnly: true, noThreads: true },
  { name: "announcements", cat: "Start here", type: T.TEXT, topic: "From the team. Anything featured on the AgoraSphere home page lands here too.", readOnly: true, webhook: "DISCORD_WEBHOOK_ANNOUNCEMENTS" },
  {
    name: "bugs",
    cat: "Testing",
    type: T.FORUM,
    guidelines:
      'One bug per post. Title it like a headline: "Mic stays muted after rejoining on iPhone".\n\nWhat you did\nWhat happened\nWhat you expected\nDevice and browser (iPhone 15 Safari, Pixel 8 Chrome, Mac Chrome)\nA screenshot or screen recording if you have one\n\nTag it: Calls, Communities, Home, Queue, Phone, Desktop, Account.',
    tags: ["Calls", "Communities", "Home", "Queue", "Phone", "Desktop", "Account"],
  },
  {
    name: "feedback",
    cat: "Testing",
    type: T.FORUM,
    guidelines: "What felt off, slow, or confusing, and what you would change. One thing per post, so the team can answer each one.\n\nTag it: Idea, Confusing, Slow, Love it.",
    tags: ["Idea", "Confusing", "Slow", "Love it"],
  },
  { name: "live-now", cat: "Live", type: T.TEXT, topic: "Rooms going live on AgoraSphere, posted by the site as they open. Hop in.", readOnly: true, noThreads: true, webhook: "DISCORD_WEBHOOK_LIVE" },
  { name: "past-discussions", cat: "Live", type: T.TEXT, topic: "Recordings as they land. Reply in a thread.", readOnly: true, webhook: "DISCORD_WEBHOOK_RECORDINGS" },
  { name: "general", cat: "Talk", type: T.TEXT, topic: "Everything else." },
  { name: "backchannel", cat: "Talk", type: T.VOICE, aliases: ["General"] },
  { name: "team", cat: "Team", type: T.TEXT, topic: "Team and moderators. Triage, decisions, who is fixing what.", teamOnly: true, aliases: ["moderator-only"] },
];

/* {#name} becomes a real channel mention once the ids are known. */
const WELCOME = `**Welcome to the AgoraSphere beta.**

AgoraSphere is a place to argue well: live rooms where people take the floor and make their point, communities where the threads carry on after the call, and a queue that pairs you with someone who disagrees.

This server is where the beta lives. Say what broke, what confused you, and what you would change. Nothing is too small.

**Try this first**
1. Open a room from the + menu and hold a call with someone. Phone and desktop both.
2. Post a thread in a community and reply to someone else's.
3. Queue for a match from the home screen and pick "someone who disagrees".
4. Open a past discussion and leave a comment.

**Where things go**
{#bugs} for anything broken, one post per bug.
{#feedback} for what felt off or what you would want.
{#live-now} shows rooms as they go live. Hop in.
{#general} for everything else.

The beta is closed. Please keep the invite code, this server, and screenshots to yourself for now.`;

const RULES = `**1. Argue the point, not the person.** Same as in the app.
**2. One bug per post in {#bugs}**, with your device and what you expected.
**3. The beta is closed.** Do not share the invite code, the invite link, or screenshots outside this server.
**4. What people say in rooms stays in rooms.** Do not post recordings or transcripts here unless the app itself published them.
**5. No spam, no promotion, no NSFW.**
**6. Moderators can remove anything and anyone.** Unsure? Ask in {#general}.`;

/* ── Helpers ──────────────────────────────────────────────────────── */

const log = (s) => console.log(s);
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
  let roles = await api("GET", `/guilds/${GUILD}/roles`);
  const everyone = roles.find((r) => r.id === GUILD);
  if (everyone.permissions !== EVERYONE_PERMS) {
    await api("PATCH", `/guilds/${GUILD}/roles/${GUILD}`, { permissions: EVERYONE_PERMS });
    log("✓ @everyone permissions set (testers: talk, thread, react, attach, voice; no invites, no @everyone)");
  }
  const roleId = {};
  for (const spec of ROLES) {
    const found = roles.find((r) => same(r.name, spec.name));
    if (found) {
      await api("PATCH", `/guilds/${GUILD}/roles/${found.id}`, spec);
      roleId[spec.name] = found.id;
      log(`✓ role ${spec.name} (updated)`);
    } else {
      const made = await api("POST", `/guilds/${GUILD}/roles`, spec);
      roleId[spec.name] = made.id;
      log(`✓ role ${spec.name} (created)`);
    }
  }
  /* The owner is Team. */
  await api("PUT", `/guilds/${GUILD}/members/${guild.owner_id}/roles/${roleId.Team}`);

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

  /* Channels. Two passes: everything that isn't a forum, then Community
     mode (it needs the rules and updates channels to exist), then the
     forums, which need Community mode. */
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
      ow.push({ id: roleId.Team, type: 0, allow: P.VIEW_CHANNEL.toString(), deny: "0" });
      ow.push({ id: roleId.Moderator, type: 0, allow: P.VIEW_CHANNEL.toString(), deny: "0" });
    }
    return ow;
  };

  async function ensureChannel(spec, position, community) {
    const wantType = spec.type === T.FORUM && !community ? T.TEXT : spec.type;
    const names = [spec.name, ...(spec.aliases ?? [])];
    /* Same kind of channel, by name or alias. Kind first: the template's
       "General" voice channel is not the text #general. */
    let found = channels.find((c) => c.type === wantType && names.some((n) => norm(c.name) === norm(n)));
    if (!found && (wantType === T.FORUM || wantType === T.TEXT)) {
      /* A text #bugs left by a run before Community mode was on (or a
         forum when it is off): replace it while it is still empty. */
      const twin = channels.find((c) => (c.type === T.FORUM || c.type === T.TEXT) && c.type !== wantType && norm(c.name) === norm(spec.name));
      if (twin && (await channelIsEmpty(twin.id))) {
        await api("DELETE", `/channels/${twin.id}`);
        channels.splice(channels.indexOf(twin), 1);
        log(`✓ #${twin.name} replaced with ${wantType === T.FORUM ? "a forum" : "a text channel"}`);
      } else if (twin) {
        log(`! #${twin.name} already has posts, so it stays ${twin.type === T.FORUM ? "a forum" : "a text channel"}`);
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
      body.available_tags = spec.tags.map((name) => {
        const keep = existing.find((t) => same(t.name, name));
        return keep ? { id: keep.id, name, moderated: false } : { name, moderated: false };
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
  for (const spec of CHANNELS) if (spec.type !== T.FORUM) await ensureChannel(spec, nextPos(spec.cat), false);

  /* Community mode: forums, and the rules channel shown to newcomers. */
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
      log(`! Community mode could not be turned on by the bot (${e.message.split(":").slice(-1)[0].trim()}).`);
      log("  Turn it on by hand: Server Settings → Enable Community, pick #rules and #team. Then run this again and #bugs and #feedback become forums.");
    }
  } else {
    const patch = {};
    if (guild.rules_channel_id !== chanId.rules) patch.rules_channel_id = chanId.rules;
    if (guild.public_updates_channel_id !== chanId.team) patch.public_updates_channel_id = chanId.team;
    if (Object.keys(patch).length) await api("PATCH", `/guilds/${GUILD}`, patch);
  }

  for (const spec of CHANNELS) if (spec.type === T.FORUM) await ensureChannel(spec, nextPos(spec.cat), community);

  /* Hand-made twins of the planned channels (a second #team, a "back
     channel" beside #backchannel): removed while they are empty. */
  channels = await api("GET", `/guilds/${GUILD}/channels`);
  for (const spec of CHANNELS) {
    const names = [spec.name, ...(spec.aliases ?? [])].map(norm);
    const kinds = spec.type === T.FORUM ? [T.FORUM, T.TEXT] : [spec.type];
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

  /* Welcome and rules, pinned — once. A channel with a pin is one
     someone has already written in. */
  const mention = (s) => s.replace(/\{#([a-z-]+)\}/g, (_, n) => (chanId[n] ? `<#${chanId[n]}>` : `#${n}`));
  for (const [name, text] of [
    ["welcome", WELCOME],
    ["rules", RULES],
  ]) {
    const id = chanId[name];
    if ((await pinnedMessages(id)).length) continue;
    const msg = await api("POST", `/channels/${id}/messages`, { content: mention(text), allowed_mentions: { parse: [] } });
    await pinMessage(id, msg.id);
    log(`✓ #${name} message posted and pinned`);
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

  /* One invite that never runs out, reused if it exists. */
  const invites = (await api("GET", `/guilds/${GUILD}/invites`).catch(() => [])) ?? [];
  let invite = invites.find((i) => i.max_age === 0 && i.max_uses === 0 && i.inviter?.id === me.id);
  if (!invite) {
    invite = await api("POST", `/channels/${chanId.welcome}/invites`, { max_age: 0, max_uses: 0, unique: true });
    log("✓ invite created (never expires, no use limit)");
  }
  const inviteUrl = `https://discord.gg/${invite.code}`;

  writeFileSync(
    OUT,
    [
      "# Paste these three into Vercel → Settings → Environment Variables (Production), then redeploy.",
      "# They are secrets: whoever holds one can post as the site into that channel.",
      ...out,
      "",
      "# Testers' invite (never expires). Put it in the welcome post on AgoraSphere.",
      `DISCORD_INVITE_URL=${inviteUrl}`,
      "",
    ].join("\n"),
    { mode: 0o600 }
  );

  log("");
  log(`Done. Webhook URLs are in ${path.relative(process.cwd(), OUT) || OUT} (not shown here).`);
  log(`Invite for testers: ${inviteUrl}`);
  log("Next: give Moderator to the site moderators (Server Settings → Members), paste the three webhook URLs into Vercel, redeploy.");
}

main().catch((e) => {
  console.error(`\n✕ ${e.message}`);
  if (e.status === 401) console.error("  The bot token is wrong or was reset. Bot → Reset Token in the Developer Portal, then update .env.local.");
  if (e.status === 403) console.error("  The bot is not in the server, or was invited without Administrator. Re-open the OAuth2 URL with the Administrator permission.");
  if (e.status === 404) console.error("  DISCORD_GUILD_ID does not match a server the bot is in.");
  process.exit(1);
});
