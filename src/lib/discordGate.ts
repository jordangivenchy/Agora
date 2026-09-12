/* The door to the Discord server: membership through a partner server.

   Discord cannot make one server's invite depend on membership in
   another, so the app holds the door instead. /discord explains it,
   /api/discord/join sends the visitor to Discord's consent screen
   (identify, guilds, guilds.join), and /api/discord/callback trades
   the code for a token, reads which servers the visitor is in, and
   when one of the partner servers (DISCORD_GATE_GUILDS) is among them
   the bot adds them to ours, wearing that partner's role. Once the
   door is live, scripts/discord-setup.mjs deletes the invite links, so
   the door is the only way in. Nothing is kept: the token is revoked
   as soon as the member is in.

   DISCORD_GATE_GUILDS is a comma-separated list of id:Label:invite —
   the partner server's id, how it is named on the page and in the role,
   and (optional) where to send someone who is not in it yet:
     367092205539557376:POLITICS:https://discord.gg/politics

   Server-only: the client secret and the bot token. */

const API = "https://discord.com/api/v10";
const UA = "DiscordBot (https://agorasphere.net, 1.0)";
const TIMEOUT_MS = 10_000;

export const GATE_SCOPES = ["identify", "guilds", "guilds.join"];
export const GATE_STATE_COOKIE = "agora_dc_state";
export const GATE_STATE_TTL_S = 10 * 60;

export interface GateGuild {
  id: string;
  label: string;
  invite: string | null;
}

/** id:Label:invite, comma-separated. Bad entries are dropped, not thrown. */
export function parseGateGuilds(raw: string | undefined | null): GateGuild[] {
  const out: GateGuild[] = [];
  for (const entry of (raw ?? "").split(",")) {
    const [id = "", label = "", ...rest] = entry.trim().split(":");
    if (!/^\d{15,22}$/.test(id.trim())) continue;
    const invite = rest.join(":").trim();
    out.push({
      id: id.trim(),
      label: label.trim() || "a partner server",
      invite: /^https:\/\//.test(invite) ? invite : null,
    });
  }
  return out;
}

export function gateGuilds(): GateGuild[] {
  return parseGateGuilds(process.env.DISCORD_GATE_GUILDS);
}

/** "POLITICS", or "POLITICS or Debate Club" when there are several doors. */
export function gateLabel(guilds: GateGuild[] = gateGuilds()): string {
  const names = guilds.map((g) => g.label);
  if (names.length <= 1) return names[0] ?? "a partner server";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** Everything the door needs: the app's OAuth pair, the bot, the server, and at least one partner. */
export function gateConfigured(): boolean {
  return Boolean(
    process.env.DISCORD_CLIENT_ID &&
      process.env.DISCORD_CLIENT_SECRET &&
      process.env.DISCORD_BOT_TOKEN &&
      process.env.DISCORD_GUILD_ID &&
      gateGuilds().length
  );
}

export function newGateState(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** Discord's consent screen for the three scopes, coming back to redirectUri with the state. */
export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: GATE_SCOPES.join(" "),
    state,
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${q.toString()}`;
}

/** The first partner server the visitor is in, or null. */
export function matchGate(memberOf: Array<{ id: string }>, gates: GateGuild[]): GateGuild | null {
  const ids = new Set(memberOf.map((g) => g.id));
  return gates.find((g) => ids.has(g.id)) ?? null;
}

export interface GateUser {
  id: string;
  username: string;
  name: string;
}

export type JoinOutcome =
  | { kind: "joined" | "already"; user: GateUser; via: GateGuild }
  | { kind: "outside" }
  | { kind: "failed"; reason: string };

interface TokenResponse {
  access_token?: string;
  scope?: string;
}
interface DiscordMe {
  id: string;
  username: string;
  global_name?: string | null;
}

/** Trade the code for a token, check the visitor's servers, and bring them in. Never throws. */
export async function completeDiscordJoin(code: string, redirectUri: string, fetchImpl: typeof fetch = fetch): Promise<JoinOutcome> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const secret = process.env.DISCORD_CLIENT_SECRET;
  const bot = process.env.DISCORD_BOT_TOKEN;
  const guild = process.env.DISCORD_GUILD_ID;
  const gates = gateGuilds();
  if (!clientId || !secret || !bot || !guild || !gates.length) return { kind: "failed", reason: "not_configured" };

  const call = (path: string, init: RequestInit) =>
    fetchImpl(`${API}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
  const form = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA };
  const asBot = { Authorization: `Bot ${bot}`, "Content-Type": "application/json", "User-Agent": UA };

  const tokenRes = await call("/oauth2/token", {
    method: "POST",
    headers: form,
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!tokenRes?.ok) return { kind: "failed", reason: `token_${tokenRes?.status ?? "down"}` };
  const token = ((await tokenRes.json().catch(() => null)) ?? {}) as TokenResponse;
  const access = token.access_token;
  if (!access) return { kind: "failed", reason: "token_empty" };
  const granted = new Set((token.scope ?? "").split(" "));
  if (!GATE_SCOPES.every((s) => granted.has(s))) return { kind: "failed", reason: "scope" };

  const asUser = { Authorization: `Bearer ${access}`, "User-Agent": UA };
  const revoke = () =>
    call("/oauth2/token/revoke", {
      method: "POST",
      headers: form,
      body: new URLSearchParams({ client_id: clientId, client_secret: secret, token: access, token_type_hint: "access_token" }),
    });

  const meRes = await call("/users/@me", { headers: asUser });
  const me = meRes?.ok ? ((await meRes.json().catch(() => null)) as DiscordMe | null) : null;
  if (!me?.id) {
    await revoke();
    return { kind: "failed", reason: `me_${meRes?.status ?? "down"}` };
  }

  const guildsRes = await call("/users/@me/guilds?limit=200", { headers: asUser });
  const memberOf = guildsRes?.ok ? (((await guildsRes.json().catch(() => null)) ?? []) as Array<{ id: string }>) : null;
  if (!memberOf) {
    await revoke();
    return { kind: "failed", reason: `guilds_${guildsRes?.status ?? "down"}` };
  }

  const via = matchGate(memberOf, gates);
  if (!via) {
    await revoke();
    return { kind: "outside" };
  }

  /* The partner's role, if the setup script has made it. */
  const rolesRes = await call(`/guilds/${guild}/roles`, { headers: asBot });
  const roles = rolesRes?.ok ? (((await rolesRes.json().catch(() => null)) ?? []) as Array<{ id: string; name: string }>) : [];
  const role = roles.find((r) => r.name.toLowerCase() === via.label.toLowerCase()) ?? null;

  const addRes = await call(`/guilds/${guild}/members/${me.id}`, {
    method: "PUT",
    headers: asBot,
    body: JSON.stringify({ access_token: access, ...(role ? { roles: [role.id] } : {}) }),
  });
  let kind: "joined" | "already";
  if (addRes?.status === 201) {
    kind = "joined";
  } else if (addRes?.status === 204) {
    kind = "already";
    if (role) await call(`/guilds/${guild}/members/${me.id}/roles/${role.id}`, { method: "PUT", headers: asBot });
  } else {
    await revoke();
    return { kind: "failed", reason: `add_${addRes?.status ?? "down"}` };
  }
  await revoke();

  return { kind, via, user: { id: me.id, username: me.username, name: me.global_name || me.username } };
}
