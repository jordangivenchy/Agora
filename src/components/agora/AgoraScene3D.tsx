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
import type { Track } from "livekit-client";
import {
  MIC_POS,
  PORTAL_Z,
  VISIBLE_SLOTS,
  renderedCount,
  slotPosition,
} from "./queueLayout";
import { GLASS, GROUND, PLATFORM, SCREEN, SKY, STAGE_LIGHT, STARS } from "./sceneTokens";

export interface SeatedPerson {
  id: string;
  username: string;
  avatarUrl: string | null;
}

/** A live camera routed onto one of the stage holo screens. */
export interface ScreenFeed {
  /** Stable identity+track key — feed application is keyed on this. */
  key: string;
  track: Track;
}

export interface ScreenFeeds {
  pro?: ScreenFeed | null;
  con?: ScreenFeed | null;
}

/** Whoever holds a stage screen when their camera is off — the screen shows
    their profile photo (or an initial glyph) instead of the placeholder. */
export interface ScreenOccupant {
  id: string;
  /** Display name — this is what the holo nameplate renders. */
  name: string;
  avatarUrl: string | null;
}

export interface ScreenOccupants {
  pro?: ScreenOccupant | null;
  con?: ScreenOccupant | null;
}

export type AgoraView = "audience" | "speaker";

interface Props {
  roomId: string;
  audience: SeatedPerson[];
  viewerCount: number;
  view: AgoraView;
  /** Live camera feeds for the stage screens (pro = frame-left, con = right). */
  feeds?: ScreenFeeds;
  /** Screen holders without live video — profile card instead of placeholder. */
  occupants?: ScreenOccupants;
  /** Egress compositor (software WebGL, no GPU): start at the quality
      floor — 1x buffer, no shadows, no MSAA — instead of discovering it
      through the adaptive step-down. */
  performanceMode?: boolean;
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

function buildPlaza(scene: THREE.Scene) {
  /* The stone heart of the orchestra, like the reference: a raised
     circular medallion ringed by radial paver blocks. Pavers get a touch
     of seeded jitter in height and rotation so the paving reads
     hand-laid rather than machined. */
  const rng = mulberry32(hashString("agora-plaza"));
  /* Tangent to the stage platform's front edge (z ≈ 1.65) so the
     medallion reads as part of the stage structure, like the reference. */
  const center = new THREE.Vector3(0, 0, -1.6);

  // Raised medallion: two stacked discs, lighter stone on top.
  /* Disc heights are load-bearing: MIC_POS.y (0.45) and the queue's step
     up from the path both anchor to this stack, so the geometry stays put
     and only the stone tone comes down to match the new platform. */
  const baseDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(3.1, 3.25, 0.22, 40),
    new THREE.MeshStandardMaterial({ color: PLATFORM.stoneFace, roughness: 0.95 })
  );
  baseDisc.position.set(center.x, 0.11, center.z);
  baseDisc.receiveShadow = true;
  scene.add(baseDisc);
  const topDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(2.35, 2.35, 0.14, 36),
    new THREE.MeshStandardMaterial({ color: PLATFORM.stoneEdge, roughness: 0.95 })
  );
  topDisc.position.set(center.x, 0.29, center.z);
  topDisc.receiveShadow = true;
  scene.add(topDisc);
  // Dark inset at the very center — where the carved emblem will live.
  const inset = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, 0.05, 28),
    new THREE.MeshStandardMaterial({ color: 0x413b31, roughness: 1 })
  );
  inset.position.set(center.x, 0.38, center.z);
  scene.add(inset);

  // Radial paver rings around the medallion.
  const paverGeo = new THREE.BoxGeometry(1, 0.12, 0.72);
  /* Muted to near the platform tone. The paving should be legible up
     close in audience view and effectively invisible from the speaker
     vantage, rather than a bright ring around the medallion. */
  const shades = [0x4c473b, 0x453f35, 0x524c40];
  const meshes = shades.map(
    (c) =>
      new THREE.InstancedMesh(
        paverGeo,
        new THREE.MeshStandardMaterial({ color: c, flatShading: true }),
        160
      )
  );
  const counts = shades.map(() => 0);
  const dummy = new THREE.Object3D();
  const RINGS = 2;
  for (let ring = 0; ring < RINGS; ring++) {
    const r = 3.9 + ring * 0.85;
    const count = Math.floor((2 * Math.PI * r) / 1.12);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.13;
      const x = center.x + r * Math.cos(a);
      const z = center.z - r * Math.sin(a);
      // Keep pavers on the orchestra floor (inside the first terrace,
      // not spilling onto the stage side).
      if (Math.hypot(x, z) > INNER_R - 0.6 || z > 1.4) continue;
      // Part around the speaker-queue path corridor so the stone band
      // reaches the medallion without clipping through pavers.
      if (Math.abs(x) < 0.85 && z < -3.2) continue;
      const idx = Math.floor(rng() * shades.length);
      dummy.position.set(x, 0.06 + rng() * 0.025, z);
      dummy.rotation.set(0, a + Math.PI / 2 + (rng() - 0.5) * 0.06, 0);
      dummy.scale.setScalar(0.94 + rng() * 0.12);
      dummy.updateMatrix();
      meshes[idx].setMatrixAt(counts[idx]++, dummy.matrix);
    }
  }
  meshes.forEach((m, i) => {
    m.count = counts[i];
    m.receiveShadow = true;
    scene.add(m);
  });
}

