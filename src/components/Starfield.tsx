"use client";

/* The homepage starfield, ported from public/mvp-home.js for the
   SiteChrome routes (the home page keeps its own copy in the MVP
   script). Same algorithm: three depth tiers with weighted radii,
   twinkle + pulse, mouse parallax, cached glow sprites for the close
   tier. Renders into a fixed full-viewport canvas with the same
   #star-canvas id so the mvp-home.css positioning (fixed, z-0,
   pointer-events none) and reduce-motion handling apply unchanged. */

import { useEffect, useRef } from "react";

const DENSITY = 0.00018;

interface Star {
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
}

function randomRadius(): number {
  const r = Math.random();
  if (r < 0.65) return 0.3 + Math.random() * 0.4;
  if (r < 0.93) return 0.9 + Math.random() * 0.3;
  return 1.4;
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
  const clusters: Array<[number, number]> = [[0.2, 0.3], [0.55, 0.45], [0.8, 0.2]];
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

export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let stars: Star[] = [];
    let mouseX = 0, mouseY = 0, targetMouseX = 0, targetMouseY = 0;
    let raf = 0;
    let regenTimer: ReturnType<typeof setTimeout> | undefined;

    const generate = () => {
      stars = Array.from(
        { length: Math.floor(canvas.width * canvas.height * DENSITY) },
        () => makeStar(canvas.width, canvas.height)
      );
    };
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      generate();
    };
    const onWindowResize = () => {
      const ow = canvas.width || 1, oh = canvas.height || 1;
      const nw = window.innerWidth, nh = window.innerHeight;
      if (nw === ow && nh === oh) return;
      canvas.width = nw; canvas.height = nh;
      for (const s of stars) { s.ox *= nw / ow; s.oy *= nh / oh; }
      clearTimeout(regenTimer);
      regenTimer = setTimeout(generate, 200);
    };
    const onMouse = (e: MouseEvent) => {
      targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const render = () => {
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) onWindowResize();
      mouseX += (targetMouseX - mouseX) * 0.06;
      mouseY += (targetMouseY - mouseY) * 0.06;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
            ctx.globalAlpha = glowOpacity;
            ctx.drawImage(sp, s.x - sp.width / 2, s.y - sp.height / 2);
            ctx.globalAlpha = 1;
          }
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        if (s.isClose && s.twinkleSpeed !== null) {
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        } else {
          if (!s.rgbStr) s.rgbStr = `rgb(${r},${g},${b})`;
          ctx.fillStyle = s.rgbStr;
        }
        ctx.globalAlpha = opacity;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(render);
    };

    window.addEventListener("resize", onWindowResize);
    window.addEventListener("mousemove", onMouse, { passive: true });
    resize();
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(regenTimer);
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("mousemove", onMouse);
    };
  }, []);

  return <canvas id="star-canvas" ref={canvasRef} aria-hidden="true" />;
}
