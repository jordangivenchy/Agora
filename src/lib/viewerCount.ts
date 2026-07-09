/**
 * Viewer counting policy: a "viewer" is a user currently CONNECTED to the
 * LiveKit room (debater or spectator). LiveKit's server is the authority on
 * connections — it drops dead sockets and rejects duplicate identities
 * (a second tab replaces the first), so each user counts exactly once.
 *
 * The host's client derives the count from LiveKit's participant list and
 * writes it to debate_rooms.viewer_count; RLS restricts that write to the
 * room's host, so other clients cannot fabricate counts.
 */
export function uniqueViewerCount(identities: (string | null | undefined)[]): number {
  const seen = new Set<string>();
  for (const id of identities) {
    if (id) seen.add(id);
  }
  return seen.size;
}
