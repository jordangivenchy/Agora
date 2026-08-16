"use client";

/* The homepage starfield + shooting stars, for pages that don't load the MVP
   engine (currently the /beta gate). Faithful port of initStarfield and
   initShootingStars from public/mvp-home.js — same density, depth tiers,
   colors, parallax, twinkle/pulse timing, and shooting-star gradient — so the
   first thing a visitor sees matches the sky inside the app.

   Kept separate from the engine on purpose: loading mvp-home.js here would
   boot the entire homepage UI. If you tune the sky, tune both files. */

import { useEffect, useRef } from "react";

const DENSITY = 0.00018;

type Star = {
  ox: number; oy: number;
  x: number; y: number;
  radius: number;
  baseOpacity: number;
  baseColor: [number, number, number];
  depth: number;
  isClose: boolean;
  isFar: boolean;
  twinkleSpeed: number | null;
  phase: number;
  pulsing: boolean;
  pulseSpeed: number;
  pulsePhase: number;
  glowSprite?: HTMLCanvasElement;
  rgbStr?: string;
};

function randomRadius() {
  const r = Math.random();
  if (r < 0.65) return 0.3 + Math.random() * 0.4; // far
  if (r < 0.93) return 0.9 + Math.random() * 0.3; // mid
  return 1.4; // close (capped)
}

function makeStar(w: number, h: number): Star {
  const radius = randomRadius();
  const isClose = radius >= 1.2;
  const isMid = radius >= 0.9 && radius < 1.2;
  const isFar = radius < 0.9;
  const depth = isFar ? 0.2 : isMid ? 0.5 : 1.0;

  const baseOpacity = isFar
    ? 0.3 + Math.random() * 0.2
    : isMid
      ? 0.5 + Math.random() * 0.25
      : 0.75 + Math.random() * 0.25;

  const hotBlue = Math.random() < 0.04;
  const baseColor: [number, number, number] = hotBlue
    ? [144, 202, 249]
    : isFar
      ? [187, 222, 251]
      : isMid
        ? [227, 242, 253]
        : [255, 221, 0];

  const twinkles = Math.random() < 0.7;
  const twinkleSpeed = twinkles
    ? isClose
      ? 1.8 + Math.random() * 1.7
      : isMid
        ? 0.8 + Math.random() * 1.2
        : 0.3 + Math.random() * 0.7
    : null;

  const clusters: [number, number][] = [[0.2, 0.3], [0.55, 0.45], [0.80, 0.20]];
  let x: number, y: number;
  if (Math.random() < 0.38) {
    const c = clusters[Math.floor(Math.random() * clusters.length)];
    const spread = 0.22;
    x = Math.max(0, Math.min(w, (c[0] + (Math.random() + Math.random() - 1) * spread) * w));
    y = Math.max(0, Math.min(h, (c[1] + (Math.random() + Math.random() - 1) * spread) * h));
  } else {
    x = Math.random() * w;
    y = Math.random() * h;
  }

  const pulsing = Math.random() < 0.25;
  return {
    ox: x, oy: y, x, y, radius, baseOpacity, baseColor, depth, isClose, isFar,
    twinkleSpeed, phase: Math.random() * Math.PI * 2,
    pulsing, pulseSpeed: pulsing ? 2.0 + Math.random() * 3.0 : 0,
    pulsePhase: Math.random() * Math.PI * 2,
  };
}

