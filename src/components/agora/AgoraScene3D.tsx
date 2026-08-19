"use client";

/* The Agora in real 3D — vanilla three.js blockout.
   Every piece of the scene is a named builder (buildTerraces, buildChairs,
   buildTrees, buildTorches, buildStage…) so each can be swapped for a real
   .glb model later without touching the others: replace the builder's
   placeholder geometry with a GLTFLoader load and keep its layout logic.

   World layout: bowl center at the origin, stage toward +z (the camera
   side), terraces rising away from it. Seat angles run 0..180° with
   world x = r·cos(a), z = −r·sin(a), so 90° is straight "north" away
   from the stage. Occupancy mirrors the old SVG logic: named spectators
   first, then viewer_count generic figures, seeded by room id. */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  MIC_POS,
  PORTAL_Z,
  VISIBLE_SLOTS,
  renderedCount,
  slotPosition,
} from "./queueLayout";
import { GROUND, SCREEN, SKY, STAGE_LIGHT, STARS, STONE } from "./sceneTokens";

export interface SeatedPerson {
  id: string;
  username: string;
  avatarUrl: string | null;
}

export type AgoraView = "audience" | "speaker";

interface Props {
  roomId: string;
  audience: SeatedPerson[];
  viewerCount: number;
  view: AgoraView;
  /** Egress compositor (software WebGL, no GPU): start at the quality
      floor — 1x buffer, no shadows, no MSAA — instead of discovering it
      through the adaptive step-down. */
  performanceMode?: boolean;
  /** Fires once the camera glide lands on a view's vantage — the page
      holds the DOM stage back until the speaker vantage has arrived. */
  onViewSettled?: (view: AgoraView) => void;
  /** Speaker queue, front first (mic holder excluded). Members leave their
      seats and stand in the center aisle, closest-to-mic = next. */
  queue?: SeatedPerson[];
  /** Whoever holds the mic — rendered standing on the medallion. */
  micHolder?: SeatedPerson | null;
  /** True while the mic holder is actually speaking (drives the mic glow). */
  micLive?: boolean;
}

/* ── Deterministic PRNG ── */
function hashString(s: string): number {
  let h = 1779033703;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Layout constants (world units ≈ meters) ── */
const ROWS = 8;
const INNER_R = 10;
const ROW_STEP = 2.3;
const STEP_H = 0.55;
const BASE_H = 0.5;
const AISLE_HALF = 5; // degrees
const EDGE = 13; // degrees
const OUTER_R = INNER_R + ROWS * ROW_STEP;
const SEAT_ARC_SPACING = 1.45;

const DEG = Math.PI / 180;

interface Seat3D {
  x: number;
  z: number;
  y: number;
  yaw: number;
  side: "pro" | "con";
  row: number;
}

function generateSeats(): Seat3D[] {
  const seats: Seat3D[] = [];
  for (let row = 0; row < ROWS; row++) {
    const r = INNER_R + (row + 0.5) * ROW_STEP;
    const y = BASE_H + row * STEP_H; // top surface of this terrace
    /* Rows 0–1 keep a wider margin so their innermost seats sit clear of
       the tunnel hood (roof edge at |x| = 1.25); each wedge re-spaces its
       seats evenly across the shortened arc, so the lower rows stay
       uniform rather than bunching at the tunnel side. */
    const margin = row < 2 ? AISLE_HALF + 7 : AISLE_HALF + 1.5;
    const wedges: { side: "pro" | "con"; from: number; to: number; interior?: boolean }[] = [
      { side: "con", from: EDGE + 2, to: 90 - margin },
      { side: "pro", from: 90 + margin, to: 180 - EDGE - 2 },
    ];
    /* The center aisle no longer needs to be walkable — queue entry is
       teleport-based and the tunnel dives below grade just past the portal.
       Rows 2+ reclaim the gap as one continuous strip; interior-only
       placement keeps even spacing and can't collide with the seats that
       already sit on the strip's endpoints. */
    if (row >= 2) {
      wedges.push({ side: "con", from: 90 - AISLE_HALF - 1.5, to: 90 + AISLE_HALF + 1.5, interior: true });
    }
    for (const w of wedges) {
      const arcLen = (w.to - w.from) * DEG * r;
      if (w.interior) {
        const count = Math.max(0, Math.floor(arcLen / SEAT_ARC_SPACING) - 1);
        for (let i = 0; i < count; i++) {
          const a = (w.from + ((i + 1) / (count + 1)) * (w.to - w.from)) * DEG;
          seats.push({
            x: r * Math.cos(a),
            z: -r * Math.sin(a),
            y,
            yaw: a - Math.PI / 2,
            side: a <= Math.PI / 2 ? "con" : "pro", // match the flanking halves
            row,
          });
        }
        continue;
      }
      const count = Math.max(1, Math.floor(arcLen / SEAT_ARC_SPACING));
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const a = (w.from + t * (w.to - w.from)) * DEG;
        seats.push({
          x: r * Math.cos(a),
          z: -r * Math.sin(a),
          y,
          yaw: a - Math.PI / 2, // backrest faces radially outward
          side: w.side,
          row,
        });
      }
    }
  }
  return seats;
}

const AVATAR_COLORS = [
  0x8b5cf6, 0x4a9eff, 0xe17055, 0x00b894, 0xfd79a8,
  0xe2b96b, 0x00cec9, 0x9c84ef, 0x3ba3d0, 0xeb459e,
];

/* ── Scene builders — each is a future .glb swap point ── */

/* Annular sector shape in the x/y plane; rotateX(-90°) maps it to x/z with
   extrusion depth becoming world height. Shape +y → world −z. */
function sectorShape(r0: number, r1: number, a0: number, a1: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(r1 * Math.cos(a0), r1 * Math.sin(a0));
  shape.absarc(0, 0, r1, a0, a1, false);
  shape.lineTo(r0 * Math.cos(a1), r0 * Math.sin(a1));
  shape.absarc(0, 0, r0, a1, a0, true);
  shape.closePath();
  return shape;
}

function buildTerraces(scene: THREE.Scene) {
  const stoneA = new THREE.MeshStandardMaterial({ color: 0x6b6156, flatShading: true });
  const stoneB = new THREE.MeshStandardMaterial({ color: 0x5e554b, flatShading: true });
  for (let i = 0; i < ROWS; i++) {
    const r0 = INNER_R + i * ROW_STEP;
    const height = BASE_H + i * STEP_H;
    const halves = [
      [(EDGE) * DEG, (90 - AISLE_HALF) * DEG],
      [(90 + AISLE_HALF) * DEG, (180 - EDGE) * DEG],
    ];
    /* Rows 2+ close the old aisle gap — a floor under the reclaimed center
       seats. Rows 0–1 stay open for the tunnel portal and trench mouth. */
    if (i >= 2) {
      halves.push([(90 - AISLE_HALF) * DEG, (90 + AISLE_HALF) * DEG]);
    }
    for (const [a0, a1] of halves) {
      const geo = new THREE.ExtrudeGeometry(sectorShape(r0, r0 + ROW_STEP, a0, a1), {
        depth: height,
        bevelEnabled: false,
      });
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, i % 2 === 0 ? stoneA : stoneB);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
  // Outer boundary wall
  const wallGeo = new THREE.ExtrudeGeometry(
    sectorShape(OUTER_R, OUTER_R + 0.9, (EDGE - 3) * DEG, (183 - EDGE) * DEG),
    { depth: BASE_H + ROWS * STEP_H + 0.8, bevelEnabled: false }
  );
  wallGeo.rotateX(-Math.PI / 2);
  const wall = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ color: 0x4a423a, flatShading: true }));
  wall.receiveShadow = true;
  scene.add(wall);
}

