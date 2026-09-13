/* Profile text hygiene, the site's rules (lib/profileText.ts): the
   server's definer RPCs are the gate; these give the editor an answer
   before the round trip. */
import { findBlockedTerm } from "./cleanText";

export const DISPLAY_NAME_MAX = 40;
export const BIO_MAX = 300;
export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

/* C0 / C1 controls (minus tab and newlines) plus the zero-width and bidi characters. */
const STRIP_RE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202F\\u2060-\\u206F\\uFEFF]", "g");
function stripInvisible(s: string): string {
  return s.normalize("NFC").replace(STRIP_RE, "");
}

export function normalizeDisplayName(s: string): string {
  return stripInvisible(s).replace(/\s+/g, " ").trim().slice(0, DISPLAY_NAME_MAX);
}

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

export function normalizeUsername(s: string): string {
  return stripInvisible(s).trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

export { findBlockedTerm };

export function friendlyProfileError(msg: string): string | null {
  if (msg.includes("username_cooldown")) return "You can only change your username once every 7 days.";
  if (msg.includes("username_taken")) return "That username is already taken.";
  if (msg.includes("invalid_username")) return "Username must be 3–20 chars, lowercase letters, numbers, or underscores.";
  if (msg.includes("display_name_too_long")) return `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.`;
  if (msg.includes("bio_too_long")) return `Bio must be ${BIO_MAX} characters or fewer.`;
  if (msg.includes("blocked_term")) return "Contains a blocked term.";
  return null;
}

/* Social links: https only, 200 chars, five at most (lib/socialLinks.ts). */
export const MAX_SOCIAL_LINKS = 5;
const MAX_LINK_LENGTH = 200;

export function normalizeSocialLink(raw: string): string | null {
  let link = raw.trim();
  if (!link) return null;
  if (!/^https?:\/\//i.test(link)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return null;
    link = "https://" + link;
  }
  if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(link)) return null;
  if (link.length > MAX_LINK_LENGTH) return null;
  return link;
}

const HOST_LABELS: Record<string, string> = {
  "x.com": "X", "twitter.com": "X", "instagram.com": "Instagram", "youtube.com": "YouTube", "youtu.be": "YouTube",
  "tiktok.com": "TikTok", "twitch.tv": "Twitch", "github.com": "GitHub", "discord.com": "Discord", "discord.gg": "Discord", "linkedin.com": "LinkedIn",
};

export function socialLinkLabel(url: string): string {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return url; }
  const bare = host.replace(/^www\./, "");
  return HOST_LABELS[bare] ?? bare;
}
