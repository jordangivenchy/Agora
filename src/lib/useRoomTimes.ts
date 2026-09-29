"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { RoomTimes } from "@/lib/duration";

/* The start and end stamps of some rooms, and their replays' views, for
   lists whose rows don't carry them. Fetched once per set of ids. */
export function useRoomTimes(ids: string[]): Record<string, RoomTimes> {
  const [times, setTimes] = useState<Record<string, RoomTimes>>({});
  const key = ids.slice().sort().join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const want = key.split(",");
    createClient()
      .from("debate_rooms")
      .select("id, started_at, ended_at, recording_started_at, recording_ended_at, replay_views")
      .in("id", want)
      .then(({ data }) => {
        if (!alive || !data) return;
        const next: Record<string, RoomTimes> = {};
        for (const r of data as ({ id: string } & RoomTimes)[]) {
          next[r.id] = {
            started_at: r.started_at,
            ended_at: r.ended_at,
            recording_started_at: r.recording_started_at ?? null,
            recording_ended_at: r.recording_ended_at ?? null,
            replay_views: r.replay_views ?? 0,
          };
        }
        setTimes((prev) => ({ ...prev, ...next }));
      });
    return () => { alive = false; };
  }, [key]);
  return times;
}
