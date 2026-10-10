import { RoomServiceClient } from "livekit-server-sdk";
import type { Connection } from "@/components/agora/roomPresence";

/* How long a leave will wait for the call's answer before going ahead
   without it. */
const ASK_MS = 2500;

/* Asking the call who is connected to a room, from the server. Null
   means it couldn't be asked (no keys, the provider unreachable or slow,
   or the room not open there because nobody is connected): callers treat
   that as "unknown" and do what they did before there was anyone to ask. */
export async function roomConnections(roomId: string): Promise<Connection[] | null> {
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const svc = new RoomServiceClient(url.replace(/^wss?:\/\//, "https://"), key, secret);
    const asked = svc
      .listParticipants(roomId)
      .then((list): Connection[] | null => list.map((p) => ({ identity: p.identity, sid: p.sid })))
      .catch(() => null);
    const tooSlow = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ASK_MS);
    });
    return await Promise.race([asked, tooSlow]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
