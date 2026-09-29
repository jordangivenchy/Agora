/* How long a past discussion ran, when it went up and how often it was
   watched, in the site's words (src/lib/duration.ts): for every list of
   past discussions — the feed, profiles, trending, search, the "more"
   list — and the replay screen itself. Pure: no React here. */

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

/* The stamps a past discussion's row may carry. */
export type ReplayStamps = {
  recording_started_at?: string | null;
  recording_ended_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at?: string | null;
};

/** How long it ran: the recording's own start and end when the row has them, else the room's. */
export function replayLength(r: ReplayStamps): string | null {
  return roomLength(r.recording_started_at, r.recording_ended_at) ?? roomLength(r.started_at, r.ended_at);
}

/** When it went up: the room's end, else its start, else when it was made. */
export function postedAt(r: ReplayStamps): string | null {
  return r.ended_at ?? r.started_at ?? r.created_at ?? null;
}

/** "12 views · 3 days ago": the views only for a recording (nothing else
    can be watched) and only once they're known. */
export function viewsAndAgo(views: number | null | undefined, r: ReplayStamps, recorded = true): string {
  const ago = fmtAgo(postedAt(r));
  return [recorded && views != null ? fmtViews(views) : null, ago || null].filter(Boolean).join(" · ");
}
