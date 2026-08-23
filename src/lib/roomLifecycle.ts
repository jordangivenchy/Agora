/* Pure decision logic for the LiveKit lifecycle webhook
   (/api/webhook/livekit). Kept side-effect free so it can be unit
   tested — the route applies the returned plan with the admin client.

   LiveKit room name == debate_rooms.id (the token mint in /api/livekit
   grants `room: roomId`), and identity == the Supabase user id for
   signed-in users; guests carry a `guest-…` identity and never map to a
   participant row. */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRoomUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Signed-in LiveKit identities are Supabase user uuids; guests are `guest-…`. */
export function isUserIdentity(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type WebhookPlan =
  | { action: "ignore" }
  /* Stamp the participant's left_at; if they're the live host, start the
     grace timer (host_left_at) instead of ending the room. */
  | { action: "participant_left"; roomId: string; userId: string }
  /* Host is back — clear the grace timer. (Seat restore is the room
     page's own job; the webhook never clears left_at.) */
  | { action: "participant_joined"; roomId: string; userId: string }
  /* LiveKit closed the room (empty past its timeout) — end it if live. */
  | { action: "room_finished"; roomId: string };

export function planWebhook(
  eventName: string,
  roomName: unknown,
  identity: unknown
): WebhookPlan {
  if (!isRoomUuid(roomName)) return { action: "ignore" };

  if (eventName === "room_finished") {
    return { action: "room_finished", roomId: roomName };
  }
  if (!isUserIdentity(identity)) return { action: "ignore" };

  if (eventName === "participant_left") {
    return { action: "participant_left", roomId: roomName, userId: identity };
  }
  if (eventName === "participant_joined") {
    return { action: "participant_joined", roomId: roomName, userId: identity };
  }
  return { action: "ignore" };
}
