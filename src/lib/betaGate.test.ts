import { describe, it, expect } from "vitest";
import { BETA_COOKIE_MAX_AGE, BETA_PASS_GRACE, admitPass, hashBetaKey, issuePass, keysPerTester, looksLikeBetaKey, newBetaKey, normalizeBetaKey, readPass, sha256Hex, verifyPass } from "./betaGate";

describe("one-time keys", () => {
  it("look like AGORA-XXXX-XXXX from the unambiguous alphabet, and differ", () => {
    const keys = Array.from({ length: 50 }, newBetaKey);
    for (const k of keys) expect(k).toMatch(/^AGORA-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/);
    expect(new Set(keys).size).toBe(50);
    expect(keys.map((k) => k.slice("AGORA-".length)).join("")).not.toMatch(/[01IO]/);
  });

  it("forgive how people type them", () => {
    expect(normalizeBetaKey(" agora-7k2m q9xd ")).toBe("AGORA7K2MQ9XD");
    expect(looksLikeBetaKey("agora 7k2m-q9xd")).toBe(true);
    expect(looksLikeBetaKey("AGORA-7K2M-Q9X1")).toBe(false);
    expect(looksLikeBetaKey("the master code")).toBe(false);
  });

  it("hash the same however they were typed", async () => {
    expect(await hashBetaKey("AGORA-7K2M-Q9XD")).toBe(await hashBetaKey("agora7k2mq9xd"));
    expect(await hashBetaKey("AGORA-7K2M-Q9XD")).not.toBe(await hashBetaKey("AGORA-7K2M-Q9XE"));
    expect(await hashBetaKey("AGORA-7K2M-Q9XD")).not.toBe(await sha256Hex("AGORA7K2MQ9XD"));
  });

  it("allow three per tester unless told otherwise", () => {
    const saved = process.env.BETA_KEYS_PER_TESTER;
    delete process.env.BETA_KEYS_PER_TESTER;
    expect(keysPerTester()).toBe(3);
    process.env.BETA_KEYS_PER_TESTER = "5";
    expect(keysPerTester()).toBe(5);
    process.env.BETA_KEYS_PER_TESTER = "nonsense";
    expect(keysPerTester()).toBe(3);
    if (saved === undefined) delete process.env.BETA_KEYS_PER_TESTER;
    else process.env.BETA_KEYS_PER_TESTER = saved;
  });
});

