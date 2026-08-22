/* Client-side community slugs for /communities/<slug>.
   Slugs are derived from the name (no DB column), so they're resolved
   against the loaded communities list. Collisions get a short id suffix
   on the later entries (list order); a raw uuid is always accepted too. */

export const SLUG_MAX = 60;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sluggable = { id: string; name: string };

export function communitySlug(c: Sluggable, all: readonly Sluggable[]): string {
  const base = slugify(c.name) || c.id.slice(0, 6);
  const first = all.find((x) => (slugify(x.name) || x.id.slice(0, 6)) === base);
  if (!first || first.id === c.id) return base;
  return `${base}-${c.id.slice(0, 6)}`;
}

export function findCommunityBySlug<T extends Sluggable>(slug: string, all: readonly T[]): T | null {
  if (!slug) return null;
  const s = slug.toLowerCase();
  if (UUID_RE.test(s)) return all.find((c) => c.id.toLowerCase() === s) ?? null;
  return all.find((c) => communitySlug(c, all) === s) ?? null;
}
