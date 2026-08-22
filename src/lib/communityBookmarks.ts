/**
 * Community Bookmarks: the text format moderators edit, and the JSON the
 * rail renders. Pure, so the parser is unit-tested.
 *
 *   Discord | https://discord.gg/agora       ← a plain link
 *   ## Social Links                          ← starts a dropdown group
 *   X | https://x.com/agora                  ← links under the group
 *   Instagram | https://instagram.com/agora
 */

export type BookmarkLink = { label: string; url: string };
export type Bookmark = BookmarkLink | { label: string; items: BookmarkLink[] };

export const MAX_BOOKMARKS = 12;
export const MAX_GROUP_ITEMS = 12;
const MAX_LABEL = 40;

function cleanLabel(s: string): string {
  return s.trim().slice(0, MAX_LABEL);
}

function cleanUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname.includes(".")) return null;
    return withScheme.length <= 500 ? withScheme : null;
  } catch {
    return null;
  }
}

export function isGroup(b: Bookmark): b is { label: string; items: BookmarkLink[] } {
  return "items" in b;
}

/** Parse the editor text. Invalid lines are dropped; empty groups vanish. */
export function parseBookmarks(text: string): Bookmark[] {
  const out: Bookmark[] = [];
  let group: { label: string; items: BookmarkLink[] } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("##")) {
      const label = cleanLabel(line.replace(/^#+/, ""));
      group = label ? { label, items: [] } : null;
      if (group) out.push(group);
      continue;
    }
    const sep = line.indexOf("|");
    const label = cleanLabel(sep === -1 ? line : line.slice(0, sep));
    const url = cleanUrl(sep === -1 ? "" : line.slice(sep + 1));
    if (!label || !url) continue;
    const link = { label, url };
    if (group && group.items.length < MAX_GROUP_ITEMS) group.items.push(link);
    else if (!group) out.push(link);
  }
  return out.filter((b) => !isGroup(b) || b.items.length > 0).slice(0, MAX_BOOKMARKS);
}

/** Inverse of parseBookmarks, for seeding the editor. */
export function formatBookmarks(bookmarks: Bookmark[]): string {
  const lines: string[] = [];
  for (const b of bookmarks) {
    if (isGroup(b)) {
      lines.push(`## ${b.label}`);
      for (const it of b.items) lines.push(`${it.label} | ${it.url}`);
    } else {
      lines.push(`${b.label} | ${b.url}`);
    }
  }
  return lines.join("\n");
}

/** Trust nothing about jsonb from the DB. */
export function safeBookmarks(raw: unknown): Bookmark[] {
  if (!Array.isArray(raw)) return [];
  const link = (x: unknown): BookmarkLink | null => {
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    if (typeof o.label !== "string" || typeof o.url !== "string" || !/^https?:\/\//i.test(o.url)) return null;
    return { label: o.label, url: o.url };
  };
  const out: Bookmark[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (Array.isArray(o.items) && typeof o.label === "string") {
      const items = o.items.map(link).filter((l): l is BookmarkLink => !!l);
      if (items.length) out.push({ label: o.label, items });
    } else {
      const l = link(x);
      if (l) out.push(l);
    }
  }
  return out.slice(0, MAX_BOOKMARKS);
}
