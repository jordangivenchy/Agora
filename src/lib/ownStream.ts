/* A restream the host runs themselves. OBS, on their own computer, films
   the same clean view of the room that LiveKit's restream films (the
   room page's broadcast view, opened by ?token&url) and sends it out
   from their machine over their own connection, at whatever size and
   bitrate they set there. To us it is one more viewer, not restream
   minutes.

   The link carries a pass into the room's call for that view alone. It
   can watch and listen; it can't speak or send anything. It is hidden —
   no seat, not counted in the audience — and marked a recorder, as
   LiveKit's own is, so it doesn't keep a room open once the people have
   gone. Its name is not a person's id, so the webhook never takes it for
   someone arriving or leaving (lib/roomLifecycle). */
export const OWN_STREAM_HOURS = 12;

export function ownStreamIdentity(random: string): string {
  return `own-stream-${random}`;
}

export function ownStreamGrant(roomId: string) {
  return {
    room: roomId,
    roomJoin: true,
    canSubscribe: true,
    canPublish: false,
    canPublishData: false,
    hidden: true,
    recorder: true,
  };
}

/** The page the streaming app opens: the room's broadcast view, with its
    pass, marked as the host's own (`own`) so the page arranges itself
    for whatever shape of frame it is given — wide or tall — rather than
    for our recorder. */
export function ownStreamLink(origin: string, roomId: string, serverUrl: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/agora/${roomId}?${new URLSearchParams({ url: serverUrl, token, own: "1" })}`;
}
