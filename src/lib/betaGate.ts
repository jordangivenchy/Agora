/* Closed-beta gate shared between the proxy, /api/beta and the Discord
   key desk.

   The gate is armed by setting BETA_INVITE_CODE (Vercel env / .env.local);
   leave it unset and the site is fully open — local dev and preview builds
   keep working with zero setup.

   Two ways through the door:
     - the master code itself (the team's; never shown to testers), and
     - one-time keys, minted per Discord account by the "Get my beta key"
       button (lib/betaKeys). A key works once, on one device, and dies
       after 48 hours unused. Three per person unless BETA_KEYS_PER_TESTER
       says otherwise.

   A pass is a cookie `who.exp.sig`, signed with a secret derived from the
   master code, so the proxy checks it without a database and rotating
   the code ends every pass at once. Passes from before this scheme (a
   SHA-256 of the code) stay valid until they expire on their own.
   Everything here is Web-Crypto only, so it runs at the edge.

   A pass lasts 30 days from the last visit, not from the day the key
   was used: a visit past its first day hands back a fresh one (the
   proxy for a browser, api/beta/pass for the phone app), unless the
   key's person has been revoked. It used to run out 30 days after the
   key whatever the person did, which locked the most regular testers
   out once a month and left the app holding a dead pass it could not
   tell from a live one: rooms were made and then could not be joined. */

export const BETA_COOKIE = "agora_beta";
export const BETA_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
/* A pass that has run out can still be traded for a fresh one for this
   long: someone back from a few weeks away doesn't need a new key, and a
   copy of the app from before it learned to renew is not stranded. */
export const BETA_PASS_GRACE = 60 * 60 * 24 * 14; // 14 days
/* How old a pass gets before a visit renews it: at most once a day. */
const RENEW_AFTER = 60 * 60 * 24;

/** How the pass is kept in a browser. */
export const passCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: BETA_COOKIE_MAX_AGE,
  path: "/",
});
export const BETA_KEY_TTL_MS = 48 * 60 * 60 * 1000; // unredeemed keys die after this

/** How many one-time keys one Discord account may redeem: one per device. */
export function keysPerTester(): number {
  const n = Number(process.env.BETA_KEYS_PER_TESTER ?? 3);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

const enc = new TextEncoder();

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const unhex = (s: string) => new Uint8Array((s.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));

/* Web-crypto (edge-safe) SHA-256 hex digest. */
export async function sha256Hex(input: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}

/* ── One-time keys ────────────────────────────────────────────────── */

/* No 0/O, 1/I: a key read out loud or typed from a phone survives. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A fresh key, AGORA-XXXX-XXXX. 32^8 of them. */
export function newBetaKey(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `AGORA-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** What people type, forgiven: case, spaces, dashes. */
export function normalizeBetaKey(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Keys are stored hashed; this is the lookup value. */
export async function hashBetaKey(plain: string): Promise<string> {
  return sha256Hex(`key:${normalizeBetaKey(plain)}`);
}

/** Does this look like one of our keys, before hitting the database? */
export function looksLikeBetaKey(s: string): boolean {
  return /^AGORA[23456789A-HJ-NP-Z]{8}$/.test(normalizeBetaKey(s));
}

/* ── Passes ───────────────────────────────────────────────────────── */

async function passSecret(code: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(`pass:${code}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** A pass for `who` (a key's id, or "master"), good for 30 days from now. */
export async function issuePass(code: string, who: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + BETA_COOKIE_MAX_AGE;
  const body = `${who}.${exp}`;
  const sig = hex(await crypto.subtle.sign("HMAC", await passSecret(code), enc.encode(body)));
  return `${body}.${sig}`;
}

/** What a pass says, before anyone is asked about its holder. */
export type PassRead =
  | { state: "bad" }
  /** live: in date. lapsed: out of date, but not for longer than the grace. */
  | { state: "live" | "lapsed"; who: string | null; old: boolean };

/**
 * Reads a pass. "bad" is anything this code did not sign, or that has been
 * out of date for longer than the grace. `who` is the holder (a key's id
 * or "master"; null for a legacy pass, which names nobody). `old` is more
 * than a day since it was issued: time for a fresh one.
 */
export async function readPass(value: string | undefined, code: string, now = Date.now()): Promise<PassRead> {
  if (!value) return { state: "bad" };
  if (value === (await sha256Hex(code))) return { state: "live", who: null, old: false };
  const m = value.match(/^([A-Za-z0-9_-]{1,64})\.(\d{1,12})\.([0-9a-f]{64})$/);
  if (!m) return { state: "bad" };
  const exp = Number(m[2]);
  const nowSeconds = Math.floor(now / 1000);
  if (exp + BETA_PASS_GRACE < nowSeconds) return { state: "bad" };
  let signed = false;
  try {
    signed = await crypto.subtle.verify("HMAC", await passSecret(code), unhex(m[3]), enc.encode(`${m[1]}.${m[2]}`));
  } catch {
    signed = false;
  }
  if (!signed) return { state: "bad" };
  return { state: exp < nowSeconds ? "lapsed" : "live", who: m[1], old: exp - nowSeconds <= BETA_COOKIE_MAX_AGE - RENEW_AFTER };
}

/**
 * Lets a pass through the door, or not, and says whether to hand back a
 * fresh one in its place.
 *
 * A pass in date is always let through. Once it is a day old (and the
 * caller wants renewals: `renew`), or when it has lapsed, the holder is
 * checked: the master code's passes always stand; a key's stand unless
 * its person has been revoked, which only the key desk knows
 * (`mayRenew`, lib/betaKeys). A holder who may not be renewed keeps the
 * pass they have until it runs out, as before, and a lapsed one is
 * turned away: revoking someone still ends their devices within 30 days.
 */
export async function admitPass(
  value: string | undefined,
  code: string,
  opts: { mayRenew: (who: string) => Promise<boolean>; renew?: boolean; now?: number },
): Promise<{ valid: boolean; renew: string | null }> {
  const now = opts.now ?? Date.now();
  const read = await readPass(value, code, now);
  if (read.state === "bad") return { valid: false, renew: null };
  const live = read.state === "live";
  if (live && (!read.old || opts.renew === false)) return { valid: true, renew: null };
  const who = read.who;
  const stands = who !== null && (who === "master" || (await opts.mayRenew(who).catch(() => false)));
  if (!stands) return { valid: live, renew: null };
  return { valid: true, renew: await issuePass(code, who, now) };
}

/** True for a pass that is in date (or a legacy pass): it opens the door with no questions asked. */
export async function verifyPass(value: string | undefined, code: string, now = Date.now()): Promise<boolean> {
  return (await readPass(value, code, now)).state === "live";
}
