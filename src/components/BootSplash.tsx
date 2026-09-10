"use client";

/* The boot splash: the loading screen over everything on a full page
   load. The inline starter rendered after the markup runs as soon as
   the HTML is parsed — before any bundle, before hydration — so the
   sky is already turning while the app loads: it decides whether this
   is the session's first load (the full showing, the AS mark arriving)
   or a reload (a short one, the sky alone), notes when it started, and
   starts the sky. The app is ready once the effect runs; from then on
   the splash stays only to reach its floor, then fades. Client-side
   navigations never remount the root layout, so it shows at most once
   per load. Nothing here touches React state — the takedown is a
   class and a display change on its own node — so it cannot disturb
   hydration of whatever is loading beneath it. */

import { useEffect, useRef } from "react";
import LoadingScreen from "./LoadingScreen";

const FULL_MS = 1700;  // the mark is up at 1s (skySplash); a beat with it, then the fade
const SHORT_MS = 800;
const FADE_MS = 500;
const SEEN = "ag-splash-seen";

const STARTER = `(function () {
  var b = document.getElementById('ag-boot');
  if (!b || !window.__agoraSky) return;
  var full = true;
  try { full = !sessionStorage.getItem('${SEEN}'); sessionStorage.setItem('${SEEN}', '1'); } catch (e) {}
  if (!full) b.classList.add('ld-boot--short');
  b.dataset.t0 = String(performance.now());
  var c = b.querySelectorAll('canvas');
  window.__agoraSky(c[0], c[1], b.querySelector('.ld-center'));
})();`;

export default function BootSplash() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let t0 = Number(el.dataset.t0);
    if (!t0) {
      // The starter didn't run; decide here (the sky starts from
      // LoadingScreen's own effect).
      t0 = performance.now();
      let full = true;
      try {
        full = !sessionStorage.getItem(SEEN);
        sessionStorage.setItem(SEEN, "1");
      } catch {}
      if (!full) el.classList.add("ld-boot--short");
    }
    const floor = el.classList.contains("ld-boot--short") ? SHORT_MS : FULL_MS;
    let fade = 0;
    const hold = window.setTimeout(() => {
      el.classList.add("is-done");
      fade = window.setTimeout(() => { el.style.display = "none"; }, FADE_MS);
    }, Math.max(0, floor - (performance.now() - t0)));
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
