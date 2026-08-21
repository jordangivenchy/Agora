/**
 * Pure helpers for the profile social-links editor.
 * Mirrors the server-side constraints: https(s) URLs only, ≤200 chars, max 5.
 */

export const MAX_SOCIAL_LINKS = 5;

const MAX_LINK_LENGTH = 200;

/**
 * Normalize a user-typed link.
 * - Trims whitespace.
 * - Prepends https:// for bare domains like "instagram.com/foo".
 * - Returns null when the result is empty, not http(s), or over 200 chars.
 */
export function normalizeSocialLink(raw: string): string | null {
  let link = raw.trim();
  if (!link) return null;
  if (!/^https?:\/\//i.test(link)) {
    // Reject anything with an explicit non-http scheme (javascript:, ftp:, …).
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return null;
    link = "https://" + link;
  }
  if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(link)) return null;
  if (link.length > MAX_LINK_LENGTH) return null;
  return link;
}

const HOST_LABELS: Record<string, string> = {
  "x.com": "X",
  "twitter.com": "X",
  "instagram.com": "Instagram",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "tiktok.com": "TikTok",
  "twitch.tv": "Twitch",
  "github.com": "GitHub",
  "discord.com": "Discord",
  "discord.gg": "Discord",
  "linkedin.com": "LinkedIn",
};

/** Short display label for a link, keyed by hostname. */
export function socialLinkLabel(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
  const bare = host.replace(/^www\./, "");
  return HOST_LABELS[bare] ?? bare;
}