/* The discussion platform: an architectural hint where a 17×1.1×7.5 stone
   block used to be. Two shallow elliptical steps totalling ~0.31 units of
   rise — under a third of the old platform — squashed along z so they read
   as a low disc in perspective and duck behind the control rail rather
   than competing with the screens (brief §4, §5). */
function buildStage(scene: THREE.Scene) {
  const edge = new THREE.MeshStandardMaterial({ color: PLATFORM.stoneEdge, roughness: 0.95 });
  const face = new THREE.MeshStandardMaterial({ color: PLATFORM.stoneFace, roughness: 0.95 });

  const step = (radius: number, rise: number, y: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, rise, 64), mat);
    mesh.position.set(0, y + rise / 2, PLATFORM.z);
    mesh.scale.z = PLATFORM.squash;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };

  step(PLATFORM.outerRadius, PLATFORM.outerRise, 0, face);
  step(PLATFORM.innerRadius, PLATFORM.innerRise, PLATFORM.outerRise, edge);

  /* Faint radial joints scribed across the upper step — segmentation you
     notice only after the conversation. One instanced draw call. */
  const jointGeo = new THREE.BoxGeometry(0.035, 0.012, PLATFORM.innerRadius * 0.94);
  const joints = new THREE.InstancedMesh(
    jointGeo,
    new THREE.MeshStandardMaterial({ color: PLATFORM.jointColor, roughness: 1 }),
    PLATFORM.jointCount
  );
  const dummy = new THREE.Object3D();
  const topY = PLATFORM.outerRise + PLATFORM.innerRise;
  for (let i = 0; i < PLATFORM.jointCount; i++) {
    const a = (i / PLATFORM.jointCount) * Math.PI * 2;
    dummy.position.set(
      (Math.cos(a) * PLATFORM.innerRadius) / 2,
      topY + 0.002,
      PLATFORM.z + (Math.sin(a) * PLATFORM.innerRadius * PLATFORM.squash) / 2
    );
    dummy.rotation.set(0, -a, 0);
    dummy.scale.set(1, 1, PLATFORM.squash);
    dummy.updateMatrix();
    joints.setMatrixAt(i, dummy.matrix);
  }
  scene.add(joints);
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
    color.setHex(
      occupied ? (proSide ? 0x6d4ab8 : 0x3a6cc2) : proSide ? 0x2f2456 : 0x1d2f56
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

/* The participant screens: translucent glass panels floating over the
   discussion area. These are WebGL quads, not DOM — CSS backdrop-filter
   can't reach them — so the glass is built from a frosted transmission
   backing (which genuinely refracts the starfield behind it), a thin
   light border, a top highlight, and a restrained per-side state colour.
   Hidden in audience view; the render loop shows them for the speaker
   vantage or whenever a live camera is on them. */
interface HoloSlot {
  side: "pro" | "con";
  panel: THREE.Mesh;
  baseMat: THREE.MeshBasicMaterial;
  /** Name plate in the panel's bottom-left corner. */
  nameMesh: THREE.Mesh;
  nameMat: THREE.MeshBasicMaterial;
  /** Rounded-corner mask, shared by the base material and occupant cards. */
  cornerMask: THREE.CanvasTexture;
}

/* Rounded-rectangle mask used as an alphaMap on the content plane. Keeps
   PlaneGeometry (and therefore the UVs the video cover-crop depends on)
   while cutting the corners — a rounded ShapeGeometry would renumber the
   UVs and break the crop maths. */
function roundedMask(w: number, h: number, radius: number): THREE.CanvasTexture {
  const px = 512;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = Math.round((px * h) / w);
  const ctx = canvas.getContext("2d")!;
  const r = (radius / w) * px;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, r);
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

/* A true rounded-rect outline: stroked, transparent inside. The border
   used to be a *filled* rounded plane at low opacity, which laid a solid
   translucent sheet over the whole panel instead of drawing an edge —
   that was most of the washed-out "bleeding" around the boxes. */
function roundedBorder(
  w: number,
  h: number,
  radius: number,
  thickness: number
): THREE.CanvasTexture {
  const px = 1024; // high enough that a hairline stroke stays crisp
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = Math.round((px * h) / w);
  const ctx = canvas.getContext("2d")!;
  const lw = Math.max(1.5, (thickness / w) * px);
  ctx.lineWidth = lw;
  ctx.strokeStyle = "#fff";
  ctx.beginPath();
  /* Inset by half the stroke so the line lands fully inside the bitmap —
     stroking on the exact edge clips the outer half and reads as an
     uneven, thicker-on-some-sides border. */
  ctx.roundRect(
    lw / 2,
    lw / 2,
    canvas.width - lw,
    canvas.height - lw,
    (radius / w) * px
  );
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

/* Rounded-rect outline as real geometry, for the glass backing. The
   transmission pass doesn't reliably honour an alphaMap, so the glass
   silhouette has to come from the mesh itself or its corners stay
   square while everything in front of it is round. */
function roundedShape(w: number, h: number, radius: number): THREE.Shape {
  const x = -w / 2;
  const y = -h / 2;
  const r = Math.min(radius, w / 2, h / 2);
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + w, y + h - r);
  shape.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x + r, y + h);
  shape.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + r);
  shape.absarc(x + r, y + r, r, Math.PI, 1.5 * Math.PI, false);
  return shape;
}

