/* The frame panel's pure parts: who is on the stage and what they said,
   and a key that changes whenever the frame changes (for the unread dot). */

import type { RoomFraming } from "@/types/database";
import { displayName } from "@/lib/names";
import { type StageParticipant, type StageRole, deriveStageRole, onStage } from "./stage";

export interface FramePerson {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  role: StageRole;
  stance: { text: string; at: string } | null;
}

const rank = (r: StageRole) => (r === "host" ? 0 : r === "cohost" ? 1 : 2);

/** Everyone on the stage, host first, each with their line if they wrote one.
    `me` is added when I hold a stage role without a seat yet (the creator
    before joining), so I can still write my line. Stances of people who
    have left the stage are not shown. */
export function framePeople(
  participants: StageParticipant[],
  room: { host_id: string; framing?: RoomFraming | null },
  me: { id: string; role: StageRole } | null
): FramePerson[] {
  const stances = room.framing?.stances ?? {};
  const list: FramePerson[] = participants
    .map((p) => ({ p, role: deriveStageRole(p, room) }))
    .filter(({ role }) => onStage(role))
    .map(({ p, role }) => ({
      id: p.user_id,
      username: p.user?.username ?? "",
      name: displayName(p.user) || p.user?.username || "Someone",
      avatarUrl: p.user?.avatar_url ?? null,
      role,
      stance: stances[p.user_id] ?? null,
    }));
  if (me && onStage(me.role) && !list.some((x) => x.id === me.id)) {
    list.push({ id: me.id, username: "", name: "You", avatarUrl: null, role: me.role, stance: stances[me.id] ?? null });
  }
  return list.sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name));
}

/** Changes whenever the frame or any stance changes. */
export function frameNewsKey(f: RoomFraming | null | undefined): string {
  const stanceTimes = Object.values(f?.stances ?? {})
    .map((s) => s.at)
    .sort()
    .join(",");
  return `${f?.about_at ?? ""}|${stanceTimes}`;
}

/** Does the frame have anything in it yet? */
export function frameIsEmpty(f: RoomFraming | null | undefined): boolean {
  return !f?.about?.trim() && Object.keys(f?.stances ?? {}).length === 0;
}

/** What the counter shows: the frame's length with each move down a line
    counting once, however the editor writes it (a paragraph break is two
    newlines in markdown). The database applies the same measure. */
export function frameLength(md: string): number {
  return md.replace(/\r/g, "").replace(/\n{2,}/g, "\n").length;
}