/* The old center-aisle staircase (and its portal landing) is gone entirely:
   queue entry teleports, the hooded tunnel reads as built architecture on
   its own, and anything half-sunk at the mouth just clipped the floor.
   Circulation moved to the bowl's SIDES instead: a staircase climbs each
   edge of the seating, straddling the terrace boundary. */
function buildSideStairs(scene: THREE.Scene) {
  /* Same stones as the terrace floors, alternating by row, so the stairs
     read as part of the bowl's masonry rather than a separate build. */
  const stoneA = new THREE.MeshStandardMaterial({ color: 0x6b6156, flatShading: true });
  const stoneB = new THREE.MeshStandardMaterial({ color: 0x5e554b, flatShading: true });
  const stepsPerRow = 3;
  const stepDepth = ROW_STEP / stepsPerRow;
  const HALF_W = 0.75; // half the stair width
  const GAP = 0.55; // breathing room to the outermost seats, matching seat rhythm
  for (const side of [1, -1]) {
    for (let i = 0; i < ROWS * stepsPerRow; i++) {
      const r = INNER_R + (i / stepsPerRow) * ROW_STEP + stepDepth / 2;
      /* Fully OUTSIDE the terrace arc with an even seat-like gap: the
         angular clearance shrinks with radius, so it's computed per step —
         parallel to the bowl's side all the way up, never clipping. */
      const off = (HALF_W + GAP) / r;
      const a = side === 1 ? EDGE * DEG - off : (180 - EDGE) * DEG + off;
      const row = Math.floor(i / stepsPerRow);
      const h = BASE_H + row * STEP_H + (i % stepsPerRow) * (STEP_H / stepsPerRow);
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, h, stepDepth + 0.05),
        row % 2 === 0 ? stoneA : stoneB
      );
      step.position.set(r * Math.cos(a), h / 2, -r * Math.sin(a));
      step.rotation.y = a - Math.PI / 2; // tread faces along the radial climb
      step.receiveShadow = true;
      scene.add(step);
    }
  }
}

/* Marble Agora: the discussion floor as one flat tablet of pale marble.

   The photoreal weight is carried by two textures baked here at build
   time from one seeded slab layout:

   - The ALBEDO holds everything a camera would see in the reference:
     concentric rings of individually-toned trapezoidal slabs, joint
     lines, veining, speckle grain — and then the light itself, a warm
     center bloom multiplied over a rim vignette. Baking the light into
     the stone is the trick: that soft lit-from-within look is bounced
     light, and no count of real-time point lights produces it.
   - The BUMP map redraws the same joints and grain as height, so the
     slabs catch the real lanterns at grazing angles.

   The same albedo feeds the material's emissive channel at low
   intensity (STONE.emissive), which is what keeps the tablet reading
   under a night sky — fake GI, tunable with one number.

   Geometry stays almost nothing: a stepped pair of cylinders and a
   textured cap. The old medallion stack is gone and MIC_POS.y came down
   to the flat top with it. Queue members still stand at slot y = 0
   (tested math, untouched); the 0.17 surface under a distant figure is
   the acceptable cost of a floor that looks like the reference. */
