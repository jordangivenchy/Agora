"use client";

/* The loading screen: a time-lapse of the night sky. A fresh sky is
   scattered every time the screen opens, then the whole sky turns
   around a pole above centre the way a long exposure records it —
   each star drawing its arc, slowly at first, then fast, then easing
   to a stop — and the wordmark comes up at the pole as the exposure
   ends. Route fallbacks (app/⋯/loading.tsx) and the live room's
   entrance show it with a word for what is coming; the boot splash
   (BootSplash.tsx) shows it bare over a full page load. It never
   touches React state: the sky is a canvas and the wordmark's arrival
   is a class on its own node, so it cannot disturb hydration of
   whatever is loading beneath it. */

import { useEffect, useRef } from "react";

const POLE_Y = 0.46;       // where the sky turns, as a share of the height
const TURN = 0.95;         // radians the sky turns over the exposure
const EXPOSURE_MS = 1500;  // the time-lapse's length
const LOGO_AT_MS = 1050;   // the wordmark comes up from here

type Star = { r: number; a: number; size: number; trail: string; head: string };

function scatter(w: number, h: number, px: number, py: number): Star[] {
  const count = Math.max(220, Math.round(w * h * 0.00028));
  const margin = Math.hypot(w, h) * 0.05;
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const x = -margin + Math.random() * (w + 2 * margin);
    const y = -margin + Math.random() * (h + 2 * margin);
    const r = Math.hypot(x - px, y - py);
    if (r < 10) continue;
    const t = Math.random();
    const size = t < 0.7 ? 0.5 + Math.random() * 0.5 : t < 0.94 ? 1 + Math.random() * 0.6 : 1.6 + Math.random() * 0.8;
    const c = Math.random();
    const [cr, cg, cb] = c < 0.62 ? [200, 225, 255] : c < 0.84 ? [120, 170, 255] : c < 0.95 ? [255, 240, 214] : [255, 183, 0];
    const alpha = (size < 1 ? 0.35 : size < 1.6 ? 0.6 : 0.9) * (0.7 + Math.random() * 0.3);
    stars.push({
      r,
      a: Math.atan2(y - py, x - px),
      size,
      trail: `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`,
      head: `rgba(${cr},${cg},${cb},${Math.min(1, alpha + 0.25).toFixed(3)})`,
    });
  }
  return stars;
}

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

export default function LoadingScreen({ label }: { label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current, center = centerRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !center || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const px = w / 2, py = h * POLE_Y;
    const stars = scatter(w, h, px, py);

    ctx.lineCap = "round";
    const draw = (theta: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const s of stars) {
        ctx.beginPath();
        ctx.strokeStyle = s.trail;
        ctx.lineWidth = s.size;
        ctx.arc(px, py, s.r, s.a, s.a + theta);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = s.head;
        ctx.arc(px + s.r * Math.cos(s.a + theta), py + s.r * Math.sin(s.a + theta), s.size * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const showLogo = () => center.classList.add("is-on");

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw(TURN);
      showLogo();
      return;
    }

    draw(0);
    // The wordmark is on a timer of its own, not the frame loop, so it
    // still arrives in a background tab where frames don't run.
    const logo = window.setTimeout(showLogo, LOGO_AT_MS);
    let t0 = 0, raf = 0;
    const frame = (now: number) => {
      if (!t0) t0 = now;
      const u = Math.min(1, (now - t0) / EXPOSURE_MS);
      draw(TURN * easeInOut(u));
      if (u < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(logo); };
  }, []);

  return (
    <div className="ld-screen" role="status" aria-label={label || "Loading"}>
      <div className="sk-progress" aria-hidden="true" />
      <canvas ref={canvasRef} className="ld-sky" aria-hidden="true" />
      <div ref={centerRef} className="ld-center" style={{ top: `${POLE_Y * 100}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="AgoraSphere" className="ld-wordmark" />
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
