/* Who is really in a room, as the call itself knows it. Shared by the
   website, its server and the phone app (this folder is the one all of
   them read).

   A seat (a debate_participants row) is bookkeeping kept by each page:
   taken on the way in, stamped out on the way out. The call knows
   better in two cases, and these are the answers to both:

   - One person, two devices. The call holds one connection per person,
     so when someone leaves on the laptop while still listening on the
     phone, the connection the call holds is not the one that left, and
     their seat must stand. Without this they vanished from the audience
     while still in the room.
   - Guests. Someone listening without an account has a connection but
     no seat, so only the call can count them. */

/** One connection the call holds: who, and which connection of theirs. */
export interface Connection {
  identity: string;
  sid: string;
}

/**
 * Is this person still in the call somewhere other than the connection
 * that is leaving?
 *
 * `sid` is the leaving page's own connection: null when it never had one
 * (it was watching the broadcast, or the call had already moved to
 * another device), undefined when the page is too old to say.
 */
export function heldElsewhere(connections: readonly Connection[], identity: string, sid: string | null | undefined): boolean {
  const theirs = connections.find((c) => c.identity === identity);
  if (!theirs) return false; // connected nowhere: they have left
  if (sid === undefined) return false; // can't tell which connection is leaving: as it always was
  return theirs.sid !== sid;
}

/** People without an account join the call as "guest-…" (api/livekit). */
export const isGuest = (identity: string): boolean => /^guest-/i.test(identity);

/** How many of these connections are guests. */
export function countGuests(identities: Iterable<string>): number {
  let n = 0;
  for (const id of identities) if (isGuest(id)) n += 1;
  return n;
}
