"use client";

/* The loading screen: a time-lapse of the night sky. A fresh sky is
   scattered over the whole screen every time the screen opens, then
   it turns about the centre the way a long exposure records it, each
   star drawing its arc behind a bright head, and the AS mark comes up
   at the centre. The sky itself is window.__agoraSky (lib/skySplash.ts,
   inlined in the root layout): route fallbacks (app/⋯/loading.tsx)
   and the live room's entrance start it from the effect here, with a
   word for what is coming; the boot splash (BootSplash.tsx) starts it
   before React is even loaded and the effect then leaves it be. It
   never touches React state — the sky is two canvases and the mark's
   arrival is a class on its own node — so it cannot disturb hydration
   of whatever is loading beneath it. */

import { useEffect, useRef } from "react";

export default function LoadingScreen({ label }: { label?: string }) {
  const trailsRef = useRef<HTMLCanvasElement>(null);
  const headsRef = useRef<HTMLCanvasElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trails = trailsRef.current, heads = headsRef.current;
    if (!trails || !heads || trails.dataset.live || !window.__agoraSky) return;
    const sky = window.__agoraSky(trails, heads, centerRef.current);
    return () => sky.stop();
  }, []);

  return (
    <div className="ld-screen" role="status" aria-label={label || "Loading"}>
      <div className="sk-progress" aria-hidden="true" />
      {/* The boot splash's starter sizes the canvases and marks the
          centre before hydration; those attributes are meant to differ. */}
      <canvas ref={trailsRef} className="ld-sky" aria-hidden="true" suppressHydrationWarning />
      <canvas ref={headsRef} className="ld-sky" aria-hidden="true" suppressHydrationWarning />
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
