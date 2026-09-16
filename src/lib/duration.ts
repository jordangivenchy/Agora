/* How long a discussion ran, and the day it happened — for the lists
   of past discussions (feed, profile, trending, the "more" strip), the
   page itself, and the archive at /replays. Pure on purpose: the
   archive renders on the server, so nothing here may reach for React or
   the browser's Supabase client (useRoomTimes.ts holds the hook). */

/** "3 min", "1 h 12 min", "45 s". */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** The run of a room from its stamps, or null when it never started. */
export function roomDuration(startedAt: string | null | undefined, endedAt: string | null | undefined): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms > 0 ? fmtDuration(ms) : null;
}

/** "Sep 10", with the year once it isn't this one. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", thisYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

export type RoomTimes = { started_at: string | null; ended_at: string | null };
