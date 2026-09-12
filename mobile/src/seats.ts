/* Seats: the debate_participants rows for a room, read and written the
   way the website does it (app/agora/[id]/page.tsx, HostControls), under
   the same row security. Everyone in the room sees changes as they land
   through Supabase realtime. */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Seat } from "./stageModel";

const SEAT_COLUMNS = "id, room_id, user_id, role, stance, joined_at, left_at, hand_raised_at, mic_muted, stage_role, user:users(username, display_name, avatar_url)";

export async function fetchSeats(supabase: SupabaseClient, roomId: string): Promise<Seat[]> {
  const { data, error } = await supabase.from("debate_participants").select(SEAT_COLUMNS).eq("room_id", roomId).is("left_at", null);
  if (error) throw error;
  return (data ?? []) as unknown as Seat[];
}

/** Sit down: a spectator row, or the old row brought back. Cosmetic if it fails. */
export async function takeSeat(supabase: SupabaseClient, roomId: string, userId: string): Promise<void> {
  const { data: existing } = await supabase.from("debate_participants").select("id, left_at").eq("room_id", roomId).eq("user_id", userId).maybeSingle();
  if (!existing) {
    await supabase.from("debate_participants").insert({ room_id: roomId, user_id: userId, role: "spectator", stance: null });
  } else if (existing.left_at) {
    await supabase.from("debate_participants").update({ left_at: null, joined_at: new Date().toISOString() }).eq("id", existing.id);
  }
}

export async function vacateSeat(supabase: SupabaseClient, seatId: string): Promise<void> {
  await supabase.from("debate_participants").update({ left_at: new Date().toISOString(), hand_raised_at: null }).eq("id", seatId);
}

/** Server-stamped, so the queue order is the same on every phone. */
export async function raiseHand(supabase: SupabaseClient, roomId: string, raised: boolean): Promise<string | null> {
  const { error } = await supabase.rpc("raise_hand", { p_room: roomId, p_raised: raised });
  return error ? error.message : null;
}

export function heartbeat(supabase: SupabaseClient, roomId: string): void {
  void supabase.rpc("touch_seat", { p_room: roomId }).then(undefined, () => {});
}

/* Host and co-host. */
export const host = {
  bringUp: (supabase: SupabaseClient, seatId: string) =>
    supabase.from("debate_participants").update({ stage_role: "speaker", hand_raised_at: null }).eq("id", seatId),
  dismiss: (supabase: SupabaseClient, seatId: string) =>
    supabase.from("debate_participants").update({ hand_raised_at: null }).eq("id", seatId),
  toAudience: (supabase: SupabaseClient, seatId: string) =>
    supabase.from("debate_participants").update({ stage_role: "audience", hand_raised_at: null }).eq("id", seatId),
  lockRequests: (supabase: SupabaseClient, roomId: string, locked: boolean) =>
    supabase.from("debate_rooms").update({ speaker_requests_locked: locked }).eq("id", roomId),
};

/** Any change to the room's seats or the room itself calls back; returns the unsubscribe. */
export function subscribeRoom(supabase: SupabaseClient, roomId: string, onChange: () => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`app-room-${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "debate_participants", filter: `room_id=eq.${roomId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "debate_rooms", filter: `id=eq.${roomId}` }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
