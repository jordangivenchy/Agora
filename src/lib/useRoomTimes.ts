"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { RoomTimes } from "@/lib/duration";

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