/* The name plate, drawn bottom-left over the video like a broadcast
   lower-third. Lives on its own plane so it survives the material swap
   between live video, profile card and empty seat. */
function drawNamePlate(name: string): { tex: THREE.CanvasTexture; aspect: number } {
  const W = 512;
  const H = 128;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "700 58px 'Space Grotesk', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  /* A soft shadow rather than a plate: the name has to stay legible over
     a bright camera feed without boxing it in. */
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fillText(name, 12, H / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: W / H };
}

/* Plane aspect used for cover-cropping live video onto the screens.
   Scaled down 10% from the original 15.2×8.8 to open negative space
   around the panels (brief §1, §8) — both axes by the same factor, so
   HOLO_W / HOLO_H is unchanged and the cover-crop maths still holds. */
const HOLO_W = 13.68;
const HOLO_H = 7.92;

function buildHoloScreens(scene: THREE.Scene): {
  group: THREE.Group;
  glassMats: THREE.MeshPhysicalMaterial[];
  slots: HoloSlot[];
} {
  const group = new THREE.Group();
  const glassMats: THREE.MeshPhysicalMaterial[] = [];
  const slots: HoloSlot[] = [];
  const W = HOLO_W;
  const H = HOLO_H;
  for (const sign of [-1, 1]) {
    const screen = new THREE.Group();

    /* Glass backing, a hair behind the content plane. Transmission is what
       frosts the stars showing through; stepDown() drops it to plain
       translucency on GPUs that can't hold frame rate. */
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: GLASS.tint,
      transparent: true,
      opacity: GLASS.opacity,
      transmission: GLASS.transmission,
      roughness: GLASS.roughness,
      thickness: GLASS.thickness,
      ior: GLASS.ior,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    glassMats.push(glassMat);
    /* One silhouette, three layers, all sharing the same rounded outline:
       glass bezel → content → border. The bezel is now a slim margin
       rather than the old 0.75-per-side frame, which read as a second box
       around the first. The glass uses real rounded geometry because the
       transmission pass ignores an alphaMap and left square corners
       behind the rounded content. */
    const bezel = GLASS.bezel;
    const bW = W + bezel * 2;
    const bHt = H + bezel * 2;
    const glassRadius = GLASS.cornerRadius + bezel;
    const glass = new THREE.Mesh(
      new THREE.ShapeGeometry(roundedShape(bW, bHt, glassRadius), 12),
      glassMat
    );
    glass.position.z = -0.03;
    screen.add(glass);

    /* Content plane: video texture or profile card, corners cut by a
       shared alpha mask — PlaneGeometry keeps the UVs the video
       cover-crop depends on. Fully opaque when a camera is live so the
       person always dominates the glass. */
    const cornerMask = roundedMask(W, H, GLASS.cornerRadius);
    const baseMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      transparent: true,
      alphaMap: cornerMask,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(W, H), baseMat);
    screen.add(panel);

    /* Thin light border tracing the bezel's edge. Stroked, not filled —
       and drawn in front of both the glass and the content so it reads as
       one continuous line rather than being half-covered by the panel. */
    const borderTex = roundedBorder(bW, bHt, glassRadius, GLASS.borderWidth);
    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(bW, bHt),
      new THREE.MeshBasicMaterial({
        color: GLASS.border,
        map: borderTex,
        alphaMap: borderTex,
        transparent: true,
        opacity: GLASS.borderOpacity,
        depthWrite: false,
      })
    );
    border.position.z = 0.02;
    screen.add(border);

    /* Name plate, anchored to the panel's bottom-left corner. Empty until
       applyOccupants fills it in; sized from the text bitmap's aspect so
       the glyphs never stretch. */
    const nameMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const nameMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), nameMat);
    nameMesh.position.z = 0.04;
    nameMesh.visible = false;
    screen.add(nameMesh);

    /* Empty-seat state — same dark card background as an occupant's
       profile card, with a dashed grey ring and "?" (matching the HTML
       rail's "Open seat" chip). Drawn once into the base material's
       texture; occupant cards and live video simply replace the material. */
    {
      const canvas = document.createElement("canvas");
      canvas.width = 760;
      canvas.height = 440;
      const ctx = canvas.getContext("2d")!;
      /* Translucent rather than solid #0a0c12: with no camera on the
         screen the glass backing and a few stars read through it, which
         is what ties the panel into the scene (brief §7E). */
      ctx.fillStyle = "rgba(10,12,18,0.42)";
      ctx.fillRect(0, 0, 760, 440);
      const cx = 380;
      const cy = 205;
      const r = 104;
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 5;
      ctx.setLineDash([14, 12]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "700 92px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", cx, cy + 4);
      const emptyTex = new THREE.CanvasTexture(canvas);
      emptyTex.colorSpace = THREE.SRGBColorSpace;
      baseMat.color.set(0xffffff);
      baseMat.map = emptyTex;
      baseMat.needsUpdate = true;
    }

    slots.push({
      side: sign > 0 ? "pro" : "con",
      panel,
      baseMat,
      nameMesh,
      nameMat,
      cornerMask,
    });

    /* Nudged up and forward now that the scaenae is gone: nothing behind
       them but sky, and the extra height opens visible atmosphere between
       the panels and the platform below (brief §8). */
    screen.position.set(sign * SCREEN.spreadX, SCREEN.y, SCREEN.z);
    // Face the audience (-z), turned a touch inward toward the center seat.
    screen.rotation.y = Math.PI + sign * 0.06;
    group.add(screen);
  }
  group.visible = false;
  scene.add(group);
  return { group, glassMats, slots };
}

