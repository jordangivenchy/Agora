import { describe, it, expect, afterEach, vi } from "vitest";
import { authorizeUrl, completeDiscordJoin, gateConfigured, gateLabel, matchGate, parseGateGuilds } from "./discordGate";

const POLITICS = "367092205539557376:POLITICS:https://discord.gg/politics";

describe("parseGateGuilds", () => {
  it("reads id:Label:invite", () => {
    expect(parseGateGuilds(POLITICS)).toEqual([{ id: "367092205539557376", label: "POLITICS", invite: "https://discord.gg/politics" }]);
  });
  it("takes several, drops bad ids, defaults the label, and needs https for the invite", () => {
    const got = parseGateGuilds(` ${POLITICS} , 123456789012345678 , nope:Bad, 223456789012345678:Club:discord.gg/club `);
    expect(got).toEqual([
      { id: "367092205539557376", label: "POLITICS", invite: "https://discord.gg/politics" },
      { id: "123456789012345678", label: "a partner server", invite: null },
      { id: "223456789012345678", label: "Club", invite: null },
    ]);
  });
  it("is empty when unset", () => {
    expect(parseGateGuilds(undefined)).toEqual([]);
    expect(parseGateGuilds("")).toEqual([]);
  });
});

describe("gateLabel", () => {
  it("names one, two, or more doors", () => {
    expect(gateLabel(parseGateGuilds(POLITICS))).toBe("POLITICS");
    expect(gateLabel(parseGateGuilds(`${POLITICS},123456789012345678:Club`))).toBe("POLITICS or Club");
    expect(gateLabel(parseGateGuilds(`${POLITICS},123456789012345678:Club,223456789012345678:Salon`))).toBe("POLITICS, Club or Salon");
    expect(gateLabel([])).toBe("a partner server");
  });
});