function glowSpriteFor(s: Star): HTMLCanvasElement {
  if (s.glowSprite) return s.glowSprite;
  const R = Math.ceil(s.radius * 3.5) + 1;
  const c = document.createElement("canvas");
  c.width = c.height = R * 2;
  const g2 = c.getContext("2d")!;
  const gg = Math.round(s.baseColor[1] + (208 - s.baseColor[1]) * 0.8);
  const gb = Math.round(s.baseColor[2] * 0.1);
  const grad = g2.createRadialGradient(R, R, 0, R, R, R);
  grad.addColorStop(0, `rgba(255,${gg},${gb},1)`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g2.fillStyle = grad;
  g2.fillRect(0, 0, R * 2, R * 2);
  s.glowSprite = c;
  return c;
}

export default function BetaStarfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // Mirror the in-app setting: the explicit reduce-motion class hides the
    // sky entirely (same as mvp-home.css does for the homepage layers).
    if (document.documentElement.classList.contains("reduce-motion")) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let stars: Star[] = [];
    let mouseX = 0, mouseY = 0, targetMouseX = 0, targetMouseY = 0;
    let frame = 0;
    let regenTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const onMouseMove = (e: MouseEvent) => {
      targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });

    function generateStars(w: number, h: number) {
      return Array.from({ length: Math.floor(w * h * DENSITY) }, () => makeStar(w, h));
    }
    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      stars = generateStars(canvas!.width, canvas!.height);
    }
    // Rescale during live drags, regenerate once settled (same as the engine).
    const onWindowResize = () => {
      const ow = canvas.width || 1, oh = canvas.height || 1;
      const nw = window.innerWidth, nh = window.innerHeight;
      if (nw === ow && nh === oh) return;
      canvas.width = nw;
      canvas.height = nh;
      for (const s of stars) { s.ox *= nw / ow; s.oy *= nh / oh; }
      clearTimeout(regenTimer);
      regenTimer = setTimeout(() => { stars = generateStars(nw, nh); }, 200);
    };
    window.addEventListener("resize", onWindowResize);

    function render() {
      if (disposed) return;
      mouseX += (targetMouseX - mouseX) * 0.06;
      mouseY += (targetMouseY - mouseY) * 0.06;
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      const now = Date.now() * 0.001;

      for (const s of stars) {
        s.x = s.ox + mouseX * s.depth * 3.0;
        s.y = s.oy + mouseY * s.depth * 3.0;

        let opacity = s.baseOpacity;
        let [r, g, b] = s.baseColor;
        let twinklePeak = 0;

        if (s.twinkleSpeed !== null) {
          const t = (Math.sin(now / s.twinkleSpeed + s.phase) + 1) * 0.5;
          twinklePeak = t;
          if (s.isClose) {
            opacity = s.baseOpacity * 0.78 + t * s.baseOpacity * 0.44;
            r = 255;
            g = Math.round(s.baseColor[1] + (208 - s.baseColor[1]) * t * 0.8);
            b = Math.round(s.baseColor[2] * (1 - t * 0.9));
          } else if (!s.isFar) {
            opacity = s.baseOpacity * 0.8 + t * s.baseOpacity * 0.4;
          } else {
            opacity = s.baseOpacity * 0.85 + t * s.baseOpacity * 0.3;
          }
        }
        if (s.pulsing) {
          opacity -= ((Math.sin(now / s.pulseSpeed + s.pulsePhase) + 1) * 0.5) * 0.15;
        }
        opacity = Math.min(1, Math.max(0, opacity));

        if (s.isClose && s.twinkleSpeed !== null) {
          const glowOpacity = twinklePeak * 0.09;
          if (glowOpacity > 0.005) {
            const sp = glowSpriteFor(s);
            ctx!.globalAlpha = glowOpacity;
            ctx!.drawImage(sp, s.x - sp.width / 2, s.y - sp.height / 2);
            ctx!.globalAlpha = 1;
          }
        }

        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        if (s.isClose && s.twinkleSpeed !== null) {
          ctx!.fillStyle = `rgb(${r},${g},${b})`;
        } else {
          if (!s.rgbStr) s.rgbStr = `rgb(${r},${g},${b})`;
          ctx!.fillStyle = s.rgbStr;
        }
        ctx!.globalAlpha = opacity;
        ctx!.fill();
        ctx!.globalAlpha = 1;
      }
      frame = requestAnimationFrame(render);
    }
    resize();
    render();

    // ── Shooting stars ──
    const svg = svgRef.current;
    let ssTimer: ReturnType<typeof setTimeout> | undefined;
    let ssFrame = 0;
    let activeRect: SVGRectElement | null = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (svg && !reduced) {
      const NS = "http://www.w3.org/2000/svg";
      const defs = document.createElementNS(NS, "defs");
      const grad = document.createElementNS(NS, "linearGradient");
      grad.setAttribute("id", "beta-ss-grad");
      grad.setAttribute("x1", "0%"); grad.setAttribute("y1", "0%");
      grad.setAttribute("x2", "100%"); grad.setAttribute("y2", "100%");
      const s1 = document.createElementNS(NS, "stop");
      s1.setAttribute("offset", "0%");
      s1.setAttribute("style", "stop-color:#2EB9DF;stop-opacity:0");
      const s2 = document.createElementNS(NS, "stop");
      s2.setAttribute("offset", "100%");
      s2.setAttribute("style", "stop-color:#9E00FF;stop-opacity:1");
      grad.append(s1, s2);
      defs.appendChild(grad);
      svg.appendChild(defs);

      const MIN_SPEED = 10, MAX_SPEED = 30, MIN_DELAY = 1200, MAX_DELAY = 4200;
      const BASE_W = 10, RECT_H = 1;

      const randomStartPoint = () => {
        const side = Math.floor(Math.random() * 4);
        const W = window.innerWidth, H2 = window.innerHeight;
        switch (side) {
          case 0: return { x: Math.random() * W, y: 0, angle: 45 };
          case 1: return { x: W, y: Math.random() * H2, angle: 135 };
          case 2: return { x: Math.random() * W, y: H2, angle: 225 };
          default: return { x: 0, y: Math.random() * H2, angle: 315 };
        }
      };

      const scheduleNext = () => {
        ssTimer = setTimeout(spawnStar, Math.random() * (MAX_DELAY - MIN_DELAY) + MIN_DELAY);
      };

      function spawnStar() {
        if (disposed) return;
        activeRect?.remove();
        cancelAnimationFrame(ssFrame);

        const { x, y, angle } = randomStartPoint();
        const speed = Math.random() * (MAX_SPEED - MIN_SPEED) + MIN_SPEED;
        const rad = (angle * Math.PI) / 180;
        const dx = Math.cos(rad), dy = Math.sin(rad);

        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("fill", "url(#beta-ss-grad)");
        rect.setAttribute("height", String(RECT_H));
        svg!.appendChild(rect);
        activeRect = rect;

        let px = x, py = y, dist = 0;
        function step() {
          if (disposed) return;
          px += speed * dx;
          py += speed * dy;
          dist += speed;
          const w = BASE_W * (1 + dist / 100);
          rect.setAttribute("x", String(px));
          rect.setAttribute("y", String(py));
          rect.setAttribute("width", String(w));
          rect.setAttribute("transform", `rotate(${angle},${px + w / 2},${py + RECT_H / 2})`);
          const W = window.innerWidth, H2 = window.innerHeight;
          if (px < -40 || px > W + 40 || py < -40 || py > H2 + 40) {
            rect.remove();
            activeRect = null;
            scheduleNext();
            return;
          }
          ssFrame = requestAnimationFrame(step);
        }
        ssFrame = requestAnimationFrame(step);
      }
      scheduleNext();
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(ssFrame);
      clearTimeout(regenTimer);
      clearTimeout(ssTimer);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onWindowResize);
    };
  }, []);

  const layerStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    width: "100%",
    height: "100%",
    zIndex: 0,
    pointerEvents: "none",
  };
  return (
    <>
      <canvas ref={canvasRef} aria-hidden style={layerStyle} />
      <svg ref={svgRef} aria-hidden style={layerStyle} />
    </>
  );
}
