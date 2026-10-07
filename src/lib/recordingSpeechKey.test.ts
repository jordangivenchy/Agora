import { describe, expect, it } from "vitest";
import { mintSpeechKey, validSpeechKey } from "./recordingSpeechKey";

/* The recorder's pass for sending in who is speaking. */
const ROOM = "90dabdf2-c208-46c9-8417-b5070fba44a0";
const OTHER = "1ee8fb75-0000-4000-8000-000000000000";
const SECRET = "a-made-up-secret-for-tests";
const NOW = Date.UTC(2026, 9, 7, 18, 0, 0);

describe("the recorder's pass", () => {
  it("is good for the room it was made for", () => {
    const key = mintSpeechKey(ROOM, SECRET, NOW);
    expect(validSpeechKey(key, ROOM, SECRET, NOW + 60_000)).toBe(true);
  });

  it("travels in an address untouched", () => {
    const key = mintSpeechKey(ROOM, SECRET, NOW);
    expect(key).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    expect(new URL(`https://x.test/agora/${ROOM}?rk=${key}`).searchParams.get("rk")).toBe(key);
    expect(encodeURIComponent(key)).toBe(key);
  });

  it("is no good for another room, another secret, or once it has run out", () => {
    const key = mintSpeechKey(ROOM, SECRET, NOW);
    expect(validSpeechKey(key, OTHER, SECRET, NOW)).toBe(false);
    expect(validSpeechKey(key, ROOM, "another-secret", NOW)).toBe(false);
    expect(validSpeechKey(key, ROOM, SECRET, NOW + 37 * 3600 * 1000)).toBe(false);
    expect(validSpeechKey(key, ROOM, SECRET, NOW + 35 * 3600 * 1000)).toBe(true);
  });

  it("can't have its life extended", () => {
    const key = mintSpeechKey(ROOM, SECRET, NOW);
    const [exp, sig] = key.split(".");
    expect(validSpeechKey(`${Number(exp) + 86_400}.${sig}`, ROOM, SECRET, NOW)).toBe(false);
  });

  it("turns away anything that isn't a pass", () => {
    for (const bad of ["", "abc", "123.short", null, undefined, 42, {}]) {
      expect(validSpeechKey(bad, ROOM, SECRET, NOW)).toBe(false);
    }
  });
});
