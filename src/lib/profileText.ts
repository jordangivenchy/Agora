/**
 * Profile text hygiene — normalization + a conservative blocklist.
 *
 * Mirrors the server-side rules in
 * supabase/migrations/20260847_profile_text_hygiene.sql
 * (normalize_profile_text / text_has_blocked_term). Keep the two in sync:
 * the client runs these for instant feedback, the definer RPCs are the
 * actual gate.
 */

export const DISPLAY_NAME_MAX = 40;
export const BIO_MAX = 300;
export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

import { BLOCKED, findBlockedTerm, foldObfuscation } from "./cleanText";
const BLOCKED_TERMS: readonly string[] = BLOCKED.map(([t]) => t);

/* C0 / C1 controls (minus \t \n \r, handled per-field) + zero-width and
   bidi/format characters that let users forge look-alike names or hide text. */
const STRIP_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g;

function stripInvisible(s: string): string {
  return s.normalize("NFC").replace(STRIP_RE, "");
}

/** NFC, strip controls/zero-width, collapse whitespace, trim, cap 40. */
export function normalizeDisplayName(s: string): string {
  return stripInvisible(s).replace(/\s+/g, " ").trim().slice(0, DISPLAY_NAME_MAX);
}

/**
 * NFC, strip controls/zero-width, normalize line endings, collapse spaces /
 * tabs within a line, trim line ends, max 2 consecutive newlines, trim, cap 300.
 */
export function normalizeBio(s: string): string {
  return stripInvisible(s)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, BIO_MAX);
}

/** Same rules as the modal input filter: lowercase, [a-z0-9_], max 20. */
export function normalizeUsername(s: string): string {
  return stripInvisible(s).trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

/* The blocklist and the matcher live in cleanText.ts (one list, with a
   severity per term, shared with every composer); profile text is a
   "name" surface: every term counts. Re-exported so nothing that imported
   them from here has to move. */
export { BLOCKED_TERMS, findBlockedTerm, foldObfuscation };

export type ProfileTextInput = {
  displayName?: string | null;
  bio?: string | null;
  username?: string | null;
};

export type ProfileTextResult =
  | { ok: true; values: { displayName: string; bio: string; username: string } }
  | { ok: false; field: keyof ProfileTextInput; message: string };

/** Normalize + validate every user-editable profile text field. */
export function validateProfileText(input: ProfileTextInput): ProfileTextResult {
  const displayName = normalizeDisplayName(input.displayName ?? "");
  const bio = normalizeBio(input.bio ?? "");
  const username = normalizeUsername(input.username ?? "");

  if (input.username != null && !USERNAME_REGEX.test(username)) {
    return {
      ok: false,
      field: "username",
      message: "Username must be 3–20 chars, lowercase letters, numbers, or underscores.",
    };
  }
  if (findBlockedTerm(username)) {
    return { ok: false, field: "username", message: "Username contains a blocked term." };
  }
  if (findBlockedTerm(displayName)) {
    return { ok: false, field: "displayName", message: "Display name contains a blocked term." };
  }
  if (findBlockedTerm(bio)) {
    return { ok: false, field: "bio", message: "Bio contains a blocked term." };
  }
  return { ok: true, values: { displayName, bio, username } };
}

/** Map server error strings (from the update_profile* RPCs) to copy. */
export function friendlyProfileError(msg: string): string | null {
  if (msg.includes("username_cooldown")) return "You can only change your username once every 7 days.";
  if (msg.includes("username_taken")) return "That username is already taken.";
  if (msg.includes("invalid_username"))
    return "Username must be 3–20 chars, lowercase letters, numbers, or underscores.";
  if (msg.includes("display_name_too_long")) return `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.`;
  if (msg.includes("bio_too_long")) return `Bio must be ${BIO_MAX} characters or fewer.`;
  if (msg.includes("blocked_term")) return "Contains a blocked term.";
  return null;
}
