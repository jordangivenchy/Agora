/* Closed-beta gate shared between the proxy and /api/beta.

   The gate is armed by setting BETA_INVITE_CODE (Vercel env / .env.local);
   leave it unset and the site is fully open — local dev and preview builds
   keep working with zero setup. The pass cookie stores a SHA-256 of the
   code, so rotating the code instantly invalidates every issued pass. */

export const BETA_COOKIE = "agora_beta";
export const BETA_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/* Web-crypto (edge-safe) SHA-256 hex digest. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