function buildClassicStone(scene: THREE.Scene): THREE.PointLight[] {
  const cx = 0;
  const cz = -1.6;
  const rng = mulberry32(hashString("agora-marble"));

  /* ── One slab layout, drawn twice ─────────────────────────────── */
  const S = 2048;
  type Slab = { a0: number; a1: number; r0: number; r1: number; tone: number };
  const slabs: Slab[] = [];
  const ringEdges = [0.0, 0.13, 0.3, 0.47, 0.64, 0.815, 1.0];
  const ringCounts = [8, 10, 14, 18, 24, 30];
  for (let ring = 0; ring < ringCounts.length; ring++) {
    const n = ringCounts[ring];
    const stagger = ring * 0.35 + rng() * 0.4;
    /* Irregular widths: walk the circle handing each slab 0.72–1.28 of
       the even share, then scale the walk to close exactly. Hand-cut
       stone is never metronomic, and the reference's rings visibly
       aren't — even division is one of the tells of a cheap render. */
    const shares: number[] = [];
    let total = 0;
    for (let k = 0; k < n; k++) {
      const w = 0.72 + rng() * 0.56;
      shares.push(w);
      total += w;
    }
    let acc = stagger * ((Math.PI * 2) / n);
    for (let k = 0; k < n; k++) {
      const w = (shares[k] / total) * Math.PI * 2;
      slabs.push({
        a0: acc,
        a1: acc + w,
        r0: ringEdges[ring],
        r1: ringEdges[ring + 1],
        tone: (rng() - 0.5) * 16, // per-slab lightness jitter, ±8
      });
      acc += w;
    }
  }

  const slabPath = (ctx: CanvasRenderingContext2D, s: Slab, R: number, c: number) => {
    ctx.beginPath();
    ctx.arc(c, c, Math.max(s.r1 * R, 1), s.a0, s.a1);
    if (s.r0 > 0.001) ctx.arc(c, c, s.r0 * R, s.a1, s.a0, true);
    else ctx.lineTo(c, c);
    ctx.closePath();
  };

  const albedo = document.createElement("canvas");
  albedo.width = albedo.height = S;
  {
    const ctx = albedo.getContext("2d")!;
    const c = S / 2;
    const R = c * 0.985;
    ctx.fillStyle = "#151310";
    ctx.fillRect(0, 0, S, S);

    for (const s of slabs) {
      // Marble body: pale warm gray, per-slab tone, faint internal drift.
      const l = 63 + s.tone;
      slabPath(ctx, s, R, c);
      const mid = (s.a0 + s.a1) / 2;
      const mr = ((s.r0 + s.r1) / 2) * R;
      const gx = c + mr * Math.cos(mid);
      const gy = c + mr * Math.sin(mid);
      const g = ctx.createLinearGradient(
        gx - 90, gy - 90, gx + 90, gy + 90
      );
      g.addColorStop(0, `hsl(42, 11%, ${l + 2.5}%)`);
      g.addColorStop(1, `hsl(40, 9%, ${l - 2.5}%)`);
      ctx.fillStyle = g;
      ctx.fill();

      // Veining, clipped to the slab: a few soft strokes both lighter
      // and darker than the body, like real calcite drift.
      ctx.save();
      slabPath(ctx, s, R, c);
      ctx.clip();
      const veins = 2 + Math.floor(rng() * 3);
      for (let v = 0; v < veins; v++) {
        const vx = gx + (rng() - 0.5) * 180;
        const vy = gy + (rng() - 0.5) * 180;
        ctx.beginPath();
        ctx.moveTo(vx, vy);
        ctx.bezierCurveTo(
          vx + (rng() - 0.5) * 220, vy + (rng() - 0.5) * 220,
          vx + (rng() - 0.5) * 220, vy + (rng() - 0.5) * 220,
          vx + (rng() - 0.5) * 320, vy + (rng() - 0.5) * 320
        );
        ctx.lineWidth = 1 + rng() * 2.2;
        ctx.strokeStyle = rng() > 0.45
          ? `rgba(240, 236, 226, ${0.05 + rng() * 0.07})`
          : `rgba(88, 80, 66, ${0.05 + rng() * 0.06})`;
        ctx.stroke();
      }
      // Weathering: one or two soft tonal blotches per slab — the
      // per-slab staining that makes the reference read as real stone
      // rather than a fill colour.
      ctx.save();
      slabPath(ctx, s, R, c);
      ctx.clip();
      const blotches = 1 + Math.floor(rng() * 2);
      for (let b = 0; b < blotches; b++) {
        const bx = gx + (rng() - 0.5) * 160;
        const by = gy + (rng() - 0.5) * 160;
        const br = 30 + rng() * 90;
        const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        const dark = rng() > 0.35;
        const alpha = 0.04 + rng() * 0.08;
        bg.addColorStop(0, dark ? `rgba(74, 66, 52, ${alpha})` : `rgba(246, 240, 228, ${alpha})`);
        bg.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = bg;
        ctx.fillRect(bx - br, by - br, br * 2, br * 2);
      }
      ctx.restore();
      ctx.restore();
    }

    // Joints, drawn after every body so they stay continuous.
    for (const s of slabs) {
      slabPath(ctx, s, R, c);
      ctx.lineWidth = 9;
      ctx.strokeStyle = "rgba(30, 27, 21, 0.18)"; // soft shoulder
      ctx.stroke();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(32, 28, 22, 0.9)"; // the joint itself
      ctx.stroke();
      // Chamfer catch-light along each slab's edge — stone edges are
      // never razor-cut, and the bright line is what sells the bevel.
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "rgba(255, 249, 238, 0.09)";
      ctx.stroke();
    }

    // Grain: one-time speckle pass over the whole tablet.
    for (let n = 0; n < 7000; n++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * R;
      ctx.fillStyle = rng() > 0.5
        ? `rgba(250, 246, 236, ${0.02 + rng() * 0.03})`
        : `rgba(52, 47, 38, ${0.02 + rng() * 0.03})`;
      ctx.fillRect(c + r * Math.cos(a), c + r * Math.sin(a), 2, 2);
    }

    // ── The baked light. Vignette first (multiply), then the warm
    //    center bloom (screen), then a whisper of edge light at the rim.
    ctx.globalCompositeOperation = "multiply";
    const vig = ctx.createRadialGradient(c, c, R * 0.1, c, c, R);
    /* Gentler than the first cut: the reference's rim is still clearly
       pale marble — crushing the edge to near-black is what made the
       whole tablet read as brown mush from the low camera. */
    vig.addColorStop(0, "rgb(255, 255, 255)");
    vig.addColorStop(0.62, "rgb(212, 206, 194)");
    vig.addColorStop(1, "rgb(148, 141, 127)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, S, S);

    ctx.globalCompositeOperation = "screen";
    /* The bloom is the hero. Tight, hot, decisively warm — in the
       reference it approaches white at dead center. */
    const warm = ctx.createRadialGradient(c, c, 0, c, c, R * 0.55);
    warm.addColorStop(0, "rgba(255, 226, 178, 0.85)");
    warm.addColorStop(0.28, "rgba(255, 196, 128, 0.34)");
    warm.addColorStop(1, "rgba(255, 178, 106, 0)");
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, S, S);

    ctx.beginPath();
    ctx.arc(c, c, R - 5, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255, 214, 164, 0.22)";
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  const bump = document.createElement("canvas");
  bump.width = bump.height = 1024;
  {
    const ctx = bump.getContext("2d")!;
    const c = 512;
    const R = c * 0.985;
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 1024, 1024);
    for (const s of slabs) {
      slabPath(ctx, s, R, c);
      ctx.fillStyle = `hsl(0, 0%, ${50 + s.tone * 0.5}%)`;
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "#2f2f2f"; // grooves read as depth
      ctx.stroke();
    }
    for (let n = 0; n < 3500; n++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * R;
      ctx.fillStyle = rng() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
      ctx.fillRect(c + r * Math.cos(a), c + r * Math.sin(a), 2, 2);
    }
  }

  /* Roughness: slabs polished-ish (mid-dark), joints rough (bright), a
     little per-slab drift. This is what lets the lanterns lay sheen
     streaks across the marble at grazing angles — the reference's floor
     is clearly reflective, and a flat roughness never was. */
  const rough = document.createElement("canvas");
  rough.width = rough.height = 1024;
  {
    const ctx = rough.getContext("2d")!;
    const c = 512;
    const R = c * 0.985;
    ctx.fillStyle = "#e6e6e6";
    ctx.fillRect(0, 0, 1024, 1024);
    for (const s of slabs) {
      slabPath(ctx, s, R, c);
      ctx.fillStyle = `hsl(0, 0%, ${44 + s.tone * 0.9 + rng() * 6}%)`;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#dadada"; // joints scatter light
      ctx.stroke();
    }
  }

  const albedoTex = new THREE.CanvasTexture(albedo);
  albedoTex.colorSpace = THREE.SRGBColorSpace;
  albedoTex.anisotropy = 16; // grazing angles are this floor's whole life
  const bumpTex = new THREE.CanvasTexture(bump);
  bumpTex.anisotropy = 8;
  const roughTex = new THREE.CanvasTexture(rough);
  roughTex.anisotropy = 8;

  /* ── Geometry: step ring, tablet body, textured cap ────────────── */
  const step = new THREE.Mesh(
    new THREE.CylinderGeometry(STONE.stepRadius, STONE.stepRadius, STONE.stepRise, 96),
    new THREE.MeshStandardMaterial({ color: STONE.stepColor, roughness: 0.9 })
  );
  step.position.set(cx, STONE.stepRise / 2, cz);
  step.receiveShadow = true;
  scene.add(step);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(STONE.radius, STONE.radius, STONE.topY, 96, 1, true),
    new THREE.MeshStandardMaterial({ color: STONE.sideColor, roughness: 0.9 })
  );
  body.position.set(cx, STONE.topY / 2, cz);
  scene.add(body);

  const cap = new THREE.Mesh(
    new THREE.CircleGeometry(STONE.radius, 96),
    new THREE.MeshStandardMaterial({
      map: albedoTex,
      bumpMap: bumpTex,
      bumpScale: 0.014,
      roughness: 1, // the map carries the real values
      roughnessMap: roughTex,
      emissive: 0xffffff,
      emissiveMap: albedoTex,
      emissiveIntensity: STONE.emissive,
    })
  );
  cap.rotation.x = -Math.PI / 2;
  cap.position.set(cx, STONE.topY + 0.002, cz);
  cap.receiveShadow = true;
  scene.add(cap);

  /* ── Lanterns: the full ring, as the reference draws it — small
     fixtures every ~36° with the arc over the queue corridor left
     dark so the processional path stays legible. ── */
  const lights: THREE.PointLight[] = [];
  const lanternAngles = [8, 44, 80, 116, 152, 188, 224, 332];
  const postGeo = new THREE.BoxGeometry(0.09, 0.52, 0.09);
  const capGeo = new THREE.BoxGeometry(0.2, 0.06, 0.2);
  const flameGeo = new THREE.BoxGeometry(0.12, 0.15, 0.12);
  const postMat = new THREE.MeshStandardMaterial({ color: STONE.lanternPost, roughness: 1 });
  const flameMat = new THREE.MeshBasicMaterial({ color: STONE.lanternFlame });
  /* The halo around a lantern at night is atmosphere scattering — the
     reference has it on every flame, and its absence is one more tell.
     One shared additive sprite texture, one sprite per lantern. */
  const haloTex = (() => {
    const cnv = document.createElement("canvas");
    cnv.width = cnv.height = 128;
    const hc = cnv.getContext("2d")!;
    const g = hc.createRadialGradient(64, 64, 2, 64, 64, 64);
    g.addColorStop(0, "rgba(255, 205, 140, 0.85)");
    g.addColorStop(0.25, "rgba(255, 180, 110, 0.28)");
    g.addColorStop(1, "rgba(255, 170, 100, 0)");
    hc.fillStyle = g;
    hc.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(cnv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  for (const deg of lanternAngles) {
    const a = deg * DEG;
    const r = STONE.stepRadius + 0.75;
    const x = cx + r * Math.cos(a);
    const z = cz + r * Math.sin(a);
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x, 0.26, z);
    scene.add(post);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(x, 0.53, z);
    scene.add(flame);
    const capMesh = new THREE.Mesh(capGeo, postMat);
    capMesh.position.set(x, 0.63, z);
    scene.add(capMesh);
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(1.5);
    halo.position.set(x, 0.53, z);
    scene.add(halo);
    /* Eight smaller lights instead of six: each dimmer and shorter-reach
       so the ring reads as beads of warmth, not a floodlit perimeter. */
    const light = new THREE.PointLight(STONE.lanternLight, 4.2, 6, 2);
    light.position.set(x, 0.75, z);
    light.userData = { base: 4.2, flick: 0.4 };
    scene.add(light);
    lights.push(light);
  }

  /* ── Fringe: grass tufts and scattered rocks, one draw each ────── */
  {
    const tuftGeo = new THREE.ConeGeometry(0.07, 0.26, 5);
    const tufts = new THREE.InstancedMesh(
      tuftGeo,
      new THREE.MeshStandardMaterial({ color: STONE.grass, roughness: 1, flatShading: true }),
      130
    );
    const dummy = new THREE.Object3D();
    let n = 0;
    while (n < 130) {
      const a = rng() * Math.PI * 2;
      const r = STONE.stepRadius + 0.2 + rng() * 1.8;
      const x = cx + r * Math.cos(a);
      const z = cz + r * Math.sin(a);
      if (Math.abs(x) < 1.0 && z < -3.2) continue; // the queue corridor
      dummy.position.set(x, 0.1, z);
      dummy.rotation.set((rng() - 0.5) * 0.35, rng() * Math.PI, (rng() - 0.5) * 0.35);
      dummy.scale.setScalar(0.7 + rng() * 0.8);
      dummy.updateMatrix();
      tufts.setMatrixAt(n++, dummy.matrix);
    }
    scene.add(tufts);

    const rockGeo = new THREE.DodecahedronGeometry(0.14, 0);
    const rocks = new THREE.InstancedMesh(
      rockGeo,
      new THREE.MeshStandardMaterial({ color: STONE.rockDark, roughness: 1, flatShading: true }),
      36
    );
    let m = 0;
    while (m < 36) {
      const a = rng() * Math.PI * 2;
      const r = STONE.stepRadius + 0.35 + rng() * 1.6;
      const x = cx + r * Math.cos(a);
      const z = cz + r * Math.sin(a);
      if (Math.abs(x) < 1.0 && z < -3.2) continue;
      dummy.position.set(x, 0.05, z);
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      dummy.scale.set(0.5 + rng(), 0.35 + rng() * 0.5, 0.5 + rng());
      dummy.updateMatrix();
      rocks.setMatrixAt(m++, dummy.matrix);
    }
    rocks.receiveShadow = true;
    scene.add(rocks);
  }

  return lights;
}

function buildOrchestra(scene: THREE.Scene) {
  // Semicircular floor between the stage and the first row.
  const geo = new THREE.CircleGeometry(INNER_R, 48, 0, Math.PI);
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI); // open side toward the stage (+z)
  /* Darkened well below its old 0x756b5d: the orchestra still reads as
     stone under the bowl, but it no longer competes with the speakers as
     a big pale disc in the speaker vantage (brief §12). */
  const floor = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x3b3830, roughness: 1 })
  );
  floor.position.y = 0.02;
  floor.receiveShadow = true;
  scene.add(floor);
}

