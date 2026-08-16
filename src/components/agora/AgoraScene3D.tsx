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
    const wedges: { side: "pro" | "con"; from: number; to: number }[] = [
      { side: "con", from: EDGE + 2, to: 90 - AISLE_HALF - 1.5 },
      { side: "pro", from: 90 + AISLE_HALF + 1.5, to: 180 - EDGE - 2 },
    ];
    for (const w of wedges) {
      const arcLen = (w.to - w.from) * DEG * r;
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

function buildAisle(scene: THREE.Scene) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a7061, flatShading: true });
  const stepsPerRow = 3;
  const width = 2 * INNER_R * Math.sin(AISLE_HALF * DEG); // chord ≈ aisle width
  for (let i = 0; i < ROWS * stepsPerRow; i++) {
    const r = INNER_R + (i / stepsPerRow) * ROW_STEP;
    const h = BASE_H + Math.floor(i / stepsPerRow) * STEP_H + (i % stepsPerRow) * (STEP_H / stepsPerRow);
    const geo = new THREE.BoxGeometry(width + r * 0.06, h, ROW_STEP / stepsPerRow + 0.05);
    const step = new THREE.Mesh(geo, mat);
    step.position.set(0, h / 2, -(r + ROW_STEP / stepsPerRow / 2));
    step.receiveShadow = true;
    scene.add(step);
  }
}

function buildOrchestra(scene: THREE.Scene) {
  // Semicircular floor between the stage and the first row.
  const geo = new THREE.CircleGeometry(INNER_R, 48, 0, Math.PI);
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI); // open side toward the stage (+z)
  const floor = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x756b5d, flatShading: true })
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
  const baseDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(3.1, 3.25, 0.22, 40),
    new THREE.MeshStandardMaterial({ color: 0x857c6d, flatShading: true })
  );
  baseDisc.position.set(center.x, 0.11, center.z);
  baseDisc.receiveShadow = true;
  scene.add(baseDisc);
  const topDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(2.35, 2.35, 0.14, 36),
    new THREE.MeshStandardMaterial({ color: 0x93897a, flatShading: true })
  );
  topDisc.position.set(center.x, 0.29, center.z);
  topDisc.receiveShadow = true;
  scene.add(topDisc);
  // Dark inset at the very center — where the carved emblem will live.
  const inset = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, 0.05, 28),
    new THREE.MeshStandardMaterial({ color: 0x6e6557, flatShading: true })
  );
  inset.position.set(center.x, 0.38, center.z);
  scene.add(inset);

  // Radial paver rings around the medallion.
  const paverGeo = new THREE.BoxGeometry(1, 0.12, 0.72);
  const shades = [0x7f7668, 0x776e60, 0x89806f];
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
  const RINGS = 3;
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

function buildStage(scene: THREE.Scene) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x847a6b, flatShading: true });
  const platform = new THREE.Mesh(new THREE.BoxGeometry(17, 1.1, 7.5), stone);
  platform.position.set(0, 0.55, 5.4);
  platform.receiveShadow = true;
  platform.castShadow = true;
  scene.add(platform);

  /* Apron: a low collar reaching out from the platform and under the
     medallion's rim, so circle and stage read as one structure. */
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(8.6, 0.3, 3.6),
    new THREE.MeshStandardMaterial({ color: 0x7d7365, flatShading: true })
  );
  apron.position.set(0, 0.15, 0.6);
  apron.receiveShadow = true;
  scene.add(apron);
  // Side shoulders flanking the medallion, echoing the reference's
  // stepped stage front.
  const shoulderGeo = new THREE.BoxGeometry(3.4, 0.6, 2.2);
  for (const sign of [-1, 1]) {
    const shoulder = new THREE.Mesh(shoulderGeo, stone);
    shoulder.position.set(sign * 5.6, 0.3, 1.1);
    shoulder.receiveShadow = true;
    scene.add(shoulder);
  }
}

function buildChairsAndCrowd(
  scene: THREE.Scene,
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
  cushions.castShadow = backs.castShadow = true;

  // Crowd: head + torso for every occupied seat.
  const occupiedIdx = seats.map((_, i) => i).filter((i) => occupancy.has(i));
  const headGeo = new THREE.SphereGeometry(0.26, 10, 8);
  const torsoGeo = new THREE.SphereGeometry(0.4, 10, 8);
  torsoGeo.scale(1, 0.8, 0.9);
  const personMat = new THREE.MeshStandardMaterial({ flatShading: true });
  const heads = new THREE.InstancedMesh(headGeo, personMat, Math.max(1, occupiedIdx.length));
  const torsos = new THREE.InstancedMesh(torsoGeo, personMat.clone(), Math.max(1, occupiedIdx.length));
  heads.castShadow = torsos.castShadow = true;
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
  // Flanking woods near the stage sides
  for (let i = 0; i < 8; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    positions.push({
      x: sign * (OUTER_R * 0.62 + rng() * 9),
      z: 4 + rng() * 8,
      s: 0.9 + rng() * 1.0,
    });
  }

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

function buildGround(scene: THREE.Scene) {
  const geo = new THREE.CircleGeometry(90, 48);
  geo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x122016, flatShading: true })
  );
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);
}

