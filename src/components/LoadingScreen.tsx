"use client";

/* The loading screen: a time-lapse of the night sky. A fresh sky is
   scattered every time the screen opens — a disc of stars that fits
   the screen, centred — then the whole disc turns the way a long
   exposure records it, each star drawing its arc, slowly at first,
   then fast, then easing to a stop, and the AS mark comes up at the
   centre as the exposure ends. Route fallbacks (app/⋯/loading.tsx)
   and the live room's entrance show it with a word for what is
   coming; the boot splash (BootSplash.tsx) shows it bare over a full
   page load. It never touches React state: the sky is a canvas and
   the mark's arrival is a class on its own node, so it cannot disturb
   hydration of whatever is loading beneath it.

   Each frame adds only the sliver of arc the sky turned since the last
   one, in a handful of strokes (stars are grouped by colour and size),
   so a frame costs the same whether the arcs are short or long. */

import { useEffect, useRef } from "react";

const TURN = 0.9;          // radians the sky turns over the exposure
const EXPOSURE_MS = 1700;  // the time-lapse's length
const MARK_AT_MS = 1200;   // the mark comes up from here
const SETTLE_MS = 120;     // a beat of still sky before it turns

type Star = { r: number; a: number };
type Group = { style: string; width: number; stars: Star[] };

const COLOURS: [number, number, number][] = [[200, 225, 255], [120, 170, 255], [255, 240, 214], [255, 183, 0]];
const SIZES = [{ width: 0.7, alpha: 0.4 }, { width: 1.2, alpha: 0.62 }, { width: 1.9, alpha: 0.9 }];

function scatter(R: number): Group[] {
  const groups: Group[] = [];
  const key = new Map<string, Group>();
  const count = Math.max(200, Math.round(Math.PI * R * R * 0.0007));
  for (let i = 0; i < count; i++) {
    // Uniform over the disc: radius by square root.
    const r = Math.sqrt(Math.random()) * R;
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
    g.stars.push({ r, a: Math.random() * Math.PI * 2 });
  }
  return groups;
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
    const px = w / 2, py = h / 2;
    const R = Math.min(w, h) / 2;
    const groups = scatter(R);

    ctx.globalCompositeOperation = "lighter";
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
    const showMark = () => center.classList.add("is-on");

    // The still sky: every star a dot (a round-capped stroke of no length).
    ctx.lineCap = "round";
    sweep(0, 0.0001);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sweep(0, TURN);
      showMark();
      return;
    }

    ctx.lineCap = "butt";
    // The mark is on a timer of its own, not the frame loop, so it still
    // arrives in a background tab where frames don't run.
    const mark = window.setTimeout(showMark, MARK_AT_MS);
    let t0 = 0, drawn = 0, raf = 0;
    const frame = (now: number) => {
      if (!t0) t0 = now;
      const u = Math.min(1, Math.max(0, now - t0 - SETTLE_MS) / EXPOSURE_MS);
      const theta = TURN * easeInOut(u);
      if (theta > drawn) { sweep(drawn, theta); drawn = theta; }
      if (u < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(mark); };
  }, []);

  return (
    <div className="ld-screen" role="status" aria-label={label || "Loading"}>
      <div className="sk-progress" aria-hidden="true" />
      <canvas ref={canvasRef} className="ld-sky" aria-hidden="true" />
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