function buildChairsAndCrowd(
  scene: THREE.Object3D, // a Group in practice — lets the crowd rebuild without touching the scene
  seats: Seat3D[],
  occupancy: Map<number, SeatedPerson | null>
) {
  const n = seats.length;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // Chairs: cushion + backrest as two instanced meshes.
  const cushionGeo = new THREE.BoxGeometry(1.05, 0.32, 0.85);
  const backGeo = new THREE.BoxGeometry(1.05, 0.72, 0.16);
  const chairMat = new THREE.MeshStandardMaterial({ flatShading: true });
  const cushions = new THREE.InstancedMesh(cushionGeo, chairMat, n);
  const backs = new THREE.InstancedMesh(backGeo, chairMat.clone(), n);
  // No castShadow: hundreds of chair/crowd casters would dominate the shadow
  // pass for shadows that are invisible under the night lighting anyway.

  // Crowd: head + torso for every occupied seat.
  const occupiedIdx = seats.map((_, i) => i).filter((i) => occupancy.has(i));
  const headGeo = new THREE.SphereGeometry(0.26, 10, 8);
  const torsoGeo = new THREE.SphereGeometry(0.4, 10, 8);
  torsoGeo.scale(1, 0.8, 0.9);
  const personMat = new THREE.MeshStandardMaterial({ flatShading: true });
  const heads = new THREE.InstancedMesh(headGeo, personMat, Math.max(1, occupiedIdx.length));
  const torsos = new THREE.InstancedMesh(torsoGeo, personMat.clone(), Math.max(1, occupiedIdx.length));
  heads.count = torsos.count = occupiedIdx.length;

  seats.forEach((seat, i) => {
    dummy.position.set(seat.x, seat.y + 0.16, seat.z);
    dummy.rotation.set(0, seat.yaw, 0);
    dummy.updateMatrix();
    cushions.setMatrixAt(i, dummy.matrix);

    // Backrest sits radially outward from the cushion.
    const out = new THREE.Vector3(seat.x, 0, seat.z).normalize();
    dummy.position.set(seat.x + out.x * 0.45, seat.y + 0.45, seat.z + out.z * 0.45);
    dummy.updateMatrix();
    backs.setMatrixAt(i, dummy.matrix);

    const occupied = occupancy.has(i);
    const proSide = seat.side === "pro";
    /* Empty seats sit far darker than they used to (0x2f2456 / 0x1d2f56):
       with nobody in them the bowl read as a bright blue band across the
       speaker vantage, fighting the starfield the camera now tilts up
       into. Occupied seats keep their vivid side colours — people light
       a theater, furniture doesn't. */
    color.setHex(
      occupied ? (proSide ? 0x6d4ab8 : 0x3a6cc2) : proSide ? 0x1c1733 : 0x121b30
    );
    cushions.setColorAt(i, color);
    backs.setColorAt(i, color.clone().multiplyScalar(0.8));
  });

  occupiedIdx.forEach((seatIdx, j) => {
    const seat = seats[seatIdx];
    const person = occupancy.get(seatIdx);
    dummy.rotation.set(0, seat.yaw, 0);
    dummy.position.set(seat.x, seat.y + 0.62, seat.z);
    dummy.updateMatrix();
    torsos.setMatrixAt(j, dummy.matrix);
    dummy.position.set(seat.x, seat.y + 1.12, seat.z);
    dummy.updateMatrix();
    heads.setMatrixAt(j, dummy.matrix);

    if (person) {
      color.setHex(AVATAR_COLORS[hashString(person.id) % AVATAR_COLORS.length]);
    } else {
      color.setHex(seat.side === "pro" ? 0xa78bfa : 0x7ab8ff);
    }
    torsos.setColorAt(j, color);
    heads.setColorAt(j, color.clone().multiplyScalar(1.15));
  });

  scene.add(cushions, backs, heads, torsos);
}

