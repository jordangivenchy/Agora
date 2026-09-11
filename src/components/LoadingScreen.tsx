"use client";

/* The loading screen: a time-lapse of the night sky. A fresh sky is
   scattered over the whole screen every time the screen opens, then
   it turns about the centre the way a long exposure records it, each
   star drawing its arc behind a bright head, and the AS mark comes up
   at the centre. The sky itself is window.__agoraSky (lib/skySplash.ts,
   inlined in the root layout): the live room's entrance and the home
   page's first-load wait start it from the effect here; the boot
   splash (BootSplash.tsx) starts it before React is even loaded and
   the effect then leaves it be. Inside a session every other wait is
   the bar at the top (lib/progress.ts): the sky is the site's opening,
   once a session. It
   never touches React state — the sky is two canvases and the mark's
   arrival is a class on its own node — so it cannot disturb hydration
   of whatever is loading beneath it. */

import { useLayoutEffect, useRef } from "react";
import { useIsClient } from "@/lib/media";

/* In-page waits (a list still arriving, a panel's data): a line with the
   same ticking ellipsis, never a spinner. */
export function LoadingLine({ label = "Loading" }: { label?: string }) {
  return (
    <p className="ld-line" role="status">
      {label}
      <span className="ld-ellipsis" aria-hidden="true"><i /><i /><i /></span>
    </p>
  );
}

const STARTER = `(function(){var s=document.currentScript;var el=s&&s.parentNode;if(!el||!window.__agoraSky||(el.closest&&el.closest('#ag-boot')))return;var c=el.querySelectorAll('canvas');window.__agoraSky(c[0],c[1],el.querySelector('.ld-center'));})();`;

export default function LoadingScreen({ label }: { label?: string }) {
  /* The parse-time starter belongs to the server's HTML only: it is
     rendered on the server and through hydration (so the trees match),
     then dropped; a screen mounted in the browser never creates it —
     scripts created by React don't run, and React says so. */
  const client = useIsClient();
  const trailsRef = useRef<HTMLCanvasElement>(null);
  const headsRef = useRef<HTMLCanvasElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);

  const barRef = useRef<HTMLDivElement>(null);

  /* A layout effect, not a passive one: the sky's first frame — and the
     mark, when it is already due — is drawn before the browser paints
     this screen, so one screen giving way to the next (the entry to a
     room handing to its call, a fallback to a page's own wait) never
     shows a black frame between two skies. */
  useLayoutEffect(() => {
    const trails = trailsRef.current, heads = headsRef.current;
    if (!trails || !heads || trails.dataset.live || !window.__agoraSky) return;
    const sky = window.__agoraSky(trails, heads, centerRef.current);
    // Continuing an earlier sky: the bar picks up where it was too.
    if (sky.elapsed > 0 && barRef.current) barRef.current.style.animationDelay = `-${Math.round(sky.elapsed)}ms`;
    return () => sky.stop();
  }, []);

  return (
    <div className="ld-screen" role="status" aria-label={label || "Loading"}>
      <div ref={barRef} className="sk-progress" aria-hidden="true" />
      {/* The boot splash's starter sizes the canvases and marks the
          centre before hydration; those attributes are meant to differ. */}
      <canvas ref={trailsRef} className="ld-sky" aria-hidden="true" suppressHydrationWarning />
      <canvas ref={headsRef} className="ld-sky" aria-hidden="true" suppressHydrationWarning />
      {/* The sky starts as the HTML is parsed, before any bundle — a
          server-rendered screen (a room's entry) is never a black frame
          waiting for hydration. The effect above then leaves it be. The
          boot splash's own starter handles the boot node. */}
      {!client && <script dangerouslySetInnerHTML={{ __html: STARTER }} />}
      <div ref={centerRef} className="ld-center" suppressHydrationWarning>
        {/* The A and the S, cut from the wordmark (public/as-mark.png). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/as-mark.png" alt="AgoraSphere" className="ld-mark" width={426} height={202} />
        {label && (
          <p className="ld-label">
            {label}
            <span className="ld-ellipsis" aria-hidden="true"><i /><i /><i /></span>
          </p>
        )}
      </div>
    </div>
  );
}
