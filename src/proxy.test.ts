import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { BETA_COOKIE, BETA_COOKIE_MAX_AGE, issuePass, verifyPass } from "@/lib/betaGate";

/* The door itself: who gets through, who is sent to the key page, and
   that a browser's pass is kept alive by coming back. The session part
   of the proxy is stood in for; it has its own home. */
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: null, error: null }) } }),
}));
/* The key desk: whether a key's person is still welcome. */
const desk = vi.hoisted(() => ({ welcome: true, asked: 0 }));
vi.mock("@/lib/betaKeys", () => ({
  keyStillStands: async () => { desk.asked += 1; return desk.welcome; },
}));

import { proxy } from "./proxy";

const CODE = "the-master-code";
const DAY = 86400_000;
const SITE = "https://agorasphere.net";
const KEY = "3f7b2c1e-0000-4000-8000-000000000001";
/* Opening a page, unless `fetches`: then one of the requests a page makes. */
const visit = (path: string, init: { cookie?: string; header?: string; method?: string; fetches?: boolean } = {}) =>
  new NextRequest(SITE + path, {
    method: init.method ?? "GET",
    headers: {
      ...(init.cookie ? { cookie: `${BETA_COOKIE}=${init.cookie}` } : {}),
      ...(init.header ? { "x-agora-beta": init.header } : {}),
      ...(init.fetches || init.method === "POST" ? { accept: "*/*", "sec-fetch-dest": "empty" } : { accept: "text/html,application/xhtml+xml", "sec-fetch-dest": "document" }),
    },
  });
const sentToTheKeyPage = (res: Response) => res.status === 307 && new URL(res.headers.get("location")!).pathname === "/beta";
const newPass = (res: Awaited<ReturnType<typeof proxy>>) => res.cookies.get(BETA_COOKIE)?.value ?? null;

describe("the closed-beta door", () => {
  const saved = process.env.BETA_INVITE_CODE;
  beforeEach(() => { process.env.BETA_INVITE_CODE = CODE; desk.welcome = true; desk.asked = 0; });
  afterEach(() => {
    if (saved === undefined) delete process.env.BETA_INVITE_CODE;
    else process.env.BETA_INVITE_CODE = saved;
  });

  it("sends a stranger to the key page, remembering where they were going", async () => {
    const res = await proxy(visit("/explore?tab=live"));
    expect(sentToTheKeyPage(res)).toBe(true);
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe("/explore?tab=live");
    expect(newPass(res)).toBeNull();
    expect(sentToTheKeyPage(await proxy(visit("/api/livekit", { method: "POST", header: "not.a.pass" })))).toBe(true);
  });

  it("lets a fresh pass through and leaves it as it is", async () => {
    const pass = await issuePass(CODE, "master");
    const res = await proxy(visit("/explore", { cookie: pass }));
    expect(res.status).toBe(200);
    expect(sentToTheKeyPage(res)).toBe(false);
    expect(newPass(res)).toBeNull();
  });

  it("hands a browser a fresh pass once its own is more than a day old", async () => {
    const old = await issuePass(CODE, KEY, Date.now() - 10 * DAY);
    const res = await proxy(visit("/explore", { cookie: old }));
    expect(res.status).toBe(200);
    const fresh = newPass(res);
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(old);
    expect(fresh!.split(".")[0]).toBe(KEY);
    expect(desk.asked).toBe(1);
    expect(await verifyPass(fresh!, CODE, Date.now() + 29 * DAY)).toBe(true);
    const cookie = res.cookies.get(BETA_COOKIE)!;
    expect(cookie.maxAge).toBe(BETA_COOKIE_MAX_AGE);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.path).toBe("/");
    // the profile shortcut is answered another way, and carries it too
    expect(newPass(await proxy(visit("/@jordan", { cookie: old })))).not.toBeNull();
  });

  it("renews when a page is opened, not on every request the page makes", async () => {
    const old = await issuePass(CODE, KEY, Date.now() - 10 * DAY);
    const res = await proxy(visit("/api/health-of-something", { cookie: old, fetches: true }));
    expect(sentToTheKeyPage(res)).toBe(false);
    expect(newPass(res)).toBeNull();
    expect(desk.asked).toBe(0);
  });

  it("stops renewing a person who has been revoked, and turns them away once the pass runs out", async () => {
    desk.welcome = false;
    const inDate = await issuePass(CODE, KEY, Date.now() - 10 * DAY);
    const res = await proxy(visit("/explore", { cookie: inDate }));
    expect(sentToTheKeyPage(res)).toBe(false);
    expect(newPass(res)).toBeNull();
    const lapsed = await issuePass(CODE, KEY, Date.now() - 31 * DAY);
    expect(sentToTheKeyPage(await proxy(visit("/explore", { cookie: lapsed })))).toBe(true);
    expect(sentToTheKeyPage(await proxy(visit("/api/livekit", { method: "POST", header: lapsed })))).toBe(true);
  });

  it("lets a pass that ran out a few days ago back in and renews it, but not one gone six weeks", async () => {
    const lapsed = await issuePass(CODE, "master", Date.now() - 33 * DAY);
    const res = await proxy(visit("/", { cookie: lapsed }));
    expect(sentToTheKeyPage(res)).toBe(false);
    expect(await verifyPass(newPass(res)!, CODE, Date.now() + 29 * DAY)).toBe(true);

    const gone = await issuePass(CODE, "master", Date.now() - 46 * DAY);
    const refused = await proxy(visit("/", { cookie: gone }));
    expect(sentToTheKeyPage(refused)).toBe(true);
    expect(newPass(refused)).toBeNull();
  });

  it("lets the phone app through on its header, without a cookie: it renews its own when it opens", async () => {
    const old = await issuePass(CODE, "master", Date.now() - 10 * DAY);
    const res = await proxy(visit("/api/livekit", { method: "POST", header: old }));
    expect(sentToTheKeyPage(res)).toBe(false);
    expect(newPass(res)).toBeNull();
    // the copy of the app that held a pass past its date is no longer turned away
    const lapsed = await issuePass(CODE, "master", Date.now() - 31 * DAY);
    expect(sentToTheKeyPage(await proxy(visit("/api/livekit", { method: "POST", header: lapsed })))).toBe(false);
  });

  it("never renews a pass it did not sign", async () => {
    const other = await issuePass("someone-else's-code", "master", Date.now() - 10 * DAY);
    const res = await proxy(visit("/explore", { cookie: other }));
    expect(sentToTheKeyPage(res)).toBe(true);
    expect(newPass(res)).toBeNull();
  });

  it("asks nothing of the key page itself, or of a site with the gate off", async () => {
    expect(sentToTheKeyPage(await proxy(visit("/beta")))).toBe(false);
    expect(sentToTheKeyPage(await proxy(visit("/api/beta/pass", { method: "POST" })))).toBe(false);
    delete process.env.BETA_INVITE_CODE;
    const open = await proxy(visit("/explore"));
    expect(sentToTheKeyPage(open)).toBe(false);
    expect(newPass(open)).toBeNull();
  });
});