function buildTrees(scene: THREE.Scene) {
  const rng = mulberry32(hashString("agora-grove"));
  const canopyShades = [0x1a3823, 0x1e4128, 0x234b2e, 0x16301e];
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2f22, flatShading: true });
  const positions: { x: number; z: number; s: number }[] = [];
  // Ring behind the theater
  for (let a = 0; a <= 180; a += 6 + rng() * 6) {
    const r = OUTER_R + 3.5 + rng() * 9;
    positions.push({ x: r * Math.cos(a * DEG), z: -r * Math.sin(a * DEG), s: 1 + rng() * 1.1 });
  }
  /* The woods that used to flank the stage (z 4–12) are gone: they sat
     directly beside the participant screens and were the noisiest thing
     in the speaker vantage after the scaenae. The ring behind the theatre
     stays — it's far enough back to read as horizon, not scenery. */

  const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
  const canopies: THREE.InstancedMesh[] = canopyShades.map(
    (shade) =>
      new THREE.InstancedMesh(
        canopyGeo,
        new THREE.MeshStandardMaterial({ color: shade, flatShading: true }),
        positions.length * 2
      )
  );
  const counts = canopyShades.map(() => 0);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
  const dummy = new THREE.Object3D();

  positions.forEach((p, i) => {
    dummy.position.set(p.x, 1.2 * p.s, p.z);
    dummy.scale.setScalar(p.s);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    // 2–3 canopy blobs per tree, split across shade meshes
    const blobCount = 2 + Math.floor(rng() * 2);
    for (let b = 0; b < blobCount; b++) {
      const shadeIdx = Math.floor(rng() * canopyShades.length);
      const mesh = canopies[shadeIdx];
      dummy.position.set(
        p.x + (rng() - 0.5) * 1.6 * p.s,
        (2.6 + rng() * 1.3) * p.s,
        p.z + (rng() - 0.5) * 1.6 * p.s
      );
      dummy.scale.setScalar((1.1 + rng() * 0.9) * p.s);
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(counts[shadeIdx]++, dummy.matrix);
    }
  });
  canopies.forEach((c, i) => {
    c.count = counts[i];
    c.castShadow = true;
    scene.add(c);
  });
  trunks.castShadow = true;
  scene.add(trunks);
}

/* Grass by lighting, not by texture detail: one radial gradient baked to a
   single 512² canvas — lit olive under the discussion area falling off to
   night well before the ground's edge. No tiling, no photographic detail,
   and the falloff is what hides the ground/sky seam. */
function buildGround(scene: THREE.Scene) {
  const size = GROUND.textureSize;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, GROUND.lit);
  grad.addColorStop(0.22, GROUND.mid);
  grad.addColorStop(0.6, GROUND.far);
  grad.addColorStop(1, GROUND.far);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.CircleGeometry(GROUND.radius, 64);
  geo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })
  );
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);
}

/* One small warm pool at the centre of the discussion area, with no
   visible source — no torches, no braziers, no lamps. The warmth is what
   separates the gathering place from the cool night around it; a visible
   flame would pull the eye off the speakers (brief §10). */
function buildStageGlow(scene: THREE.Scene): THREE.PointLight[] {
  const light = new THREE.PointLight(
    STAGE_LIGHT.color,
    STAGE_LIGHT.intensity,
    STAGE_LIGHT.distance,
    STAGE_LIGHT.decay
  );
  light.position.set(STAGE_LIGHT.position.x, STAGE_LIGHT.position.y, STAGE_LIGHT.position.z);
  light.userData = { base: STAGE_LIGHT.intensity, flick: STAGE_LIGHT.flicker };
  scene.add(light);
  return [light];
}


/* ── Speaker queue architecture ─────────────────────────────────────
   Slot plates down the center aisle and the tunnel portal at the
   orchestra rim. Static geometry — the queue members themselves live in
   a separate group the queue effect owns. (The mic totem that stood at
   the medallion was removed by request: the clean marble center is the
   stage, and the mic holder standing there is the marker.) */
function buildQueuePath(scene: THREE.Scene) {
  /* Slot plates: small worn discs marking the visible line — proud enough
     of the path band to read as deliberate markers, not z-fighting slivers. */
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x6b6156, flatShading: true });
  for (let i = 0; i < VISIBLE_SLOTS; i++) {
    const s = slotPosition(i);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.1, 14), plateMat);
    plate.position.set(s.x, 0.05, s.z);
    plate.receiveShadow = true;
    scene.add(plate);
  }

  /* Stone path: one band from the portal all the way to the medallion,
     ending tucked inside the base disc (the pavers part around the
     corridor in buildPlaza, so nothing clips). A low stone step carries
     the last stretch up onto the medallion — from there the medallion's
     own discs stair up to the mic. */
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x5d564b, flatShading: true });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 6.9), pathMat);
  strip.position.set(0, 0.025, -8.0);
  strip.receiveShadow = true;
  scene.add(strip);
  const step = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.24, 0.5), pathMat);
  step.position.set(0, 0.12, -4.8); // rises flush with the base disc top
  step.receiveShadow = true;
  scene.add(step);

  /* Tunnel portal at the orchestra rim: an arch in the first terrace face
     with a dark throat behind it — the line visibly continues inside.
     Same stone as the terraces (buildTerraces' stoneA), so the hood reads
     as part of the bowl rather than a separate material. */
  const stone = new THREE.MeshStandardMaterial({ color: 0x6b6156, flatShading: true });
  const jambGeo = new THREE.BoxGeometry(0.35, 2.1, 0.5);
  for (const sx of [-0.85, 0.85]) {
    const jamb = new THREE.Mesh(jambGeo, stone);
    jamb.position.set(sx, 1.05, PORTAL_Z);
    scene.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.38, 0.55), stone);
  lintel.position.set(0, 2.25, PORTAL_Z);
  scene.add(lintel);

  /* Solid hood over the tunnel: a sloped stone roof from the portal lip
     down to EXACTLY the third row's floor height (y = 1.6 at the row-2
     terrace face, z ≈ −14.6), so terrace floor and tunnel roof meet as
     one continuous surface. Side walls follow the same slope. */
  const ROOF_SLOPE = 0.211; // atan(0.75 drop / 3.5 run)
  /* Slightly longer than the gap: the far end tucks ~0.25 INTO the row-2
     terrace just below its floor line, so there is no coincident edge to
     read as a seam — the roof simply disappears into the stone. */
  /* Wide enough to fully cap the side skirts (outer edge |x| = 1.45) —
     no wall tops poking up as corner pillars at the back; the roof's own
     edges rest over solid terrace stone at every radius. */
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.35, 3.8), stone);
  roof.rotation.x = -ROOF_SLOPE;
  roof.position.set(0, 1.78, -13.0);
  roof.castShadow = true;
  scene.add(roof);
  /* Thick side skirts: wide enough to overlap the curved terrace edges
     along the whole run (gap half-width grows 0.87 → 1.27 with radius),
     grounded below grade and tucked up into the roof — no sliver anywhere
     for the unshadowed orchestra glow to leak through. */
  const wallGeo2 = new THREE.BoxGeometry(0.7, 2.6, 3.8);
  for (const sx of [-1.1, 1.1]) {
    const wall = new THREE.Mesh(wallGeo2, stone);
    wall.rotation.x = -ROOF_SLOPE; // follow the roof underside
    wall.position.set(sx, 0.5, -13.0);
    scene.add(wall);
  }
  /* Back cap sealing the hood against the terrace face below the flush line. */
  const backCap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 0.4), stone);
  backCap.position.set(0, 0.7, -14.6);
  scene.add(backCap);
  /* The throat dives steeply below grade right behind the portal, so it
     never slices through the terraces or seats above — a short stretch of
     open trench, then the line continues underground. */
  const throat = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 2.1, 4.4),
    new THREE.MeshBasicMaterial({ color: 0x08080c })
  );
  throat.rotation.x = -0.55;
  throat.position.set(0, -0.4, PORTAL_Z - 1.9);
  scene.add(throat);

  /* Guide lights: warm dots leading through the portal — "the line
     continues down here". */
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffc46a });
  for (let i = 0; i < 4; i++) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), dotMat);
    dot.position.set(0.62, 0.28, PORTAL_Z + 0.4 - i * 1.4);
    scene.add(dot);
  }
}

