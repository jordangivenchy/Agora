/* Display names. Users pick a free-form display_name (welcome flow /
   settings); the @username stays the stable handle for URLs and mentions.
   Every name surface renders displayName(u) and falls back to the handle. */

export function displayName(
  u: { display_name?: string | null; username?: string | null } | null | undefined
): string {
  const dn = u?.display_name?.trim();
  return dn || u?.username || "";
}
