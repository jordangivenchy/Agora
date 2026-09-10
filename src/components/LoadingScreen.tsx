"use client";

/* The loading screen: a time-lapse of the night sky. A fresh sky is
   scattered over the whole screen every time the screen opens, then
   it turns about the centre the way a long exposure records it — each
   star drawing its arc behind a bright head, gathering speed over the
   first moments and then turning steadily for as long as the screen
   is up — and the AS mark comes up at the centre. Route fallbacks
   (app/⋯/loading.tsx) and the live room's entrance show it with a
   word for what is coming; the boot splash (BootSplash.tsx) shows it
   bare over a full page load. It never touches React state: the sky
   is two canvases and the mark's arrival is a class on its own node,
   so it cannot disturb hydration of whatever is loading beneath it.

   The trails canvas is never cleared: each frame adds only the sliver
   of arc the sky turned since the last, in a handful of strokes (stars
   are grouped by colour and size), so a frame costs the same however
   long the arcs get. The heads canvas is redrawn every frame. */

import { useEffect, useRef } from "react";

const SPEED = 0.5;         // radians per second once the sky is up to speed
const RAMP_S = 0.45;       // how long it takes to get there
const SETTLE_MS = 120;     // a beat of still sky before it turns
const MARK_AT_MS = 1200;   // the mark comes up from here

type Star = { r: number; a: number };
type Group = { style: string; width: number; stars: Star[] };

const COLOURS: [number, number, number][] = [[200, 225, 255], [120, 170, 255], [255, 240, 214], [255, 183, 0]];
const SIZES = [{ width: 0.7, alpha: 0.4 }, { width: 1.2, alpha: 0.62 }, { width: 1.9, alpha: 0.9 }];

function scatter(w: number, h: number, px: number, py: number): Group[] {
  const groups: Group[] = [];
  const key = new Map<string, Group>();
  const count = Math.max(220, Math.round(w * h * 0.00035));
  // A margin past every edge, so the corners stay full as the sky turns.
  const m = Math.hypot(w, h) * 0.06;
  for (let i = 0; i < count; i++) {
    const x = -m + Math.random() * (w + 2 * m), y = -m + Math.random() * (h + 2 * m);
    const r = Math.hypot(x - px, y - py);
    if (r < 12) continue;
    const t = Math.random();
    const size = SIZES[t < 0.7 ? 0 : t < 0.94 ? 1 : 2];
    const c = Math.random();
    const [cr, cg, cb] = COLOURS[c < 0.62 ? 0 : c < 0.84 ? 1 : c < 0.95 ? 2 : 3];
    const dim = Math.random() < 0.5;
    const alpha = (size.alpha * (dim ? 0.72 : 1)).toFixed(2);
    const style = `rgba(${cr},${cg},${cb},${alpha})`;
    const k = `${style}/${size.width}`;
    let g = key.get(k);
    if (!g) { g = { style, width: size.width, stars: [] }; key.set(k, g); groups.push(g); }
    g.stars.push({ r, a: Math.atan2(y - py, x - px) });
  }
  return groups;
}

/* Angle turned by time t (seconds): starts from rest and settles into
   SPEED, with no jolt at either end. */
const turned = (t: number) => SPEED * (t - RAMP_S + RAMP_S * Math.exp(-t / RAMP_S));

export default function LoadingScreen({ label }: { label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headsRef = useRef<HTMLCanvasElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current, heads = headsRef.current, center = centerRef.current;
    const ctx = canvas?.getContext("2d"), hctx = heads?.getContext("2d");
    if (!canvas || !heads || !center || !ctx || !hctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    for (const [c, x] of [[canvas, ctx], [heads, hctx]] as const) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.globalCompositeOperation = "lighter";
    }
    const px = w / 2, py = h / 2;
    const groups = scatter(w, h, px, py);

    // The sliver of arc from one angle to the next, for every star.
    const sweep = (from: number, to: number) => {
      for (const g of groups) {
        ctx.beginPath();
        ctx.strokeStyle = g.style;
        ctx.lineWidth = g.width;
        for (const s of g.stars) {
          const a0 = s.a + from;
          ctx.moveTo(px + s.r * Math.cos(a0), py + s.r * Math.sin(a0));
          ctx.arc(px, py, s.r, a0, s.a + to);
        }
        ctx.stroke();
      }
    };
    // Every star's bright head at the given angle, on the heads canvas.
    const drawHeads = (theta: number) => {
      hctx.clearRect(0, 0, w, h);
      for (const g of groups) {
        hctx.beginPath();
        hctx.fillStyle = g.style;
        const rad = g.width * 0.9;
        for (const s of g.stars) {
          const a = s.a + theta;
          const x = px + s.r * Math.cos(a), y = py + s.r * Math.sin(a);
          hctx.moveTo(x + rad, y);
          hctx.arc(x, y, rad, 0, Math.PI * 2);
        }
        hctx.fill();
      }
    };
    const showMark = () => center.classList.add("is-on");

    // The still sky: every star a dot (a round-capped stroke of no length).
    ctx.lineCap = "round";
    sweep(0, 0.0001);
    drawHeads(0);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sweep(0, 0.9);
      drawHeads(0.9);
      showMark();
      return;
    }

    ctx.lineCap = "butt";
    // The mark is on a timer of its own, not the frame loop, so it still
    // arrives in a background tab where frames don't run.
    const mark = window.setTimeout(showMark, MARK_AT_MS);
    let t0 = 0, drawn = 0, raf = 0;
    const frame = (now: number) => {
      // The boot splash hides this node when it is done rather than
      // unmounting it; stop turning once nobody can see it.
      if (!canvas.isConnected || canvas.offsetWidth === 0) return;
      if (!t0) t0 = now;
      const theta = turned(Math.max(0, now - t0 - SETTLE_MS) / 1000);
      if (theta > drawn) { sweep(drawn, theta); drawn = theta; drawHeads(theta); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(mark); };
  }, []);

  return (
    <div className="ld-screen" role="status" aria-label={label || "Loading"}>
      <div className="sk-progress" aria-hidden="true" />
      <canvas ref={canvasRef} className="ld-sky" aria-hidden="true" />
      <canvas ref={headsRef} className="ld-sky" aria-hidden="true" />
      <div ref={centerRef} className="ld-center">
        <span className="ld-mark" aria-label="AgoraSphere"><span>A</span><span className="ld-mark-s">S</span></span>
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
