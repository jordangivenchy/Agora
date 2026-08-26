/* Pretty URLs.

   Rooms:    /agora/<motion-slug>-<short8>  (e.g. /agora/voting-should-be-mandatory-6c0ba6be)
             The trailing 8 hex chars are the room id prefix — the slug is
             cosmetic and never parsed. Full-UUID links keep working.
   Accounts: /@username — rewritten by the proxy to /users/username. */

export function roomSlug(motion: string | null | undefined): string {
  return (motion ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

export function roomPath(room: { id: string; motion?: string | null }): string {
  const slug = roomSlug(room.motion);
  const short = room.id.slice(0, 8);
  return slug ? `/agora/${slug}-${short}` : `/agora/${short}`;
}

/** Dedicated replay surface — same slug scheme, none of the live-room
    machinery loads. Ended rooms at /agora/<id> still render the replay
    there, so old links keep working. */
export function replayPath(room: { id: string; motion?: string | null }): string {
  const slug = roomSlug(room.motion);
  const short = room.id.slice(0, 8);
  return slug ? `/replays/${slug}-${short}` : `/replays/${short}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route param → full uuid, or an 8-char id prefix to resolve server-side. */
export function parseRoomParam(param: string): { uuid?: string; prefix?: string } {
  const dec = decodeURIComponent(param);
  if (UUID_RE.test(dec)) return { uuid: dec.toLowerCase() };
  const m = dec.match(/([0-9a-f]{8})$/i);
  return m ? { prefix: m[1].toLowerCase() } : {};
}

export function userPath(username: string): string {
  return `/@${encodeURIComponent(username)}`;
}
