/* The recorder's pass for telling us who is speaking. When a recording
   part starts (lib/recordingEgress) its page address carries `rk`, and
   the page LiveKit films posts what it sees with it
   (/api/internal/recording-speech). The pass is good for one room, for a
   day and a half; it lets its holder do that one thing. Server-only
   (node:crypto). */

import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_SECONDS = 36 * 3600;

function sign(roomId: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`recording-speech\n${roomId}\n${exp}`).digest("base64url");
}

/** `<expiry in epoch seconds>.<signature>` — nothing in it needs escaping in an address. */
export function mintSpeechKey(roomId: string, secret: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + TTL_SECONDS;
  return `${exp}.${sign(roomId, exp, secret)}`;
}

export function validSpeechKey(key: unknown, roomId: string, secret: string, nowMs = Date.now()): boolean {
  if (typeof key !== "string") return false;
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{20,64})$/.exec(key);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!(exp * 1000 > nowMs)) return false;
  const want = Buffer.from(sign(roomId, exp, secret));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got);
}
