/* The stage model, the same rules as the website's components/agora/stage.ts:
   host > cohost > speaker > audience. A promotion in stage_role wins;
   otherwise the room's creator is host, a debater is a speaker, and
   everyone else is audience. Raised hands are worked oldest first. */

export type StageRole = "host" | "cohost" | "speaker" | "audience";

export interface SeatUser {
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface Seat {
  id: string;
  room_id: string;
  user_id: string;
  role: "debater" | "spectator";
  stance: string | null;
  joined_at: string;
  left_at: string | null;
  hand_raised_at: string | null;
  mic_muted: boolean;
  stage_role: StageRole | null;
  user: SeatUser | SeatUser[] | null;
}

export function seatUser(seat: Seat): SeatUser | null {
  return Array.isArray(seat.user) ? seat.user[0] ?? null : seat.user;
}

export function seatName(seat: Seat): string {
  const u = seatUser(seat);
  return u?.display_name?.trim() || (u?.username ? `@${u.username}` : "Someone");
}

export function deriveStageRole(seat: Seat, hostId: string): StageRole {
  if (seat.stage_role && ["host", "cohost", "speaker"].includes(seat.stage_role)) return seat.stage_role;
  if (seat.user_id === hostId) return "host";
  if (seat.role === "debater") return "speaker";
  return "audience";
}

export const isHostRole = (r: StageRole) => r === "host" || r === "cohost";
export const onStage = (r: StageRole) => r !== "audience";

export function sortRequests(list: Seat[]): Seat[] {
  return [...list].sort((a, b) => (a.hand_raised_at ?? "").localeCompare(b.hand_raised_at ?? "") || a.user_id.localeCompare(b.user_id));
}

export const ROLE_LABEL: Record<StageRole, string> = { host: "Host", cohost: "Co-host", speaker: "Speaker", audience: "Audience" };
