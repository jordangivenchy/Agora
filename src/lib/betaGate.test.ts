import { describe, it, expect } from "vitest";
import { hashBetaKey, issuePass, keysPerTester, looksLikeBetaKey, newBetaKey, normalizeBetaKey, sha256Hex, verifyPass } from "./betaGate";

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

  it("expire after thirty days", async () => {
    const pass = await issuePass(CODE, "master", now);
    expect(await verifyPass(pass, CODE, now + 29 * 86400_000)).toBe(true);
    expect(await verifyPass(pass, CODE, now + 31 * 86400_000)).toBe(false);
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
