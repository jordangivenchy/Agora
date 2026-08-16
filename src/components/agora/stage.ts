/* The Agora stage model: host-curated conversation, not an open mic.
   Role hierarchy (per participant, orthogonal to debater/spectator):
     host > cohost > speaker > audience
   Hosts come from the room's configuration — the creator, plus anyone the
   schema has marked host/cohost (scheduled panelists, pre-event co-hosts).
   The client derives sensible roles even before the stage migration is
   applied: room creator → host, debaters → speaker, everyone else audience. */

import type { DebateParticipant, DebateRoom } from "@/types/database";

export type StageRole = "host" | "cohost" | "speaker" | "audience";

export type StageParticipant = DebateParticipant & {
  stage_role?: StageRole | null;
  user: { username: string; avatar_url: string | null };
};

export function deriveStageRole(
  p: StageParticipant,
  room: Pick<DebateRoom, "host_id">
): StageRole {
  if (p.stage_role && ["host", "cohost", "speaker", "audience"].includes(p.stage_role)) {
    return p.stage_role;
  }
  // Pre-migration fallback.
  if (p.user_id === room.host_id) return "host";
  if (p.role === "debater") return "speaker";
  return "audience";
}

export function isHostRole(role: StageRole): boolean {
  return role === "host" || role === "cohost";
}

export function onStage(role: StageRole): boolean {
  return role !== "audience";
}

/* Raised hands, oldest first — the order the host works the queue. */
export function sortRequests(list: StageParticipant[]): StageParticipant[] {
  return [...list].sort((a, b) =>
    (a.hand_raised_at ?? "").localeCompare(b.hand_raised_at ?? "")
  );
}

export const ROLE_LABEL: Record<StageRole, string> = {
  host: "Host",
  cohost: "Co-host",
  speaker: "Speaker",
  audience: "Audience",
};
