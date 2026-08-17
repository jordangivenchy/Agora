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
  user: { username: string; display_name?: string | null; avatar_url: string | null };
};

export function deriveStageRole(
  p: StageParticipant,
  room: Pick<DebateRoom, "host_id">
): StageRole {
  /* Explicit promotions always win. 'audience' is NOT trusted as explicit:
     it's the column default, and the room-creation / seat-taking paths never
     set stage_role — so a debater (or the room creator) whose row reads
     'audience' almost certainly just carries the default. Trusting it locked
     real debaters out of their mic/camera in every newly created room. An
     intentional demotion sets role='spectator' too, so it still lands in the
     audience branch below. */
  if (p.stage_role && ["host", "cohost", "speaker"].includes(p.stage_role)) {
    return p.stage_role;
  }
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

/* Raised hands, oldest first — the order the host works the queue.
   user_id tiebreak mirrors advance_speaker_queue's ORDER BY, so every
   client and the server all derive the identical line. */
export function sortRequests(list: StageParticipant[]): StageParticipant[] {
  return [...list].sort(
    (a, b) =>
      (a.hand_raised_at ?? "").localeCompare(b.hand_raised_at ?? "") ||
      a.user_id.localeCompare(b.user_id)
  );
}

export const ROLE_LABEL: Record<StageRole, string> = {
  host: "Host",
  cohost: "Co-host",
  speaker: "Speaker",
  audience: "Audience",
};