/* ── Speaker queue architecture ─────────────────────────────────────
   The mic totem on the medallion, slot plates down the center aisle,
   and the tunnel portal at the orchestra rim. Static geometry — the
   queue members themselves live in a separate group the queue effect
   owns. */
function buildMicTotem(scene: THREE.Scene): { mat: THREE.MeshStandardMaterial } {
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.09, 1.35, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a3a42, flatShading: true })
  );
  stand.position.set(MIC_POS.x, MIC_POS.y + 0.68, MIC_POS.z);
  scene.add(stand);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x24242c,
    emissive: 0xffc46a,
    emissiveIntensity: 0.35,
    flatShading: true,
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat);
  head.position.set(MIC_POS.x, MIC_POS.y + 1.42, MIC_POS.z);
  scene.add(head);
  return { mat };
}

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
  const embers = new THREE.Group();
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffc46a });
  const flameGeo = new THREE.SphereGeometry(0.14, 6, 5);
  for (let a = 14; a <= 166; a += 12) {
    const r = INNER_R - 0.7;
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(r * Math.cos(a * DEG), 0.4, -r * Math.sin(a * DEG));
    embers.add(flame);
  }
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
          // of the dome stays genuinely dark.
          float t = pow(clamp(1.0 - abs(vH), 0.0, 1.0), 3.0);
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

