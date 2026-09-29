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

export type RoomTimes = {
  started_at: string | null;
  ended_at: string | null;
  recording_started_at?: string | null;
  recording_ended_at?: string | null;
  replay_views?: number | null;
};

/** When a past discussion was put up, the way a video says it:
    "just now", "5 minutes ago", "3 days ago", "2 weeks ago", "1 year ago". */
export function fmtAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  const unit = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"} ago`;
  if (s < 60) return "just now";
  if (s < 3600) return unit(Math.floor(s / 60), "minute");
  if (s < 86400) return unit(Math.floor(s / 3600), "hour");
  const d = Math.floor(s / 86400);
  if (d < 7) return unit(d, "day");
  if (d < 30) return unit(Math.floor(d / 7), "week");
  if (d < 365) return unit(Math.max(1, Math.floor(d / 30)), "month");
  return unit(Math.floor(d / 365), "year");
}

/** A replay's views: "No views", "1 view", "842 views", "1.2K views", "3.4M views". */
export function fmtViews(n: number | null | undefined): string {
  const v = Math.max(0, Math.floor(n ?? 0));
  if (v === 0) return "No views";
  if (v === 1) return "1 view";
  const short = (x: number, s: string) => `${x < 10 ? Math.floor(x * 10) / 10 : Math.floor(x)}${s}`;
  if (v < 1000) return `${v} views`;
  if (v < 1_000_000) return `${short(v / 1000, "K")} views`;
  return `${short(v / 1_000_000, "M")} views`;
}

/** A replay's length on its thumbnail, the way a video player says it:
    "4:05", "12:34", "1:02:03". Null when the room never ran. */
export function roomLength(startedAt: string | null | undefined, endedAt: string | null | undefined): string | null {
  if (!startedAt || !endedAt) return null;
  const s = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** The length a replay's thumbnail shows: the recording's own span when
    the row has it (what plays), else the room's. */
export function replayLength(r: Partial<RoomTimes> | null | undefined): string | null {
  if (!r) return null;
  return roomLength(r.recording_started_at, r.recording_ended_at) ?? roomLength(r.started_at, r.ended_at);
}
