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

interface Props {
  roomId: string;
  audience: SeatedPerson[];
  viewerCount: number;
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

function buildStage(scene: THREE.Scene) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x847a6b, flatShading: true });
  const platform = new THREE.Mesh(new THREE.BoxGeometry(17, 1.1, 7.5), stone);
  platform.position.set(0, 0.55, 5.4);
  platform.receiveShadow = true;
  platform.castShadow = true;
  scene.add(platform);
  // Center medallion — placeholder for the Agora emblem.
  const medallion = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 0.14, 32),
    new THREE.MeshStandardMaterial({ color: 0x9a8f7d, flatShading: true })
  );
  medallion.position.set(0, 1.18, 4.6);
  medallion.castShadow = true;
  scene.add(medallion);
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
    scene.add(light);
    torches.push(light);
  }
  return torches;
}

export default function AgoraScene3D({ roomId, audience, viewerCount }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

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

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 200);
    const camBase = new THREE.Vector3(0, 26, 27);
    camera.position.copy(camBase);
    const lookAt = new THREE.Vector3(0, 1.5, -7);
    camera.lookAt(lookAt);

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
    buildTerraces(scene);
    buildAisle(scene);
    buildOrchestra(scene);
    buildStage(scene);
    buildChairsAndCrowd(scene, seats, occupancy);
    buildTrees(scene);
    const torches = buildTorches(scene);

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

    /* ── Animate: torch flicker + slow camera sway ── */
    let raf = 0;
    const t0 = performance.now();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = (performance.now() - t0) / 1000;
      torches.forEach((torch, i) => {
        torch.intensity = 55 + Math.sin(t * 9 + i * 2.4) * 7 + Math.sin(t * 23 + i) * 4;
      });
      camera.position.x = camBase.x + Math.sin(t * 0.11) * 1.4;
      camera.position.y = camBase.y + Math.sin(t * 0.07) * 0.5;
      camera.lookAt(lookAt);
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
