/**
 * Audience ordering policy — the "line" for who gets called up next.
 *
 * The audience is a single ordered queue. Front of the line comes first:
 *
 *   1. Anyone with their hand raised is ALWAYS ahead of anyone who hasn't,
 *      no matter how long either has been in the room.
 *   2. Among raised hands, the one raised longest ago is at the very front
 *      (first-come, first-served on hand_raised_at, ascending).
 *   3. Among everyone else (hand down), the one who has been in the audience
 *      longest is closest to the front (join order, joined_at ascending).
 *
 * Timestamps are ISO-8601 strings, which sort chronologically under a plain
 * string compare, so an earlier timestamp (longer ago) sorts first.
 */
export interface AudienceMember {
  hand_raised_at: string | null;
  joined_at: string | null;
}

/** Comparator implementing the audience line policy. Sort ascending = front-first. */
export function compareAudienceOrder(a: AudienceMember, b: AudienceMember): number {
  const aRaised = !!a.hand_raised_at;
  const bRaised = !!b.hand_raised_at;

  // Rule 1 + 2: raised hands lead; among them, oldest raise first.
  if (aRaised && bRaised) return a.hand_raised_at!.localeCompare(b.hand_raised_at!);
  if (aRaised) return -1;
  if (bRaised) return 1;

  // Rule 3: hands down — longest time in the audience (earliest join) first.
  return (a.joined_at || "").localeCompare(b.joined_at || "");
}

/** Returns a new array ordered front-of-line first. Does not mutate the input. */
export function sortAudience<T extends AudienceMember>(members: T[]): T[] {
  return [...members].sort(compareAudienceOrder);
}