describe("authorizeUrl", () => {
  it("asks for the three scopes and carries the state back", () => {
    const u = new URL(authorizeUrl("111", "https://agorasphere.net/api/discord/callback", "abc123"));
    expect(u.origin + u.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(u.searchParams.get("client_id")).toBe("111");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe("https://agorasphere.net/api/discord/callback");
    expect(u.searchParams.get("scope")).toBe("identify guilds guilds.join");
    expect(u.searchParams.get("state")).toBe("abc123");
  });
});

describe("matchGate", () => {
  const gates = parseGateGuilds(`${POLITICS},123456789012345678:Club`);
  it("finds the partner server among the visitor's", () => {
    expect(matchGate([{ id: "1" }, { id: "123456789012345678" }], gates)?.label).toBe("Club");
    expect(matchGate([{ id: "367092205539557376" }], gates)?.label).toBe("POLITICS");
  });
  it("is null when none match", () => {
    expect(matchGate([{ id: "1" }], gates)).toBeNull();
    expect(matchGate([], gates)).toBeNull();
  });
});

describe("completeDiscordJoin", () => {
  const env = {
    DISCORD_CLIENT_ID: "app1",
    DISCORD_CLIENT_SECRET: "shh",
    DISCORD_BOT_TOKEN: "bot-token",
    DISCORD_GUILD_ID: "g1",
    DISCORD_GATE_GUILDS: POLITICS,
  };
  afterEach(() => vi.unstubAllEnvs());

  type Call = { url: string; method: string; auth: string | null; body: string | null };
  function discord(opts: { inPolitics: boolean; add?: number; token?: number }) {
    const calls: Call[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, method: init?.method ?? "GET", auth: headers.Authorization ?? null, body: init?.body ? String(init.body) : null });
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/oauth2/token")) return json(opts.token ?? 200, { access_token: "user-token", scope: "identify guilds guilds.join" });
      if (url.endsWith("/oauth2/token/revoke")) return new Response(null, { status: 200 });
      if (url.endsWith("/users/@me")) return json(200, { id: "u9", username: "red", global_name: "Red" });
      if (url.includes("/users/@me/guilds")) return json(200, opts.inPolitics ? [{ id: "1" }, { id: "367092205539557376" }] : [{ id: "1" }]);
      if (url.endsWith("/guilds/g1/roles")) return json(200, [{ id: "r0", name: "@everyone" }, { id: "r7", name: "POLITICS" }]);
      if (url.endsWith("/guilds/g1/members/u9")) return new Response(null, { status: opts.add ?? 201 });
      if (url.endsWith("/guilds/g1/members/u9/roles/r7")) return new Response(null, { status: 204 });
      return json(404, { message: `no route ${url}` });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it("brings a POLITICS member in with the partner's role, then revokes the token", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const d = discord({ inPolitics: true });
    const out = await completeDiscordJoin("code1", "https://agorasphere.net/api/discord/callback", d.fetchImpl);
    expect(out).toEqual({ kind: "joined", via: { id: "367092205539557376", label: "POLITICS", invite: "https://discord.gg/politics" }, user: { id: "u9", username: "red", name: "Red" } });
    const token = d.calls[0];
    expect(token.url).toBe("https://discord.com/api/v10/oauth2/token");
    expect(token.body).toContain("grant_type=authorization_code");
    expect(token.body).toContain("code=code1");
    expect(token.body).toContain("redirect_uri=https%3A%2F%2Fagorasphere.net%2Fapi%2Fdiscord%2Fcallback");
    const add = d.calls.find((c) => c.method === "PUT" && c.url.endsWith("/members/u9"))!;
    expect(add.auth).toBe("Bot bot-token");
    expect(JSON.parse(add.body!)).toEqual({ access_token: "user-token", roles: ["r7"] });
    expect(d.calls.filter((c) => c.auth === "Bearer user-token").map((c) => c.url.replace("https://discord.com/api/v10", ""))).toEqual(["/users/@me", "/users/@me/guilds?limit=200"]);
    expect(d.calls[d.calls.length - 1].url).toContain("/oauth2/token/revoke");
  });

  it("says already for a member, and makes sure of the role", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const d = discord({ inPolitics: true, add: 204 });
    const out = await completeDiscordJoin("code1", "https://agorasphere.net/api/discord/callback", d.fetchImpl);
    expect(out.kind).toBe("already");
    expect(d.calls.some((c) => c.method === "PUT" && c.url.endsWith("/members/u9/roles/r7"))).toBe(true);
  });

  it("turns away someone outside the partner server without adding them", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const d = discord({ inPolitics: false });
    const out = await completeDiscordJoin("code1", "https://agorasphere.net/api/discord/callback", d.fetchImpl);
    expect(out).toEqual({ kind: "outside" });
    expect(d.calls.some((c) => c.url.endsWith("/members/u9"))).toBe(false);
    expect(d.calls.some((c) => c.url.endsWith("/oauth2/token/revoke"))).toBe(true);
  });

  it("reports a bad code and a refused add", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(await completeDiscordJoin("bad", "https://x/cb", discord({ inPolitics: true, token: 400 }).fetchImpl)).toEqual({ kind: "failed", reason: "token_400" });
    expect(await completeDiscordJoin("c", "https://x/cb", discord({ inPolitics: true, add: 403 }).fetchImpl)).toEqual({ kind: "failed", reason: "add_403" });
  });

  it("fails closed when the door is not configured", async () => {
    vi.stubEnv("DISCORD_CLIENT_ID", "app1");
    expect(gateConfigured()).toBe(false);
    const d = discord({ inPolitics: true });
    expect(await completeDiscordJoin("c", "https://x/cb", d.fetchImpl)).toEqual({ kind: "failed", reason: "not_configured" });
    expect(d.calls).toEqual([]);
  });

  it("is configured with the pair, the bot, the server and a partner", () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(gateConfigured()).toBe(true);
  });
});
