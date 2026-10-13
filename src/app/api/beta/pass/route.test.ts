import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BETA_COOKIE, BETA_COOKIE_MAX_AGE, issuePass, verifyPass } from "@/lib/betaGate";

/* The key desk: whether a key's person is still welcome. */
const desk = vi.hoisted(() => ({ welcome: true }));
vi.mock("@/lib/betaKeys", () => ({ keyStillStands: async () => desk.welcome }));

import { POST } from "./route";

const CODE = "the-master-code";
const DAY = 86400_000;
const KEY = "3f7b2c1e-0000-4000-8000-000000000001";
const ask = (body: unknown) => POST(new Request("https://agorasphere.net/api/beta/pass", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").match(new RegExp(`${BETA_COOKIE}=([^;]+)`))?.[1] ?? null;

describe("the app keeping its pass alive", () => {
  const saved = process.env.BETA_INVITE_CODE;
  beforeEach(() => { process.env.BETA_INVITE_CODE = CODE; desk.welcome = true; });
  afterEach(() => {
    if (saved === undefined) delete process.env.BETA_INVITE_CODE;
    else process.env.BETA_INVITE_CODE = saved;
  });

  it("gives back the same pass on its first day, and sets it as the cookie", async () => {
    const pass = await issuePass(CODE, "master");
    const res = await ask({ pass });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pass });
    expect(cookieOf(res)).toBe(pass);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`Max-Age=${BETA_COOKIE_MAX_AGE}`, "i"));
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("gives back a fresh one for a pass more than a day old, for the same holder", async () => {
    const old = await issuePass(CODE, KEY, Date.now() - 12 * DAY);
    const res = await ask({ pass: old });
    const body = (await res.json()) as { ok: boolean; pass: string };
    expect(res.status).toBe(200);
    expect(body.pass).not.toBe(old);
    expect(body.pass.split(".")[0]).toBe(KEY);
    expect(await verifyPass(body.pass, CODE, Date.now() + 29 * DAY)).toBe(true);
    expect(cookieOf(res)).toBe(body.pass);
  });

  it("gives one back for a pass that ran out a few days ago: the phone that was turned away", async () => {
    const lapsed = await issuePass(CODE, "master", Date.now() - 31 * DAY);
    const res = await ask({ pass: lapsed });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pass: string };
    expect(await verifyPass(lapsed, CODE)).toBe(false);
    expect(await verifyPass(body.pass, CODE)).toBe(true);
  });

  it("says no to a pass that is long gone, forged, or missing, so the app asks for a key", async () => {
    const gone = await issuePass(CODE, "master", Date.now() - 46 * DAY);
    for (const body of [{ pass: gone }, { pass: "someone.1.00" }, { pass: 42 }, {}]) {
      const res = await ask(body);
      expect(res.status, JSON.stringify(body)).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_pass" });
      expect(cookieOf(res)).toBeNull();
    }
    expect((await ask("not json")).status).toBe(400);
  });

  it("does not renew a revoked person, and turns them away once the pass has run out", async () => {
    desk.welcome = false;
    const inDate = await issuePass(CODE, KEY, Date.now() - 12 * DAY);
    const kept = await ask({ pass: inDate });
    expect(kept.status).toBe(200);
    expect(await kept.json()).toEqual({ ok: true, pass: inDate });
    const lapsed = await issuePass(CODE, KEY, Date.now() - 31 * DAY);
    expect((await ask({ pass: lapsed })).status).toBe(401);
  });

  it("asks nothing when the gate is off", async () => {
    delete process.env.BETA_INVITE_CODE;
    const res = await ask({ pass: "anything" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
