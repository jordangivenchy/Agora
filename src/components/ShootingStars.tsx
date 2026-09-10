"use client";

/* Shooting stars over the homepage starfield: every few seconds a thin
   streak crosses the screen from a random edge, drawn as one rect in a
   fixed full-screen svg (#shooting-svg; positioned and hidden on phones
   by mvp-home.css, hidden under reduced motion by globals.css). Ported
   from the shell's script; under reduced motion nothing is scheduled. */

import { useEffect, useRef } from "react";

const MIN_SPEED = 10, MAX_SPEED = 30;
const MIN_DELAY = 1200, MAX_DELAY = 4200;
const BASE_W = 10, H = 1;
const NS = "http://www.w3.org/2000/svg";

function randomStart() {
  const side = Math.floor(Math.random() * 4);
  const W = window.innerWidth, H2 = window.innerHeight;
  switch (side) {
    case 0: return { x: Math.random() * W, y: 0, angle: 45 };
    case 1: return { x: W, y: Math.random() * H2, angle: 135 };
    case 2: return { x: Math.random() * W, y: H2, angle: 225 };
    default: return { x: 0, y: Math.random() * H2, angle: 315 };
  }
}

export default function ShootingStars() {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let rect: SVGRectElement | null = null;
    let frame = 0, timer = 0, stopped = false;

    const scheduleNext = () => {
      timer = window.setTimeout(spawn, Math.random() * (MAX_DELAY - MIN_DELAY) + MIN_DELAY);
    };
    const spawn = () => {
      if (stopped) return;
      if (rect) { rect.remove(); rect = null; }
      cancelAnimationFrame(frame);
      const { x, y, angle } = randomStart();
      const speed = Math.random() * (MAX_SPEED - MIN_SPEED) + MIN_SPEED;
      const rad = (angle * Math.PI) / 180;
      const dx = Math.cos(rad), dy = Math.sin(rad);
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("fill", "url(#ss-grad)");
      r.setAttribute("height", String(H));
      svg.appendChild(r);
      rect = r;
      let px = x, py = y, dist = 0;
      const step = () => {
        if (stopped) return;
        px += speed * dx;
        py += speed * dy;
        dist += speed;
        const w = BASE_W * (1 + dist / 100);
        r.setAttribute("x", String(px));
        r.setAttribute("y", String(py));
        r.setAttribute("width", String(w));
        r.setAttribute("transform", `rotate(${angle},${px + w / 2},${py + H / 2})`);
        const W = window.innerWidth, H2 = window.innerHeight;
        if (px < -40 || px > W + 40 || py < -40 || py > H2 + 40) {
          r.remove();
          rect = null;
          scheduleNext();
          return;
        }
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    scheduleNext();
    return () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      rect?.remove();
    };
  }, []);

  return (
    <svg id="shooting-svg" aria-hidden="true" ref={svgRef}>
      <defs>
        <linearGradient id="ss-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#2EB9DF", stopOpacity: 0 }} />
          <stop offset="100%" style={{ stopColor: "#9E00FF", stopOpacity: 1 }} />
        </linearGradient>
      </defs>
    </svg>
  );
}
