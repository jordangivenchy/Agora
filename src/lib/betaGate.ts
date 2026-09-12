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
   Everything here is Web-Crypto only, so it runs at the edge. */

export const BETA_COOKIE = "agora_beta";
export const BETA_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
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

/** A pass for `who` (a key's id, or "master"), good for 30 days. */
export async function issuePass(code: string, who: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + BETA_COOKIE_MAX_AGE;
  const body = `${who}.${exp}`;
  const sig = hex(await crypto.subtle.sign("HMAC", await passSecret(code), enc.encode(body)));
  return `${body}.${sig}`;
}

/** True for a pass this code issued that has not expired, or a legacy pass. */
export async function verifyPass(value: string | undefined, code: string, now = Date.now()): Promise<boolean> {
  if (!value) return false;
  if (value === (await sha256Hex(code))) return true;
  const m = value.match(/^([A-Za-z0-9_-]{1,64})\.(\d{1,12})\.([0-9a-f]{64})$/);
  if (!m || Number(m[2]) * 1000 < now) return false;
  try {
    return await crypto.subtle.verify("HMAC", await passSecret(code), unhex(m[3]), enc.encode(`${m[1]}.${m[2]}`));
  } catch {
    return false;
  }
}