/* Warm pool of light on the plaza + small embers ringing the orchestra
   rim, so the bowl floor glows at night.

   The embers belong to the amphitheatre, not to the conversation: from
   the speaker vantage they sit right at the bottom of frame and read as
   floating orange balls, which is the one lighting cliché the redesign
   rules out. They live in their own group so the render loop can show
   them for the audience camera only — the warm point light stays lit for
   both, since that's what separates the gathering place from the night. */
function buildOrchestraGlow(scene: THREE.Scene): {
  light: THREE.PointLight;
  embers: THREE.Group;
} {
  /* The ember ring is retired — Classic Stone's standing lanterns carry
     the rim light now, as real objects that hold up from every vantage.
     The empty group keeps the render loop's audience-view toggle inert
     without a special case. */
  const embers = new THREE.Group();
  scene.add(embers);
  const glow = new THREE.PointLight(0xffa94d, 38, 26, 1.8);
  glow.position.set(0, 3, -3.5);
  glow.userData = { base: 36, flick: 2.5 };
  scene.add(glow);
  return { light: glow, embers };
}

/* Night sky for the low camera: seeded starfield dome + distant mountain
   silhouettes on the horizon behind the scaenae. */
function buildSky(scene: THREE.Scene): THREE.PointsMaterial[] {
  /* Gradient dome instead of a flat background colour + mountain cones:
     near-black at the zenith easing to a faintly blue horizon, so the
     ground fades into the sky with no visible seam (brief §19). Two
     triangles' worth of shader work, unlit and unfogged. */
  const domeGeo = new THREE.SphereGeometry(SKY.radius, 32, 20);
  const dome = new THREE.Mesh(
    domeGeo,
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: new THREE.Color(SKY.zenith) },
        horizon: { value: new THREE.Color(SKY.horizon) },
      },
      vertexShader: `
        varying float vH;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vH = normalize(world.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform vec3 zenith;
        uniform vec3 horizon;
        varying float vH;
        void main() {
          // Ease toward the horizon colour only near the skyline, so most
          // of the dome stays genuinely dark. The exponent is the band's
          // height: 3.0 let the blue arc climb behind the stage boxes,
          // 5.0 still read as a dome; 8.0 is a whisper at the skyline.
          float t = pow(clamp(1.0 - abs(vH), 0.0, 1.0), 8.0);
          gl_FragColor = vec4(mix(zenith, horizon, t), 1.0);
        }`,
    })
  );
  dome.renderOrder = -1;
  scene.add(dome);

  /* Sparse stars in three brightness layers. Splitting the field lets
     size and opacity vary without a per-point custom shader, and keeps
     each layer a single draw call. */
  const rng = mulberry32(hashString("agora-sky"));
  const mats: THREE.PointsMaterial[] = [];
  for (const layer of STARS.layers) {
    const positions = new Float32Array(layer.count * 3);
    for (let i = 0; i < layer.count; i++) {
      const a = rng() * Math.PI * 2;
      const elev = Math.asin(rng()); // bias toward the horizon
      const r = 115 + rng() * 10;
      positions[i * 3] = r * Math.cos(elev) * Math.cos(a);
      positions[i * 3 + 1] = 6 + r * Math.sin(elev);
      positions[i * 3 + 2] = r * Math.cos(elev) * Math.sin(a);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: layer.color,
      size: layer.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: layer.opacity,
      depthWrite: false,
      fog: false,
    });
    mat.userData = { base: layer.opacity };
    mats.push(mat);
    scene.add(new THREE.Points(geo, mat));
  }
  return mats;
}