function buildTorches(scene: THREE.Scene): THREE.PointLight[] {
  const torches: THREE.PointLight[] = [];
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0x3a332c, flatShading: true });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb45c });
  for (const sign of [-1, 1]) {
    const x = sign * 10.2;
    const z = 4.8;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2.6, 6), bowlMat);
    post.position.set(x, 1.3, z);
    post.castShadow = true;
    scene.add(post);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.45, 8), bowlMat);
    bowl.position.set(x, 2.75, z);
    scene.add(bowl);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), flameMat);
    flame.position.set(x, 3.1, z);
    scene.add(flame);
    const light = new THREE.PointLight(0xffa94d, 60, 34, 1.9);
    light.position.set(x, 3.4, z);
    light.userData = { base: 55, flick: 7 };
    scene.add(light);
    torches.push(light);
  }
  return torches;
}

/* The scaenae frons — the ruined stage building behind the platform, per
   the speaker-view reference: broken wall silhouette, a colonnade with
   entablature, statue silhouettes, a dark central doorway, and wall
   sconces. All blockout primitives; the whole structure is one .glb swap
   point later. */
function buildScaenae(scene: THREE.Scene): THREE.PointLight[] {
  const rng = mulberry32(hashString("agora-scaenae"));
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6f6557, flatShading: true });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c261f, flatShading: true });
  const statueMat = new THREE.MeshStandardMaterial({ color: 0x8d8474, flatShading: true });

  // Back deck bridging the platform to the wall.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(17, 0.9, 3.6), wallMat);
  deck.position.set(0, 0.45, 10.6);
  deck.receiveShadow = true;
  scene.add(deck);

  // Central wall block + lower side wings.
  const center = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 1.2), wallMat);
  center.position.set(0, 4.5, 13);
  center.castShadow = center.receiveShadow = true;
  scene.add(center);
  for (const sign of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(8.5, 5.8, 1.2), wallMat);
    wing.position.set(sign * 11, 2.9, 13);
    wing.castShadow = wing.receiveShadow = true;
    scene.add(wing);
  }
  // Ruined top: broken merlons along the crest.
  for (let i = 0; i < 9; i++) {
    const w = 0.8 + rng() * 1.6;
    const h = 0.4 + rng() * 1.2;
    const x = -7 + rng() * 14;
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.1), wallMat);
    block.position.set(x, 9 + h / 2, 13);
    block.castShadow = true;
    scene.add(block);
  }

  // Dark doorway at the center.
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, 4.4, 0.35), darkMat);
  door.position.set(0, 2.2, 12.3);
  scene.add(door);

  // Colonnade in front of the wall with an entablature beam.
  const colGeo = new THREE.CylinderGeometry(0.32, 0.36, 5, 10);
  const capGeo = new THREE.BoxGeometry(0.9, 0.32, 0.9);
  for (const x of [-6.6, -4.4, -2.2, 2.2, 4.4, 6.6]) {
    const col = new THREE.Mesh(colGeo, wallMat);
    col.position.set(x, 2.5 + 0.9, 11.6);
    col.castShadow = true;
    scene.add(col);
    const cap = new THREE.Mesh(capGeo, wallMat);
    cap.position.set(x, 5.9 + 0.16, 11.6);
    scene.add(cap);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.55, 1.1), wallMat);
  beam.position.set(0, 6.35, 11.6);
  beam.castShadow = true;
  scene.add(beam);

  // Statue silhouettes on plinths between columns.
  for (const x of [-5.5, -3.3, 3.3, 5.5]) {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), wallMat);
    plinth.position.set(x, 1.6, 11.9);
    scene.add(plinth);
    const figure = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.3, 3, 8), statueMat);
    figure.position.set(x, 2.9, 11.9);
    figure.castShadow = true;
    scene.add(figure);
  }

  // Wall sconces — smaller, calmer flames than the stage torches.
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb45c });
  const sconces: THREE.PointLight[] = [];
  for (const x of [-7.7, -3.3, 3.3, 7.7]) {
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), flameMat);
    flame.position.set(x, 5, 12.2);
    scene.add(flame);
    const light = new THREE.PointLight(0xffa94d, 26, 16, 1.9);
    light.position.set(x, 5.1, 12);
    light.userData = { base: 24, flick: 4 };
    scene.add(light);
    sconces.push(light);
  }
  return sconces;
}

