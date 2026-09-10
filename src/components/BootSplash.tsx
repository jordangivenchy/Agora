"use client";

/* The boot splash: the loading screen over everything on a full page
   load, held long enough for the sky's time-lapse to run and the AS
   mark to arrive, then taken down with a fade. Client-side
   navigations never remount the root layout, so it shows once per
   load. It never touches React state — the takedown is a class and a
   display change on its own node — so it cannot disturb hydration of
   whatever is loading beneath it. */

import { useEffect, useRef } from "react";
import LoadingScreen from "./LoadingScreen";

const HOLD_MS = 2400; // the exposure (1.7s + a beat) plus a moment with the mark up
const FADE_MS = 500;

export default function BootSplash() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let fade = 0;
    const hold = window.setTimeout(() => {
      el.classList.add("is-done");
      fade = window.setTimeout(() => { el.style.display = "none"; }, FADE_MS);
    }, HOLD_MS);
    return () => { clearTimeout(hold); clearTimeout(fade); };
  }, []);

  return (
    <div ref={ref} className="ld-boot">
      <LoadingScreen />
    </div>
  );
}
