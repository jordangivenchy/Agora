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

/**
 * Conservative blocklist: unambiguous slurs + hard profanity only. Terms are
 * matched on word boundaries AFTER obfuscation folding (leetspeak, spaced /
 * dotted letters), so "assistant", "class", "Scunthorpe" never trip it.
 * Moderators: extend freely; mirror additions in public.blocked_terms.
 */
export const BLOCKED_TERMS: readonly string[] = [
  // racial / ethnic
  "nigger", "nigga", "niggers", "niggas",
  "chink", "chinks", "gook", "gooks", "spic", "spics", "wetback", "wetbacks",
  "kike", "kikes", "raghead", "ragheads", "towelhead", "towelheads",
  "beaner", "beaners", "darkie", "darkies",
  "paki", "pakis", "zipperhead", "porchmonkey", "jigaboo", "sandnigger",
  // homophobic / transphobic
  "faggot", "faggots", "dyke", "dykes",
  "tranny", "trannies", "shemale", "shemales",
  // ableist
  "retard", "retards", "retarded", "spaz", "mongoloid",
  // hard profanity
  "fuck", "fucks", "fucker", "fuckers", "fucking", "motherfucker", "motherfuckers",
  "cunt", "cunts", "cocksucker", "cocksuckers",
];

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s", "!": "i", "|": "l", "+": "t",
};

/**
 * Fold common obfuscations so the blocklist can be matched on word
 * boundaries:
 *   - NFKD + strip diacritics (fück → fuck)
 *   - lowercase
 *   - leetspeak digits/symbols → letters (n1gg3r → nigger)
 *   - separators between SINGLE letters removed (f.u.c.k / f u c k → fuck)
 *     but kept between real words ("class hole" stays two words)
 */
export function foldObfuscation(s: string): string {
  let t = s.normalize("NFKD").replace(/[\u0300-\u036F]/g, "").toLowerCase();
  t = t.replace(/[0134578@$!|+]/g, (c) => LEET[c] ?? c);
  // Collapse "a b c" / "a.b.c" / "a-b-c" / "a*b*c" runs of single letters.
  const sep = /(?<![a-z])([a-z])(?:[\s._\-*]+([a-z])(?![a-z]))+/g;
  t = t.replace(sep, (m) => m.replace(/[\s._\-*]+/g, ""));
  return t;
}

/** Returns the blocked term matched in `s` (post-folding), or null. */
export function findBlockedTerm(s: string): string | null {
  if (!s) return null;
  const folded = foldObfuscation(s);
  for (const term of BLOCKED_TERMS) {
    const re = new RegExp(`(?<![a-z])${term}(?![a-z])`, "i");
    if (re.test(folded)) return term;
  }
  return null;
}

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
