"use client";

/* The boot splash: the site's opening. The first document of a browser
   session gets the loading screen over everything on load: the inline
   starter rendered after the markup runs as soon as the HTML is parsed
   — before any bundle, before hydration — so the sky is already
   turning while the app loads, with the AS mark arriving after most
   of a second of it. The app is ready once the effect runs; from then
   on the splash stays only to reach its floor, then settles into the
   page: its stars become the page's starfield where they stand
   (lib/skySplash.ts, Starfield.tsx) and the splash fades over them
   rather than to black. Every later
   full load in the session skips it: the starter hides the node at
   parse time and nothing waits (a full-load link shows the thin bar
   at the top instead, lib/skySplash.ts). Client-side navigations never
   remount the root layout, so it can show at most once per load.
   Nothing here touches React state — the takedown is a class and a
   display change on its own node — so it cannot disturb hydration of
   whatever is loading beneath it. */

import { useEffect, useRef } from "react";
import LoadingScreen from "./LoadingScreen";

const FULL_MS = 1200;  // the mark is up at 0.7s; a beat with it, then the fade
const FADE_MS = 500;
const SEEN = "ag-splash-seen";

const STARTER = `(function () {
  var b = document.getElementById('ag-boot');
  if (!b) return;
  var seen = false;
  try { seen = !!sessionStorage.getItem('${SEEN}'); sessionStorage.setItem('${SEEN}', '1'); } catch (e) {}
  if (seen || !window.__agoraSky) { b.classList.add('is-done'); b.style.display = 'none'; return; }
  b.dataset.t0 = String(performance.now());
  var c = b.querySelectorAll('canvas');
  window.__agoraSky(c[0], c[1], b.querySelector('.ld-center'), { markAt: 700 });
})();`;

export default function BootSplash() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || el.classList.contains("is-done")) return; // not this session's first load
    /* The floor counts from the sky's first painted frame when there has
       been one (the starter's own stamp is when the HTML was parsed,
       which can be well before anything was on screen). */
    const t0 = window.__agoraSkySession?.start ?? Number(el.dataset.t0) ?? performance.now();
    let fade = 0;
    const hold = window.setTimeout(() => {
      /* The sky settles into the page's starfield (Starfield.tsx takes
         the stars where they stand) and the splash fades over it — or,
         while the home page's first-load wait still carries the sky
         beneath, the wait settles it when it ends (lib/skySplash.ts). */
      window.__agoraSkyLeaving?.();
      el.classList.add("is-done");
      fade = window.setTimeout(() => { el.style.display = "none"; }, FADE_MS);
    }, Math.max(0, FULL_MS - (performance.now() - t0)));
    return () => { clearTimeout(hold); clearTimeout(fade); };
  }, []);

  return (
    <>
      <div ref={ref} id="ag-boot" className="ld-boot" suppressHydrationWarning>
        <LoadingScreen />
      </div>
      <script dangerouslySetInnerHTML={{ __html: STARTER }} />
    </>
  );
}