/* The prime-vision screens: two big translucent panels floating over the
   stage — the future PRO/CON video feed surfaces — framed in shimmering
   holo borders like the reference. Hidden in audience view; the render
   loop fades them in for speaker view and cycles the frame hue. */
function buildHoloScreens(scene: THREE.Scene): { group: THREE.Group; frameMats: THREE.MeshBasicMaterial[] } {
  const group = new THREE.Group();
  const frameMats: THREE.MeshBasicMaterial[] = [];
  const W = 15.2;
  const H = 8.8;
  for (const sign of [-1, 1]) {
    const screen = new THREE.Group();
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
    );
    screen.add(panel);

    const frameMat = new THREE.MeshBasicMaterial({ color: 0x9be8ff });
    frameMats.push(frameMat);
    const barH = new THREE.BoxGeometry(W + 0.3, 0.13, 0.06);
    const barV = new THREE.BoxGeometry(0.13, H + 0.3, 0.06);
    for (const y of [-H / 2 - 0.08, H / 2 + 0.08]) {
      const bar = new THREE.Mesh(barH, frameMat);
      bar.position.y = y;
      screen.add(bar);
    }
    for (const x of [-W / 2 - 0.08, W / 2 + 0.08]) {
      const bar = new THREE.Mesh(barV, frameMat);
      bar.position.x = x;
      screen.add(bar);
    }

    /* Placeholder occupant — an empty-video-call silhouette so the panel
       reads as "a debater goes here": head, shoulders, and a nameplate
       bar, tinted by side. The camera looks toward +z, so world +x is
       frame-left: +x carries PRO purple, −x carries CON blue, matching
       the HTML rail below. */
    const tint = sign > 0 ? 0xa78bfa : 0x7ab8ff;
    const figMat = new THREE.MeshBasicMaterial({ color: tint });
    /* Children inherit the group's 180° turn, so local +z already faces
       the viewer — no extra rotation on the flat shapes. Head and
       shoulders are spaced apart (classic avatar-glyph gap) and sit at
       different depths, so the two shapes never intersect. */
    const head = new THREE.Mesh(new THREE.CircleGeometry(1.4, 28), figMat);
    head.position.set(0, 2.0, 0.08);
    screen.add(head);
    const shoulders = new THREE.Mesh(new THREE.CircleGeometry(2.6, 28, 0, Math.PI), figMat);
    shoulders.position.set(0, -2.1, 0.07);
    screen.add(shoulders);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 0.55, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x1c1c1f, transparent: true, opacity: 0.9 })
    );
    plate.position.set(0, -3.3, 0.07);
    screen.add(plate);
    const plateDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 12),
      new THREE.MeshBasicMaterial({ color: tint })
    );
    plateDot.position.set(-1.6, -3.3, 0.1);
    screen.add(plateDot);

    // Centers pushed apart so the doubled panels sit edge to edge with a
    // slim central gap, rising over the scaenae crest like projections.
    // z = 9.8 with a gentler tilt keeps the far edge (~z 10.3) clear of
    // the colonnade faces at z ≈ 11.2 — no clipping.
    screen.position.set(sign * 8.1, 7.4, 9.8);
    // Face the audience (-z), turned a touch inward toward the center seat.
    screen.rotation.y = Math.PI + sign * 0.06;
    group.add(screen);
  }
  group.visible = false;
  scene.add(group);
  return { group, frameMats };
}

/* Warm pool of light on the plaza + small flames ringing the orchestra
   rim, so the floor glows like the reference at night. */
function buildOrchestraGlow(scene: THREE.Scene): THREE.PointLight {
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffc46a });
  const flameGeo = new THREE.SphereGeometry(0.14, 6, 5);
  for (let a = 14; a <= 166; a += 12) {
    const r = INNER_R - 0.7;
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(r * Math.cos(a * DEG), 0.4, -r * Math.sin(a * DEG));
    scene.add(flame);
  }
  const glow = new THREE.PointLight(0xffa94d, 38, 26, 1.8);
  glow.position.set(0, 3, -3.5);
  glow.userData = { base: 36, flick: 2.5 };
  scene.add(glow);
  return glow;
}

/* Night sky for the low camera: seeded starfield dome + distant mountain
   silhouettes on the horizon behind the scaenae. */