export default function AgoraScene3D({
  roomId,
  audience,
  viewerCount,
  view,
  queue,
  micHolder,
  micLive,
  performanceMode = false,
  onViewSettled,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  /* The view lives in a ref so switching cameras never rebuilds the
     scene — the render loop just glides toward the new target. */
  const viewRef = useRef<AgoraView>(view);
  const onViewSettledRef = useRef(onViewSettled);
  onViewSettledRef.current = onViewSettled;
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  /* ── Speaker queue members ────────────────────────────────────────
     One Group per person, diffed by id: joining teleports you in (short
     ground glow), advancing slides you to the next slot (damped in the
     render loop — never a walk), leaving removes you. The mic holder is
     the same kind of member, targeted at the medallion. */
  const queueGroupRef = useRef<THREE.Group | null>(null);
  const queueMembersRef = useRef<Map<string, THREE.Group>>(new Map());
  const micMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const micStateRef = useRef({ occupied: false, live: false });
  const queueRef = useRef<SeatedPerson[]>(queue ?? []);
  queueRef.current = queue ?? [];
  const micHolderRef = useRef<SeatedPerson | null>(micHolder ?? null);
  micHolderRef.current = micHolder ?? null;
  micStateRef.current.live = !!micLive;

  const applyQueue = () => {
    const group = queueGroupRef.current;
    if (!group) return;
    const members = queueMembersRef.current;

    // Desired members: the capped queue line, each with a target spot.
    // The mic holder is deliberately NOT rendered at the medallion any
    // more — from the low speaker camera the lone figure read as a stick
    // with a ball planted mid-stage (user: "remove this stick thing").
    // The DOM stage boxes already show who holds the floor; the marble
    // stays clean. Their queue-line figure still leaves the line when
    // promoted, so the aisle thins as it should.
    const wanted = new Map<string, { person: SeatedPerson; x: number; y: number; z: number }>();
    const holder = micHolderRef.current;
    const line = queueRef.current;
    for (let i = 0; i < renderedCount(line.length); i++) {
      const p = line[i];
      if (!wanted.has(p.id)) wanted.set(p.id, { person: p, ...slotPosition(i) });
    }
    micStateRef.current.occupied = !!holder;

    // Remove the departed.
    for (const [id, g] of members) {
      if (wanted.has(id)) continue;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      group.remove(g);
      members.delete(id);
    }

    // Add newcomers (teleport + glow) and retarget everyone else (slide).
    for (const [id, w] of wanted) {
      const existing = members.get(id);
      if (existing) {
        existing.userData.target = new THREE.Vector3(w.x, w.y, w.z);
        continue;
      }
      const g = new THREE.Group();
      const tint = AVATAR_COLORS[hashString(id) % AVATAR_COLORS.length];
      const bodyMat = new THREE.MeshStandardMaterial({ color: tint, flatShading: true });
      const torso = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), bodyMat);
      torso.scale.set(1, 0.85, 0.9);
      torso.position.y = 0.72;
      torso.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), bodyMat.clone());
      (head.material as THREE.MeshStandardMaterial).color.multiplyScalar(1.15);
      head.position.y = 1.28;
      head.castShadow = true;
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(0.75, 20),
        new THREE.MeshBasicMaterial({
          color: tint,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.05;
      g.add(torso, head, glow);
      g.position.set(w.x, w.y, w.z); // teleport: appear at the slot
      g.userData.target = new THREE.Vector3(w.x, w.y, w.z);
      g.userData.spawnGlow = glow;
      g.userData.spawnAt = performance.now();
      group.add(g);
      members.set(id, g);
    }
  };
  const applyQueueRef = useRef(applyQueue);
  applyQueueRef.current = applyQueue;

  /* Content-keyed: identical refetches change nothing. Order matters (it
     IS the queue), so the key is the joined id sequence. */
  const queueKey = `${micHolder?.id ?? ""}|${(queue ?? [])
    .slice(0, renderedCount((queue ?? []).length))
    .map((p) => p.id)
    .join(",")}`;
  useEffect(() => {
    applyQueueRef.current();
  }, [queueKey]);

  /* The long-lived world (renderer, scene, camera, render loop) is built once
     per room. The crowd is the only data-driven part, so it lives in its own
     group that a second effect rebuilds in place — data refetches (30s
     heartbeat, realtime events) never tear down the WebGL context anymore,
     which is what used to hitch the animation every refresh. */
  const sceneRef = useRef<THREE.Scene | null>(null);
  const crowdRef = useRef<THREE.Group | null>(null);
  const audienceRef = useRef(audience);
  audienceRef.current = audience;
  const viewerCountRef = useRef(viewerCount);
  viewerCountRef.current = viewerCount;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /* ── Renderer / scene / camera ──
       Fill rate dominates on weak GPUs: cap the buffer at 1.5× and skip
       MSAA when the display is dense enough to hide jaggies on its own. */
    const dpr = performanceMode ? 1 : Math.min(window.devicePixelRatio, 1.5);
    const renderer = new THREE.WebGLRenderer({
      antialias: performanceMode ? false : dpr < 1.5,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(dpr);
    /* ACES filmic tone mapping is most of the difference between "render"
       and "photograph": without it every point light clips linearly to a
       flat orange plateau, which is exactly the cheap look. With it,
       highlights roll off, warm light stays warm as it brightens, and
       the marble's baked bloom reads like exposure instead of paint.
       Custom ShaderMaterials (sky dome, queue portal) skip tone mapping
       by construction, so the night sky keeps its exact tuned values. */
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.55;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    /* Reduced motion is read once per world build: it stills the camera
       breathe, the star twinkle and the stage flicker, leaving the scene
       composed but static. */
    const stillMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    /* The gradient dome paints the sky now; the background and fog just
       need to agree with its horizon so the ground melts into it. */
    scene.background = new THREE.Color(SKY.zenith);
    scene.fog = new THREE.FogExp2(SKY.horizon, 0.013);

    /* Two vantages, one camera:
       - audience: high and far, narrow lens — the level, symmetric bowl.
       - speaker: low in the orchestra, eye-level with the screens, open
         sky filling the frame behind them.
       The loop lerps position and look target, so switching views is a
       glide, not a cut. */
    const CAMS: Record<AgoraView, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
      audience: { pos: new THREE.Vector3(0, 40, 18.5), look: new THREE.Vector3(0, 1, -7) },
      /* Near floor level, gazing up. Two numbers tune this framing and
         they pull against each other:
         - pos.y is the eye height. Lower = more floor-level, and it
           raises how much marble survives at the frame's foot.
         - look.y is the pitch. Higher = the horizon (and its faint blue
           earth-curve band) drops toward the control row, and the
           starfield takes the frame — but past ~13 the marble leaves
           the bottom of the frame entirely (measured: at pos.y 4.2,
           look.y 16.5 put the band at the buttons and lost the floor).
         Current values put the band roughly midway between the video
         boxes and the view toggle with a marble sliver at the foot. */
      speaker: { pos: new THREE.Vector3(0, 3.9, -20.5), look: new THREE.Vector3(0, 9.3, 10) },
    };
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    const camPos = CAMS[viewRef.current].pos.clone();
    const camLook = CAMS[viewRef.current].look.clone();
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    /* ── Lights ── */
    scene.add(new THREE.HemisphereLight(0x24344a, 0x0c130c, 0.85));
    /* Down from 0.7 — the moon was most of what made the empty bowl glow
       blue. The seats keep a cool edge; the night keeps the frame. */
    const moon = new THREE.DirectionalLight(0x8ab4ff, 0.55);
    moon.position.set(-24, 38, -20);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = moon.shadow.camera.bottom = -45;
    moon.shadow.camera.right = moon.shadow.camera.top = 45;
    scene.add(moon);

    /* ── Build the world ──
       Environment first (sky, ground, platform), then the bowl, then the
       product surfaces. The scaenae frons and the stage torches that used
       to sit between the two are gone: behind the screens there is now
       only open sky. */
    buildGround(scene);
    const starMats = buildSky(scene);
    buildTerraces(scene);
    buildSideStairs(scene);
    buildOrchestra(scene);
    const lanternLights = buildClassicStone(scene);
    buildTrees(scene);
    const orchestraGlow = buildOrchestraGlow(scene);
    const warmLights = [...buildStageGlow(scene), orchestraGlow.light, ...lanternLights];
    /* Speaker queue: slot path + the members group. The mic totem that
       used to stand at the medallion is gone by request — the clean
       marble center is the stage now, and the mic holder standing there
       IS the marker. micMatRef stays wired (null) in case a floor-level
       mic cue returns. */
    buildQueuePath(scene);
    const queueGroup = new THREE.Group();
    scene.add(queueGroup);
    queueGroupRef.current = queueGroup;
    applyQueueRef.current();

    /* Crowd container — populated (and re-populated) by the crowd effect. */
    const crowd = new THREE.Group();
    scene.add(crowd);
    sceneRef.current = scene;
    crowdRef.current = crowd;

    /* ── Resize ── */
    /* A fixed 42° lens crops the stage focus as soon as the frame
       narrows, so the lens is solved rather than guessed: work out the
       horizontal angle the focus region subtends, convert it to the
       vertical FOV that guarantees it at this aspect, and never go below
       the 42° the wide layout is composed for. The environment yields as
       the frame narrows (brief §13).

       15.18 is the width the old holo panels occupied (13.68 + margin).
       The panels are gone — video lives in the DOM stage now — but the
       speaker vantage was composed around that region and the DOM boxes
       overlay exactly it, so the framing target survives the panels. */
    const STAGE_FOCUS_W = 15.18;
    const panelHalfWidth = SCREEN.spreadX + STAGE_FOCUS_W / 2;
    const fitDistance = SCREEN.z - CAMS.speaker.pos.z;
    /* The canvas now spans the whole viewport, including behind the chat
       rail, so the amphitheatre shows through the rail's glass instead of
       the rail being a dark box cut out of the scene.

       Filling the width naively would re-centre the composition on the
       viewport and push the participants behind the chat panel. Instead
       the camera renders an off-axis frustum: the projection is built for
       a virtual image wider than the canvas, and `setViewOffset` selects
       the window of it that lands on screen. The optical axis stays over
       the middle of the *main column*, so the framing is exactly what it
       was — the extra width is pure bleed behind the rail. */
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      /* The host is fixed to the viewport; its parent (.ag-theater) still
         measures the main column, which is what the shot is composed for. */
      const mainW = host.parentElement?.clientWidth || w;
      const railW = Math.max(0, w - mainW);
      /* Widening by the rail on the far side keeps world x=0 at the main
         column's centre once the offset window is applied. */
      const virtualW = w + railW;

      renderer.setSize(w, h, false);
      camera.aspect = virtualW / h;

      /* Framing is solved against the main column, not the canvas — the
         panels have to fit the part of the screen the viewer is actually
         watching, not the part hidden behind chat. */
      const mainAspect = mainW / h;
      /* Side breathing room is a luxury of wide frames. On a tall phone,
         asking for 16% margin drove the required lens past 90° and the
         panels cropped anyway — so the margin tightens as the frame
         narrows, spending the angle on the participants instead. */
      const margin = mainAspect < 1.1 ? 1.04 : 1.16;
      const neededHFov = 2 * Math.atan((panelHalfWidth * margin) / fitDistance);
      const neededVFov = 2 * Math.atan(Math.tan(neededHFov / 2) / mainAspect);
      /* The ceiling exists to stop the perspective going fish-eye; it has
         to clear the ~86° a portrait phone genuinely needs, or the fit it
         is protecting silently fails. */
      camera.fov = Math.min(96, Math.max(42, THREE.MathUtils.radToDeg(neededVFov)));

      /* railW is 0 when the layout stacks (the rail moves below the
         stage), which makes this the identity transform. */
      camera.setViewOffset(virtualW, h, railW, 0, w, h);
      camera.updateProjectionMatrix();
    };
    resize();
    /* Watch BOTH boxes. The canvas host is fixed to the viewport, so its
       size only changes when the window does — collapsing the chat rail
       never touches it. What does change is the main column (the host's
       parent), and that is what the shot is framed against: when the rail
       folds away the column widens, the camera re-fits, and the panels
       travel out into the reclaimed space. Observing only the host meant
       that recompute never fired and the composition sat still. */
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    if (host.parentElement) observer.observe(host.parentElement);

    /* ── Animate: torch flicker, camera glide + vertical breathing ──
       The camera glide uses exponential damping scaled by real frame time,
       so it moves at the same speed on a 60Hz laptop, a 120Hz display, or
       through a dropped-frame stutter — the fixed 0.045/frame lerp it
       replaces ran twice as fast at 120Hz and jerked when frames dropped. */
    let raf = 0;
    let settledNotified: AgoraView | null = null;
    const t0 = performance.now();
    let lastFrame = t0;
    const DAMP = 2.8; // ≈ the old 0.045/frame feel at 60fps

    /* Adaptive quality: if a device can't hold ~45fps over a ~3s window,
       step down once per window — first the glass frosting, then a 1×
       buffer, then shadows off. Steps are one-way; a machine that
       struggled once will struggle again, and oscillating quality is
       worse than stable-but-plainer.

       performanceMode (the egress compositor's software WebGL) starts at
       the floor: 1× buffer, no shadows — set at renderer init. */
    let quality = performanceMode ? 0 : 3;
    let frameAcc = 0;
    let frameN = 0;
    const stepDown = () => {
      quality -= 1;
      /* The first rung used to kill the holo panels' transmission; the
         panels are gone (video is DOM now — see AgoraStage), so the
         ladder starts at the pixel-ratio drop. */
      if (quality === 2) {
        renderer.setPixelRatio(1);
      } else {
        renderer.shadowMap.enabled = false;
        scene.traverse((o) => {
          const mat = (o as THREE.Mesh).material;
          if (!mat) return;
          (Array.isArray(mat) ? mat : [mat]).forEach((m) => (m.needsUpdate = true));
        });
      }
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastFrame) / 1000, 0.1); // clamp tab-return spikes
      lastFrame = now;
      const t = (now - t0) / 1000;
      if (quality > 0) {
        frameAcc += dt;
        frameN += 1;
        if (frameAcc >= 3) {
          if (frameN / frameAcc < 45) stepDown();
          frameAcc = 0;
          frameN = 0;
        }
      }
      if (!stillMotion) {
        /* A slow breath in the warm pool, an order of magnitude calmer
           than the old torch flicker (0.9s vs 9s harmonics). */
        warmLights.forEach((light, i) => {
          const { base, flick } = light.userData as { base: number; flick: number };
          light.intensity = base + Math.sin(t * 0.9 + i * 2.4) * flick;
        });
        /* Twinkle: each layer breathes on its own long period, and the
           amplitude is a tenth of base opacity — visible only if you stare
           at one star and wait. */
        starMats.forEach((m, i) => {
          const base = (m.userData as { base: number }).base;
          const period = STARS.twinklePeriods[i % STARS.twinklePeriods.length];
          m.opacity = base * (1 + Math.sin((t / period) * Math.PI * 2) * STARS.twinkleAmount);
        });
      }
      const target = CAMS[viewRef.current];
      const k = 1 - Math.exp(-DAMP * dt);
      camPos.lerp(target.pos, k);
      camLook.lerp(target.look, k);
      /* Announce arrival once per vantage: the exponential glide never
         mathematically lands, so "close enough to be still" is arrival. */
      if (camPos.distanceTo(target.pos) < 0.5 && settledNotified !== viewRef.current) {
        settledNotified = viewRef.current;
        onViewSettledRef.current?.(viewRef.current);
      }
      camera.position.copy(camPos);
      if (!stillMotion) camera.position.y += Math.sin(t * 0.07) * 0.35;
      camera.lookAt(camLook);
      /* Speaker queue: damp members toward their slots (advancing = a
         short slide, never a walk), fade spawn glows, pulse the mic. */
      const slideK = 1 - Math.exp(-6 * dt);
      queueGroupRef.current?.children.forEach((g) => {
        const target = g.userData.target as THREE.Vector3 | undefined;
        if (target) g.position.lerp(target, slideK);
        const glow = g.userData.spawnGlow as THREE.Mesh | undefined;
        if (glow) {
          const age = (performance.now() - (g.userData.spawnAt as number)) / 1000;
          const m = glow.material as THREE.MeshBasicMaterial;
          m.opacity = Math.max(0, 0.85 * (1 - age / 0.6));
          if (m.opacity === 0) {
            g.remove(glow);
            glow.geometry.dispose();
            m.dispose();
            delete g.userData.spawnGlow;
          }
        }
      });
      if (micMatRef.current) {
        const s = micStateRef.current;
        micMatRef.current.emissiveIntensity = s.live
          ? 1.5 + Math.sin(t * 6) * 0.45
          : s.occupied
            ? 0.9 + Math.sin(t * 2.4) * 0.2
            : 0.35;
      }

      orchestraGlow.embers.visible = viewRef.current === "audience";
      renderer.render(scene, camera);
    };
    animate();

    /* ── Teardown ── */
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      queueGroupRef.current = null;
      queueMembersRef.current.clear();
      micMatRef.current = null;
      sceneRef.current = null;
      crowdRef.current = null;
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [roomId]);

  /* ── Crowd occupancy — rebuilds only its own group, keyed by content so
     identical refetches (new array, same people) are complete no-ops. ── */
  const crowdKey = `${roomId}|${viewerCount}|${audience.map((a) => a.id).join(",")}`;
  useEffect(() => {
    const crowd = crowdRef.current;
    if (!crowd) return;

    // Dispose the previous crowd's GPU resources before repopulating.
    crowd.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
    crowd.clear();

    /* Occupancy (same seeded logic as before). */
    const people = audienceRef.current;
    const count = viewerCountRef.current;
    const seats = generateSeats();
    const rng = mulberry32(hashString(roomId));
    const bySide: Record<"pro" | "con", number[]> = { pro: [], con: [] };
    seats.forEach((s, i) => bySide[s.side].push(i));
    (["pro", "con"] as const).forEach((side) => {
      const arr = bySide[side];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    });
    const occupancy = new Map<number, SeatedPerson | null>();
    people.forEach((person, i) => {
      const side = i % 2 === 0 ? "pro" : "con";
      const idx = bySide[side].shift() ?? bySide[side === "pro" ? "con" : "pro"].shift();
      if (idx !== undefined) occupancy.set(idx, person);
    });
    const remaining = Math.max(0, count - people.length);
    for (let i = 0; i < remaining; i++) {
      const side = i % 2 === 0 ? "pro" : "con";
      const idx = bySide[side].shift() ?? bySide[side === "pro" ? "con" : "pro"].shift();
      if (idx === undefined) break;
      occupancy.set(idx, null);
    }

    buildChairsAndCrowd(crowd, seats, occupancy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crowdKey]);

  return <div ref={hostRef} className="ag-scene3d" />;
}