/* Bookkeeping for one live feed applied to a holo panel. */
interface ActiveFeed {
  key: string;
  track: Track;
  el: HTMLVideoElement;
  tex: THREE.VideoTexture;
  mat: THREE.MeshBasicMaterial;
}

export default function AgoraScene3D({
  roomId,
  audience,
  viewerCount,
  view,
  feeds,
  occupants,
  queue,
  micHolder,
  micLive,
  performanceMode = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  /* The view lives in a ref so switching cameras never rebuilds the
     scene — the render loop just glides toward the new target. */
  const viewRef = useRef<AgoraView>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  /* Holo-screen video feeds. The slots come from the world build; feeds
     apply/teardown against them without ever touching the scene. The
     render loop shows the screens whenever a feed is live (any view) —
     otherwise only in speaker view, as before. */
  const holoSlotsRef = useRef<HoloSlot[] | null>(null);
  const activeFeedsRef = useRef<Map<string, ActiveFeed>>(new Map());
  const feedsRef = useRef<ScreenFeeds | undefined>(feeds);
  feedsRef.current = feeds;
  const hasLiveFeedRef = useRef(false);

  /* Profile cards for screen holders with no live camera. Drawn onto a
     CanvasTexture: initial glyph immediately, photo swapped in when it
     loads. Keyed on id+avatar so identical props are a no-op. */
  const occupantsRef = useRef<ScreenOccupants | undefined>(occupants);
  occupantsRef.current = occupants;
  const activeCardsRef = useRef<
    Map<string, { key: string; tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial }>
  >(new Map());
  /** Last username rendered onto each side's plate, so redraws are keyed. */
  const namePlateKeysRef = useRef<Map<string, string>>(new Map());

  const clearCard = (slot: HoloSlot) => {
    const card = activeCardsRef.current.get(slot.side);
    if (!card) return;
    card.tex.dispose();
    card.mat.dispose();
    if (slot.panel.material === card.mat) slot.panel.material = slot.baseMat;
    activeCardsRef.current.delete(slot.side);
  };

  const drawCard = (
    ctx: CanvasRenderingContext2D,
    o: ScreenOccupant,
    tint: string,
    img?: HTMLImageElement
  ) => {
    const W = 760;
    const H = 440;
    ctx.clearRect(0, 0, W, H);
    /* Camera-off state: translucent, so the glass and a hint of starfield
       carry through behind the avatar (brief §7E). A live feed replaces
       this material outright and stays fully opaque. */
    ctx.fillStyle = "rgba(10,12,18,0.42)";
    ctx.fillRect(0, 0, W, H);
    /* Avatar sits on the panel's centre line now that the name has moved
       to the bottom-left plate — it used to be pushed up to leave room for
       a centred caption underneath. */
    const cx = W / 2;
    const cy = H / 2;
    const r = 104;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    if (img) {
      ctx.clip();
      const s = Math.max((r * 2) / img.width, (r * 2) / img.height);
      ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
    } else {
      ctx.fillStyle = tint;
      ctx.fill();
      ctx.fillStyle = "rgba(10,12,18,0.85)";
      ctx.font = "700 96px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((o.name || "?").charAt(0).toUpperCase(), cx, cy + 6);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = tint;
    ctx.lineWidth = 5;
    ctx.stroke();
    /* No caption here — the username is drawn once onto the bottom-left
       name plate, which stays put across live video, profile card and
       empty seat rather than being redrawn into each state. */
  };

  /* Name plate: one bitmap per occupant, positioned bottom-left of the
     panel and scaled from the text's own aspect so glyphs never stretch. */
  const applyNamePlate = (slot: HoloSlot, name: string | null) => {
    const prev = slot.nameMat.map;
    if (!name) {
      slot.nameMesh.visible = false;
      slot.nameMat.opacity = 0;
      if (prev) {
        prev.dispose();
        slot.nameMat.map = null;
        slot.nameMat.needsUpdate = true;
      }
      return;
    }
    const { tex, aspect } = drawNamePlate(name);
    const h = GLASS.nameHeight;
    const w = h * aspect;
    slot.nameMesh.geometry.dispose();
    slot.nameMesh.geometry = new THREE.PlaneGeometry(w, h);
    /* Anchored to the panel's bottom-left as the viewer sees it. The
       screen group's 180° rotation turns the plane to face the camera but
       does not mirror what's drawn on it, so local -x is the viewer's
       left — verified on screen, not reasoned about. */
    slot.nameMesh.position.x = -HOLO_W / 2 + GLASS.nameInset + w / 2;
    slot.nameMesh.position.y = -HOLO_H / 2 + GLASS.nameInset + h / 2;
    slot.nameMat.map = tex;
    slot.nameMat.opacity = 1;
    slot.nameMat.needsUpdate = true;
    slot.nameMesh.visible = true;
    if (prev) prev.dispose();
  };

  const applyOccupants = () => {
    const slots = holoSlotsRef.current;
    if (!slots) return;
    for (const slot of slots) {
      const wanted = occupantsRef.current?.[slot.side] ?? null;
      const hasVideo = activeFeedsRef.current.has(slot.side);
      const key = wanted ? `${wanted.id}:${wanted.avatarUrl ?? ""}` : "";
      const card = activeCardsRef.current.get(slot.side);
      /* The plate is keyed to the occupant, not to the panel's current
         material, so it must be applied before any of the early exits
         below — a live camera skips the card path entirely. */
      if (namePlateKeysRef.current.get(slot.side) !== (wanted?.name ?? "")) {
        applyNamePlate(slot, wanted?.name ?? null);
        namePlateKeysRef.current.set(slot.side, wanted?.name ?? "");
      }
      if (card && (hasVideo || !wanted || card.key !== key)) clearCard(slot);
      if (!wanted || hasVideo || activeCardsRef.current.has(slot.side)) continue;

      const canvas = document.createElement("canvas");
      canvas.width = 760;
      canvas.height = 440;
      const ctx = canvas.getContext("2d")!;
      const tint = slot.side === "pro" ? "#a78bfa" : "#7ab8ff";
      drawCard(ctx, wanted, tint);

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.center.set(0.5, 0.5);
      /* Same rounded-corner mask the base material uses, so swapping to a
         profile card doesn't square the panel back off. */
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        alphaMap: slot.cornerMask,
      });
      slot.panel.material = mat;
      activeCardsRef.current.set(slot.side, { key, tex, mat });

      if (wanted.avatarUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          if (activeCardsRef.current.get(slot.side)?.key !== key) return;
          drawCard(ctx, wanted, tint, img);
          tex.needsUpdate = true;
        };
        img.src = wanted.avatarUrl;
      }
    }
  };

  const clearFeed = (slot: HoloSlot) => {
    const active = activeFeedsRef.current.get(slot.side);
    if (!active) return;
    active.track?.detach?.(active.el);
    active.el.remove();
    active.tex.dispose();
    active.mat.dispose();
    slot.panel.material = slot.baseMat;
    activeFeedsRef.current.delete(slot.side);
  };

  const applyFeeds = () => {
    const slots = holoSlotsRef.current;
    if (!slots) return;
    for (const slot of slots) {
      const wanted = feedsRef.current?.[slot.side] ?? null;
      const active = activeFeedsRef.current.get(slot.side);
      if (active && (!wanted || wanted.key !== active.key)) clearFeed(slot);
      if (!wanted || activeFeedsRef.current.has(slot.side)) continue;

      const el = wanted.track.attach() as HTMLVideoElement;
      el.muted = true; // audio plays through the call layer
      el.playsInline = true;
      el.style.display = "none";
      document.body.appendChild(el);

      const tex = new THREE.VideoTexture(el);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.center.set(0.5, 0.5);
      /* No X flip: canvas nameplate text proved the speaker-view camera
         sees these panels unmirrored (a -1 flip rendered text backwards),
         so video needs no correction either. */
      /* Cover-crop once the video reports its size. */
      const fit = () => {
        const vw = el.videoWidth;
        const vh = el.videoHeight;
        if (!vw || !vh) return;
        const videoAspect = vw / vh;
        const planeAspect = HOLO_W / HOLO_H;
        const sx = Math.sign(tex.repeat.x) || 1;
        if (videoAspect > planeAspect) {
          tex.repeat.set(sx * (planeAspect / videoAspect), 1);
        } else {
          tex.repeat.set(sx * 1, videoAspect / planeAspect);
        }
      };
      el.addEventListener("loadedmetadata", fit);
      fit();

      /* transparent + alphaMap only rounds the corners — the video itself
         stays fully opaque, so a live camera still dominates the glass. */
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        alphaMap: slot.cornerMask,
      });
      slot.panel.material = mat;
      activeFeedsRef.current.set(slot.side, { key: wanted.key, track: wanted.track, el, tex, mat });
    }
    hasLiveFeedRef.current = activeFeedsRef.current.size > 0;
    applyOccupants(); // cards fill whichever screens video left alone
  };
  const applyFeedsRef = useRef(applyFeeds);
  applyFeedsRef.current = applyFeeds;
  const clearFeedRef = useRef(clearFeed);
  clearFeedRef.current = clearFeed;
  const clearCardRef = useRef(clearCard);
  clearCardRef.current = clearCard;

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

    // Desired members: mic holder + capped queue, each with a target spot.
    const wanted = new Map<string, { person: SeatedPerson; x: number; y: number; z: number }>();
    const holder = micHolderRef.current;
    if (holder) wanted.set(holder.id, { person: holder, ...MIC_POS });
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

  /* Apply feed changes without touching the world. Keyed by content so a
     re-render with identical feeds is a no-op. */
  const feedKey = `${feeds?.pro?.key ?? ""}|${feeds?.con?.key ?? ""}`;
  useEffect(() => {
    applyFeedsRef.current();
  }, [feedKey]);

  /* Occupant cards re-apply on holder/avatar change (applyFeeds runs the
     card pass too, so feed changes are already covered). */
  const occKey = [occupants?.pro, occupants?.con]
    .map((o) => (o ? `${o.id}:${o.avatarUrl ?? ""}:${o.name}` : ""))
    .join("|");
  useEffect(() => {
    applyFeedsRef.current();
  }, [occKey]);

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
    renderer.shadowMap.enabled = !performanceMode;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    /* Reduced motion is read once per world build: it stills the camera
       breathe, the star twinkle and the stage flicker, leaving the scene
       composed but static. */
    const stillMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Captured up front so the teardown doesn't read a ref during cleanup.
       The Map instance is never reassigned, so this is the same object. */
    const namePlateKeys = namePlateKeysRef.current;

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
      /* Raised and aimed a touch higher than before so the panels sit in
         the upper-middle of the frame with open space around them, and the
         shallow platform reads as a hint along the bottom edge. */
      speaker: { pos: new THREE.Vector3(0, 6.4, -17), look: new THREE.Vector3(0, 5.6, 10) },
    };
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    const camPos = CAMS[viewRef.current].pos.clone();
    const camLook = CAMS[viewRef.current].look.clone();
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    /* ── Lights ── */
    scene.add(new THREE.HemisphereLight(0x24344a, 0x0c130c, 0.85));
    const moon = new THREE.DirectionalLight(0x8ab4ff, 0.7);
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
    buildPlaza(scene);
    buildStage(scene);
    buildTrees(scene);
    const orchestraGlow = buildOrchestraGlow(scene);
    const warmLights = [...buildStageGlow(scene), orchestraGlow.light];
    const holo = buildHoloScreens(scene);
    holoSlotsRef.current = holo.slots;
    applyFeedsRef.current(); // re-apply live feeds across a world rebuild

    /* Speaker queue: mic totem + slot path + the members group. */
    const mic = buildMicTotem(scene);
    micMatRef.current = mic.mat;
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
    /* A fixed 42° lens crops the outer screens as soon as the frame
       narrows, so the lens is solved rather than guessed: work out the
       horizontal angle the two panels actually subtend, convert it to the
       vertical FOV that guarantees it at this aspect, and never go below
       the 42° the wide layout is composed for. The environment yields as
       the frame narrows; the participants never leave it (brief §13). */
    const panelHalfWidth = SCREEN.spreadX + (HOLO_W + 1.5) / 2;
    const fitDistance = SCREEN.z - CAMS.speaker.pos.z;
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      const aspect = w / h;
      camera.aspect = aspect;
      /* Side breathing room is a luxury of wide frames. On a tall phone,
         asking for 16% margin drove the required lens past 90° and the
         panels cropped anyway — so the margin tightens as the frame
         narrows, spending the angle on the participants instead. */
      const margin = aspect < 1.1 ? 1.04 : 1.16;
      const neededHFov = 2 * Math.atan((panelHalfWidth * margin) / fitDistance);
      const neededVFov = 2 * Math.atan(Math.tan(neededHFov / 2) / aspect);
      /* The ceiling exists to stop the perspective going fish-eye; it has
         to clear the ~86° a portrait phone genuinely needs, or the fit it
         is protecting silently fails. */
      camera.fov = Math.min(96, Math.max(42, THREE.MathUtils.radToDeg(neededVFov)));
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    /* ── Animate: torch flicker, camera glide + vertical breathing ──
       The camera glide uses exponential damping scaled by real frame time,
       so it moves at the same speed on a 60Hz laptop, a 120Hz display, or
       through a dropped-frame stutter — the fixed 0.045/frame lerp it
       replaces ran twice as fast at 120Hz and jerked when frames dropped. */
    let raf = 0;
    const t0 = performance.now();
    let lastFrame = t0;
    const DAMP = 2.8; // ≈ the old 0.045/frame feel at 60fps

    /* Adaptive quality: if a device can't hold ~45fps over a ~3s window,
       step down once per window — first the glass frosting, then a 1×
       buffer, then shadows off. Steps are one-way; a machine that
       struggled once will struggle again, and oscillating quality is
       worse than stable-but-plainer.

       Transmission goes first because it costs a whole extra render pass:
       dropping it leaves the panels plainly translucent, which still
       reads as glass, where losing shadows changes the whole scene.

       performanceMode (the egress compositor's software WebGL) starts at
       the floor: no frosting, 1× buffer, no shadows. */
    let quality = performanceMode ? 0 : 3;
    if (performanceMode) {
      holo.glassMats.forEach((m) => {
        m.transmission = 0;
        m.opacity = 0.82;
        m.needsUpdate = true;
      });
    }
    let frameAcc = 0;
    let frameN = 0;
    const stepDown = () => {
      quality -= 1;
      if (quality === 2) {
        holo.glassMats.forEach((m) => {
          m.transmission = 0;
          m.opacity = 0.82; // compensate: no refraction to carry the tint
          m.needsUpdate = true;
        });
      } else if (quality === 1) {
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

      /* Participant screens: always up when a live camera is on them;
         otherwise only for the speaker vantage. The panels carry no
         speaking state of their own now — the halo, the coloured edge
         bars and the DOM waveform have all been removed. */
      orchestraGlow.embers.visible = viewRef.current === "audience";
      holo.group.visible = viewRef.current === "speaker" || hasLiveFeedRef.current;
      renderer.render(scene, camera);
    };
    animate();

    /* ── Teardown ── */
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      holo.slots.forEach((slot) => {
        clearFeedRef.current(slot);
        clearCardRef.current(slot);
      });
      holoSlotsRef.current = null;
      hasLiveFeedRef.current = false;
      /* The plate cache is keyed by username, but the meshes it tracks
         belong to the world being torn down. Leaving it populated made a
         rebuild (StrictMode's double-mount, or any remount) skip the
         redraw and leave the new panels nameless. */
      namePlateKeys.clear();
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