function buildSky(scene: THREE.Scene) {
  const rng = mulberry32(hashString("agora-sky"));
  const starCount = 700;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    // Upper hemisphere shell, radius ~120.
    const a = rng() * Math.PI * 2;
    const elev = Math.asin(rng()); // bias toward the horizon
    const r = 115 + rng() * 10;
    positions[i * 3] = r * Math.cos(elev) * Math.cos(a);
    positions[i * 3 + 1] = 6 + r * Math.sin(elev);
    positions[i * 3 + 2] = r * Math.cos(elev) * Math.sin(a);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xbfd0ff,
      size: 0.55,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      fog: false,
    })
  );
  scene.add(stars);

  const mountainMat = new THREE.MeshStandardMaterial({ color: 0x0e1522, flatShading: true });
  const spots = [
    { x: -55, z: 85, r: 38, h: 13 },
    { x: -10, z: 92, r: 45, h: 10 },
    { x: 42, z: 84, r: 36, h: 15 },
    { x: 85, z: 70, r: 30, h: 9 },
    { x: -90, z: 65, r: 32, h: 11 },
  ];
  for (const m of spots) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(m.r, m.h, 7), mountainMat);
    cone.position.set(m.x, m.h / 2 - 0.5, m.z);
    scene.add(cone);
  }
}

export default function AgoraScene3D({ roomId, audience, viewerCount, view }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  /* The view lives in a ref so switching cameras never rebuilds the
     scene — the render loop just glides toward the new target. */
  const viewRef = useRef<AgoraView>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /* ── Occupancy (same seeded logic as before) ── */
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
    audience.forEach((person, i) => {
      const side = i % 2 === 0 ? "pro" : "con";
      const idx = bySide[side].shift() ?? bySide[side === "pro" ? "con" : "pro"].shift();
      if (idx !== undefined) occupancy.set(idx, person);
    });
    const remaining = Math.max(0, viewerCount - audience.length);
    for (let i = 0; i < remaining; i++) {
      const side = i % 2 === 0 ? "pro" : "con";
      const idx = bySide[side].shift() ?? bySide[side === "pro" ? "con" : "pro"].shift();
      if (idx === undefined) break;
      occupancy.set(idx, null);
    }

    /* ── Renderer / scene / camera ── */
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e0a);
    scene.fog = new THREE.FogExp2(0x0a0e0a, 0.011);

    /* Two vantages, one camera:
       - audience: high and far, narrow lens — the level, symmetric bowl.
       - speaker: low in the orchestra, eye-level with the stage, the
         scaenae and night sky filling the frame like the reference.
       The loop lerps position and look target, so switching views is a
       glide, not a cut. */
    const CAMS: Record<AgoraView, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
      audience: { pos: new THREE.Vector3(0, 40, 18.5), look: new THREE.Vector3(0, 1, -7) },
      /* A great seat: a few rows up on the center aisle, orchestra glowing
         below, screens and scaenae filling the frame. */
      speaker: { pos: new THREE.Vector3(0, 5.6, -17), look: new THREE.Vector3(0, 4.6, 10) },
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

    /* ── Build the world ── */
    buildGround(scene);
    buildSky(scene);
    buildTerraces(scene);
    buildAisle(scene);
    buildOrchestra(scene);
    buildPlaza(scene);
    buildStage(scene);
    buildChairsAndCrowd(scene, seats, occupancy);
    buildTrees(scene);
    const torches = [...buildTorches(scene), ...buildScaenae(scene), buildOrchestraGlow(scene)];
    const holo = buildHoloScreens(scene);

    /* ── Resize ── */
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    /* ── Animate: torch flicker, camera glide + vertical breathing ── */
    let raf = 0;
    const t0 = performance.now();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = (performance.now() - t0) / 1000;
      torches.forEach((torch, i) => {
        const { base, flick } = torch.userData as { base: number; flick: number };
        torch.intensity =
          base + Math.sin(t * 9 + i * 2.4) * flick + Math.sin(t * 23 + i) * flick * 0.55;
      });
      const target = CAMS[viewRef.current];
      camPos.lerp(target.pos, 0.045);
      camLook.lerp(target.look, 0.045);
      camera.position.copy(camPos);
      camera.position.y += Math.sin(t * 0.07) * 0.35;
      camera.lookAt(camLook);
      /* Holo screens exist only for the speaker vantage; their frames
         shimmer through slow hue drift while visible. */
      holo.group.visible = viewRef.current === "speaker";
      if (holo.group.visible) {
        holo.frameMats.forEach((m, i) => m.color.setHSL((t * 0.05 + i * 0.18) % 1, 0.6, 0.62));
      }
      renderer.render(scene, camera);
    };
    animate();

    /* ── Teardown ── */
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
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
  }, [roomId, audience, viewerCount]);

  return <div ref={hostRef} className="ag-scene3d" />;
}
