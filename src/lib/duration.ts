/* How long a discussion ran, and the day it happened — for the lists
   of past discussions (feed, profile, trending, the "more" strip) and
   the page itself. */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

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

/* The start and end stamps of some rooms, for lists whose rows don't
   carry them. Fetched once per set of ids. */
export function useRoomTimes(ids: string[]): Record<string, RoomTimes> {
  const [times, setTimes] = useState<Record<string, RoomTimes>>({});
  const key = ids.slice().sort().join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const want = key.split(",");
    createClient()
      .from("debate_rooms")
      .select("id, started_at, ended_at")
      .in("id", want)
      .then(({ data }) => {
        if (!alive || !data) return;
        const next: Record<string, RoomTimes> = {};
        for (const r of data as ({ id: string } & RoomTimes)[]) next[r.id] = { started_at: r.started_at, ended_at: r.ended_at };
        setTimes((prev) => ({ ...prev, ...next }));
      });
    return () => { alive = false; };
  }, [key]);
  return times;
}
