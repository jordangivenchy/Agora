"use client";

/* A wait with nothing to show yet: the bar at the top for as long as
   this is mounted (lib/progress.ts). Used by pages that fetch after
   mounting — settings, the mod tools, an unseeded profile — and by the
   home route while its first view streams on a client-side arrival. */

import { useEffect } from "react";
import { endProgress, startProgress } from "@/lib/progress";

export default function RouteLoading() {
  useEffect(() => {
    startProgress();
    return () => endProgress();
  }, []);
  return null;
}
