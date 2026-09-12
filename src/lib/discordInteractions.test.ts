import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { asksForBetaKey, verifyDiscordRequest } from "./discordInteractions";

/* A throwaway Ed25519 pair, exported the way Discord shows its public
   key: 32 raw bytes as hex. */
function pair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { privateKey, publicHex: spki.subarray(spki.length - 32).toString("hex") };
}

describe("verifyDiscordRequest", () => {
  const { privateKey, publicHex } = pair();
  const body = JSON.stringify({ type: 1 });
  const ts = "1789172411";
  const sig = sign(null, Buffer.from(ts + body), privateKey).toString("hex");

  it("accepts a request Discord signed", () => {
    expect(verifyDiscordRequest(publicHex, sig, ts, body)).toBe(true);
  });

  it("refuses a changed body, timestamp, or key", () => {
    expect(verifyDiscordRequest(publicHex, sig, ts, body + " ")).toBe(false);
    expect(verifyDiscordRequest(publicHex, sig, "1789172412", body)).toBe(false);
    expect(verifyDiscordRequest(pair().publicHex, sig, ts, body)).toBe(false);
  });

  it("refuses missing or malformed pieces without throwing", () => {
    expect(verifyDiscordRequest(publicHex, null, ts, body)).toBe(false);
    expect(verifyDiscordRequest(publicHex, sig, null, body)).toBe(false);
    expect(verifyDiscordRequest("nothex", sig, ts, body)).toBe(false);
    expect(verifyDiscordRequest(publicHex, "deadbeef", ts, body)).toBe(false);
  });
});

describe("asksForBetaKey", () => {
  it("knows the button and the command, and nothing else", () => {
    expect(asksForBetaKey({ type: 3, data: { custom_id: "beta-key" } })).toBe(true);
    expect(asksForBetaKey({ type: 2, data: { name: "beta" } })).toBe(true);
    expect(asksForBetaKey({ type: 2, data: { name: "ping" } })).toBe(false);
    expect(asksForBetaKey({ type: 3, data: { custom_id: "other" } })).toBe(false);
    expect(asksForBetaKey({ type: 1 })).toBe(false);
  });
});