describe("passes", () => {
  const CODE = "the-master-code";
  const now = Date.parse("2026-09-12T12:00:00Z");

  it("issue and verify, for a key and for the master", async () => {
    const pass = await issuePass(CODE, "3f7b2c1e-0000-4000-8000-000000000001", now);
    expect(pass).toMatch(/^3f7b2c1e-0000-4000-8000-000000000001\.\d+\.[0-9a-f]{64}$/);
    expect(await verifyPass(pass, CODE, now)).toBe(true);
    expect(await verifyPass(await issuePass(CODE, "master", now), CODE, now + 1000)).toBe(true);
  });

  const DAY = 86400_000;
  const KEY = "3f7b2c1e-0000-4000-8000-000000000001";
  const expOf = (pass: string) => Number(pass.split(".")[1]);
  /* The key desk, stood in for: everyone is welcome, or nobody is. */
  const welcome = { mayRenew: async () => true };
  const revoked = { mayRenew: async () => false };

  it("go out of date after thirty days", async () => {
    expect(BETA_COOKIE_MAX_AGE).toBe(30 * 86400);
    const pass = await issuePass(CODE, "master", now);
    expect(await verifyPass(pass, CODE, now + 29 * DAY)).toBe(true);
    expect(await verifyPass(pass, CODE, now + 31 * DAY)).toBe(false);
  });

  it("read as live, lapsed or bad, and as old after a day", async () => {
    expect(BETA_PASS_GRACE).toBe(14 * 86400);
    const pass = await issuePass(CODE, KEY, now);
    expect(await readPass(pass, CODE, now)).toEqual({ state: "live", who: KEY, old: false });
    expect(await readPass(pass, CODE, now + DAY - 5000)).toEqual({ state: "live", who: KEY, old: false });
    expect(await readPass(pass, CODE, now + DAY + 5000)).toEqual({ state: "live", who: KEY, old: true });
    expect(await readPass(pass, CODE, now + 31 * DAY)).toEqual({ state: "lapsed", who: KEY, old: true });
    expect(await readPass(pass, CODE, now + 44 * DAY - 5000)).toEqual({ state: "lapsed", who: KEY, old: true });
    expect(await readPass(pass, CODE, now + 44 * DAY + 5000)).toEqual({ state: "bad" });
    expect(await readPass(await sha256Hex(CODE), CODE, now + 400 * DAY)).toEqual({ state: "live", who: null, old: false });
  });

  it("are left alone on their first day, then renewed for the same holder on a visit", async () => {
    const pass = await issuePass(CODE, KEY, now);
    expect(await admitPass(pass, CODE, { ...welcome, now })).toEqual({ valid: true, renew: null });
    expect(await admitPass(pass, CODE, { ...welcome, now: now + DAY - 5000 })).toEqual({ valid: true, renew: null });

    const later = now + 2 * DAY;
    const seen = await admitPass(pass, CODE, { ...welcome, now: later });
    expect(seen.valid).toBe(true);
    expect(seen.renew).not.toBe(pass);
    expect(seen.renew!.split(".")[0]).toBe(KEY);
    expect(expOf(seen.renew!)).toBe(Math.floor(later / 1000) + BETA_COOKIE_MAX_AGE);
    // the fresh one stands by itself, and is new enough not to be renewed again that day
    expect(await admitPass(seen.renew!, CODE, { ...welcome, now: later })).toEqual({ valid: true, renew: null });
    // a caller that isn't handing passes back (anything but opening a page) gets none
    expect(await admitPass(pass, CODE, { ...welcome, renew: false, now: later })).toEqual({ valid: true, renew: null });
  });

  it("never run out for someone who comes back once a week", async () => {
    let held = await issuePass(CODE, KEY, now);
    for (let week = 1; week <= 30; week++) {
      const r = await admitPass(held, CODE, { ...welcome, now: now + week * 7 * DAY });
      expect(r.valid, `week ${week}`).toBe(true);
      held = r.renew ?? held;
    }
    expect(await verifyPass(held, CODE, now + 30 * 7 * DAY)).toBe(true);
  });

  it("can be traded for a fresh one for two weeks after running out, and not after", async () => {
    const pass = await issuePass(CODE, KEY, now);
    const back = now + 35 * DAY;
    const r = await admitPass(pass, CODE, { ...welcome, now: back });
    expect(r.valid).toBe(true);
    expect(expOf(r.renew!)).toBe(Math.floor(back / 1000) + BETA_COOKIE_MAX_AGE);
    expect(await verifyPass(r.renew!, CODE, back + 29 * DAY)).toBe(true);
    // a lapsed pass is let through even where no fresh one is being handed back: the app from before it learned to renew
    expect((await admitPass(pass, CODE, { ...welcome, renew: false, now: back })).valid).toBe(true);
    expect(await admitPass(pass, CODE, { ...welcome, now: now + 45 * DAY })).toEqual({ valid: false, renew: null });
  });

  it("are not renewed once the key's person is revoked: the pass runs out as it always did", async () => {
    const pass = await issuePass(CODE, KEY, now);
    // still in date: let through, but nothing fresh
    expect(await admitPass(pass, CODE, { ...revoked, now: now + 10 * DAY })).toEqual({ valid: true, renew: null });
    expect(await admitPass(pass, CODE, { ...revoked, now: now + 29 * DAY })).toEqual({ valid: true, renew: null });
    // out of date: turned away, no two weeks of grace
    expect(await admitPass(pass, CODE, { ...revoked, now: now + 31 * DAY })).toEqual({ valid: false, renew: null });
    // the desk out of reach reads the same as "no"
    const unreachable = { mayRenew: async () => { throw new Error("down"); } };
    expect(await admitPass(pass, CODE, { ...unreachable, now: now + 10 * DAY })).toEqual({ valid: true, renew: null });
    expect(await admitPass(pass, CODE, { ...unreachable, now: now + 31 * DAY })).toEqual({ valid: false, renew: null });
  });

  it("renew the team's own passes without asking the desk", async () => {
    let asked = 0;
    const desk = { mayRenew: async () => { asked += 1; return false; } };
    const pass = await issuePass(CODE, "master", now);
    const r = await admitPass(pass, CODE, { ...desk, now: now + 33 * DAY });
    expect(r.valid).toBe(true);
    expect(r.renew!.split(".")[0]).toBe("master");
    expect(asked).toBe(0);
  });

  it("never renew what does not verify", async () => {
    const pass = await issuePass(CODE, "master", now);
    const [who, exp, sig] = pass.split(".");
    const later = now + 3 * DAY;
    for (const forged of [`${who}.${Number(exp) + 86400 * 365}.${sig}`, `someone-else.${exp}.${sig}`, `${who}.${exp}.${"0".repeat(64)}`, "garbage", "", undefined]) {
      expect(await admitPass(forged, CODE, { ...welcome, now: later }), String(forged)).toEqual({ valid: false, renew: null });
    }
    // a pass from another code is nobody's, however fresh
    expect(await admitPass(pass, "a-new-code", { ...welcome, now: later })).toEqual({ valid: false, renew: null });
    // a pass from before this scheme opens the door but names nobody to renew
    expect(await admitPass(await sha256Hex(CODE), CODE, { ...welcome, now: later })).toEqual({ valid: true, renew: null });
  });

  it("die when the code rotates, and refuse tampering", async () => {
    const pass = await issuePass(CODE, "master", now);
    expect(await verifyPass(pass, "a-new-code", now)).toBe(false);
    const [who, exp, sig] = pass.split(".");
    expect(await verifyPass(`${who}.${Number(exp) + 86400 * 365}.${sig}`, CODE, now)).toBe(false);
    expect(await verifyPass(`someone-else.${exp}.${sig}`, CODE, now)).toBe(false);
    expect(await verifyPass(`${who}.${exp}.${"0".repeat(64)}`, CODE, now)).toBe(false);
    expect(await verifyPass("garbage", CODE, now)).toBe(false);
    expect(await verifyPass(undefined, CODE, now)).toBe(false);
  });

  it("still honour the passes issued before this scheme", async () => {
    expect(await verifyPass(await sha256Hex(CODE), CODE, now)).toBe(true);
    expect(await verifyPass(await sha256Hex("other"), CODE, now)).toBe(false);
  });
});
