"use client";

/* The Agora amphitheater — a fully procedural SVG scene, no image assets.
   Layers, bottom to top: night-grass ground → forest ring → stone theater
   (terrace bands, stepped aisle, outer wall) → stage lighting → seats →
   vignette. Everything lives in one viewBox so the scene scales losslessly
   with the window, and every element is real DOM we can animate or make
   interactive later.

   Occupancy is data-driven: named spectators get initialed avatars, and the
   room's viewer_count fills further seats with generic figures, placed by a
   PRNG seeded from the room id so every visitor sees the same crowd. The
   scenery uses its own fixed seed so the grove is identical across rooms —
   the Agora is one place; the debates pass through it. */

import { useMemo } from "react";

export interface StagePerson {
  id: string;
  username: string;
  avatarUrl: string | null;
  speaking: boolean;
}

export interface SeatedPerson {
  id: string;
  username: string;
  avatarUrl: string | null;
}

interface Props {
  roomId: string;
  proSpeakers: StagePerson[];
  conSpeakers: StagePerson[];
  audience: SeatedPerson[];
  viewerCount: number;
  onSwitchView?: () => void;
}

/* ── Deterministic PRNG (mulberry32) ── */
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

/* ── Scene geometry ─────────────────────────────────────────────
   Angles in degrees, 0° = right, 90° = up, measured around (CX, CY).
   The semicircle opens downward toward the stage. */
const VIEW_W = 1400;
const VIEW_H = 800;
const CX = 700;
const CY = 740;
const ROWS = 8;
const INNER_R = 250; // first terrace's inner edge
const ROW_STEP = 54;
const SEAT_SPACING = 47;
const AISLE_HALF_DEG = 5;
const EDGE_DEG = 13;
const OUTER_R = INNER_R + ROWS * ROW_STEP; // outer edge of the last terrace
const WALL_W = 18;

const pt = (r: number, deg: number) => ({
  x: CX + r * Math.cos((deg * Math.PI) / 180),
  y: CY - r * Math.sin((deg * Math.PI) / 180),
});

/* Donut-slice path between radii r0..r1 and angles a0..a1. */
function annularSector(r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const p1 = pt(r1, a0);
  const p2 = pt(r1, a1);
  const p3 = pt(r0, a1);
  const p4 = pt(r0, a0);
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${r1} ${r1} 0 ${large} 0 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${r0} ${r0} 0 ${large} 1 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
}

function arcPath(r: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const p1 = pt(r, a0);
  const p2 = pt(r, a1);
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 0 ${p2.x} ${p2.y}`;
}

interface Seat {
  x: number;
  y: number;
  rotation: number;
  side: "pro" | "con";
  row: number;
}

function generateSeats(): Seat[] {
  const seats: Seat[] = [];
  for (let row = 0; row < ROWS; row++) {
    const r = INNER_R + (row + 0.5) * ROW_STEP; // seat centered on its terrace
    const wedges: { side: "pro" | "con"; from: number; to: number }[] = [
      { side: "con", from: EDGE_DEG + 1.5, to: 90 - AISLE_HALF_DEG - 1 },
      { side: "pro", from: 90 + AISLE_HALF_DEG + 1, to: 180 - EDGE_DEG - 1.5 },
    ];
    for (const w of wedges) {
      const arcLen = ((w.to - w.from) * Math.PI * r) / 180;
      const count = Math.max(1, Math.floor(arcLen / SEAT_SPACING));
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const angle = w.from + t * (w.to - w.from);
        const p = pt(r, angle);
        seats.push({ x: p.x, y: p.y, rotation: 90 - angle, side: w.side, row });
      }
    }
  }
  return seats;
}

/* ── Scenery (fixed seed → identical grove for every room) ── */
interface Canopy {
  x: number;
  y: number;
  blobs: { dx: number; dy: number; r: number; shade: number }[];
}

const CANOPY_SHADES = ["#12281a", "#16301e", "#1a3823", "#1e4128", "#234b2e"];

function generateScenery(): Canopy[] {
  const rng = mulberry32(hashString("agora-grove"));
  const canopies: Canopy[] = [];

  const addCanopy = (x: number, y: number, scale: number) => {
    const blobCount = 4 + Math.floor(rng() * 3);
    const blobs = Array.from({ length: blobCount }, () => ({
      dx: (rng() - 0.5) * 52 * scale,
      dy: (rng() - 0.5) * 34 * scale,
      r: (16 + rng() * 20) * scale,
      shade: Math.floor(rng() * CANOPY_SHADES.length),
    }));
    canopies.push({ x, y, blobs });
  };

  // Ring of trees hugging the outside of the theater.
  for (let a = 4; a <= 176; a += 7 + rng() * 6) {
    const r = OUTER_R + WALL_W + 46 + rng() * 90;
    const p = pt(r, a);
    addCanopy(p.x, p.y, 0.8 + rng() * 0.7);
  }
  // Denser corner woods at the bottom edges, flanking the stage.
  for (let i = 0; i < 7; i++) {
    addCanopy(30 + rng() * 190, 560 + rng() * 220, 0.9 + rng() * 0.8);
    addCanopy(VIEW_W - 30 - rng() * 190, 560 + rng() * 220, 0.9 + rng() * 0.8);
  }
  return canopies;
}

const SCENERY = generateScenery();
const SEATS = generateSeats();

const AVATAR_COLORS = [
  "#8b5cf6", "#4a9eff", "#e17055", "#00b894", "#fd79a8",
  "#e2b96b", "#00cec9", "#9c84ef", "#3ba3d0", "#eb459e",
];

function colorFor(id: string): string {
  return AVATAR_COLORS[hashString(id) % AVATAR_COLORS.length];
}

/* ── Seat renderers: chair (backrest + cushion), then whoever's in it ── */

function Chair({ seat, occupied }: { seat: Seat; occupied: boolean }) {
  const back = seat.side === "pro" ? (occupied ? "#5b3fa0" : "#332560") : occupied ? "#2f5ba8" : "#1e3260";
  const cushion = seat.side === "pro" ? (occupied ? "#6d4ab8" : "#3b2b6e") : occupied ? "#3a6cc2" : "#243c70";
  return (
    <>
      {/* backrest (away from the stage) */}
      <rect x={-15} y={-16} width={30} height={10} rx={4} fill={back} />
      {/* cushion */}
      <rect x={-14} y={-7} width={28} height={22} rx={6} fill={cushion} />
      <rect x={-14} y={3} width={28} height={12} rx={6} fill="#000" opacity={0.22} />
    </>
  );
}

function SeatNode({ seat, person, occupied }: { seat: Seat; person: SeatedPerson | null; occupied: boolean }) {
  const glow = seat.side === "pro" ? "#a78bfa" : "#7ab8ff";
  return (
    <g
      className="ag-seat"
      transform={`translate(${seat.x} ${seat.y}) rotate(${seat.rotation})`}
    >
      <Chair seat={seat} occupied={occupied} />
      {occupied &&
        (person ? (
          <>
            <circle r={10} cy={2} fill={colorFor(person.id)} stroke="rgba(255,255,255,0.35)" strokeWidth={1.2} />
            <text y={5.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff" style={{ userSelect: "none" }}>
              {(person.username || "?").charAt(0).toUpperCase()}
            </text>
            <title>{person.username}</title>
          </>
        ) : (
          <>
            <circle r={5.5} cy={-2} fill={glow} opacity={0.9} />
            <path d="M -8.5 10 A 8.5 8.5 0 0 1 8.5 10 Z" fill={glow} opacity={0.7} />
          </>
        ))}
    </g>
  );
}

/* ── Stage speaker panel ── */

function SpeakerPanel({ side, speakers }: { side: "pro" | "con"; speakers: StagePerson[] }) {
  const speakingCount = speakers.filter((s) => s.speaking).length || speakers.length;
  return (
    <div className={`ag-stage-panel ag-stage-panel--${side}`}>
      <div className="ag-stage-panel-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="ag-stage-panel-title">{side === "pro" ? "PRO SIDE" : "CON SIDE"}</span>
      </div>
      <div className="ag-stage-panel-count">
        {speakers.length === 0 ? "Open seat" : `${speakingCount} Speaking`}
      </div>
      <div className="ag-stage-avatars">
        {speakers.length === 0 && <div className="ag-stage-avatar ag-stage-avatar--empty">?</div>}
        {speakers.slice(0, 4).map((s) => (
          <div key={s.id} className="ag-stage-avatar" style={{ background: colorFor(s.id) }} title={s.username}>
            {(s.username || "?").charAt(0).toUpperCase()}
            {s.speaking && <span className="ag-speaking-ring" />}
          </div>
        ))}
      </div>
      <div className="ag-wave" aria-hidden>
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} style={{ animationDelay: `${(i % 8) * 0.12}s` }} />
        ))}
      </div>
    </div>
  );
}

export default function Amphitheater({
  roomId,
  proSpeakers,
  conSpeakers,
  audience,
  viewerCount,
  onSwitchView,
}: Props) {
  /* Occupancy: named audience first (alternating sides), then generic
     figures up to viewer_count, in seeded-shuffled seat order. */
  const occupancy = useMemo(() => {
    const rng = mulberry32(hashString(roomId));
    const bySide: Record<"pro" | "con", number[]> = { pro: [], con: [] };
    SEATS.forEach((s, i) => bySide[s.side].push(i));
    (["pro", "con"] as const).forEach((side) => {
      const arr = bySide[side];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    });

    const occ = new Map<number, SeatedPerson | null>();
    audience.forEach((person, i) => {
      const side = i % 2 === 0 ? "pro" : "con";
      const seatIdx = bySide[side].shift() ?? bySide[side === "pro" ? "con" : "pro"].shift();
      if (seatIdx !== undefined) occ.set(seatIdx, person);
    });
    const remaining = Math.max(0, viewerCount - audience.length);
    for (let i = 0; i < remaining; i++) {
      const side = i % 2 === 0 ? "pro" : "con";
      const seatIdx = bySide[side].shift() ?? bySide[side === "pro" ? "con" : "pro"].shift();
      if (seatIdx === undefined) break;
      occ.set(seatIdx, null);
    }
    return occ;
  }, [roomId, audience, viewerCount]);

  const aisleSteps = Array.from({ length: ROWS + 1 }, (_, i) => INNER_R + i * ROW_STEP);

  return (
    <div className="ag-theater">
      <svg
        className="ag-theater-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMax meet"
        role="img"
        aria-label="Amphitheater seating"
      >
        <defs>
          {/* Night grass: a cool green breathing out from the theater */}
          <radialGradient id="ag-ground" cx="50%" cy="88%" r="85%">
            <stop offset="0%" stopColor="#182a1a" />
            <stop offset="45%" stopColor="#111e13" />
            <stop offset="100%" stopColor="#0a0e0a" />
          </radialGradient>
          {/* Warm torchlight pooling over the stage */}
          <radialGradient id="ag-stagelight" cx="50%" cy="100%" r="62%">
            <stop offset="0%" stopColor="#f4d47c" stopOpacity="0.14" />
            <stop offset="45%" stopColor="#f4d47c" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#f4d47c" stopOpacity="0" />
          </radialGradient>
          {/* Edge vignette */}
          <radialGradient id="ag-vignette" cx="50%" cy="60%" r="75%">
            <stop offset="0%" stopColor="#000" stopOpacity="0" />
            <stop offset="72%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.5" />
          </radialGradient>
        </defs>

        {/* 1 ── ground */}
        <rect width={VIEW_W} height={VIEW_H} fill="url(#ag-ground)" />

        {/* 2 ── forest ring */}
        <g>
          {SCENERY.map((c, i) => (
            <g key={i}>
              {c.blobs.map((b, j) => (
                <circle
                  key={j}
                  cx={c.x + b.dx}
                  cy={c.y + b.dy}
                  r={b.r}
                  fill={CANOPY_SHADES[b.shade]}
                  opacity={0.9}
                />
              ))}
            </g>
          ))}
        </g>

        {/* 3 ── stone theater */}
        {/* outer boundary wall */}
        <path
          d={annularSector(OUTER_R, OUTER_R + WALL_W, EDGE_DEG - 3, 180 - EDGE_DEG + 3)}
          fill="#2f2b26"
        />
        {/* terrace bands, alternating stone shades, risers between */}
        {Array.from({ length: ROWS }, (_, i) => {
          const r0 = INNER_R + i * ROW_STEP;
          return (
            <g key={i}>
              <path
                d={annularSector(r0, r0 + ROW_STEP, EDGE_DEG, 180 - EDGE_DEG)}
                fill={i % 2 === 0 ? "#46413a" : "#413c36"}
              />
              <path d={arcPath(r0, EDGE_DEG, 180 - EDGE_DEG)} fill="none" stroke="#2b2723" strokeWidth={2.5} />
            </g>
          );
        })}
        {/* orchestra floor between stage and first row */}
        <path d={annularSector(INNER_R - 62, INNER_R, EDGE_DEG - 2, 182 - EDGE_DEG)} fill="#4c463e" />
        <path d={arcPath(INNER_R, EDGE_DEG, 180 - EDGE_DEG)} fill="none" stroke="#28241f" strokeWidth={3} />

        {/* stepped central aisle */}
        <path
          d={annularSector(INNER_R - 62, OUTER_R + WALL_W, 90 - AISLE_HALF_DEG, 90 + AISLE_HALF_DEG)}
          fill="#575148"
        />
        {aisleSteps.map((r) => {
          const a = pt(r, 90 - AISLE_HALF_DEG);
          const b = pt(r, 90 + AISLE_HALF_DEG);
          return <line key={r} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#3a352f" strokeWidth={2.5} />;
        })}

        {/* 4 ── stage light pooling up from the bottom */}
        <rect width={VIEW_W} height={VIEW_H} fill="url(#ag-stagelight)" pointerEvents="none" />

        {/* 5 ── seats */}
        {SEATS.map((seat, i) => (
          <SeatNode key={i} seat={seat} person={occupancy.get(i) ?? null} occupied={occupancy.has(i)} />
        ))}

        {/* 6 ── vignette */}
        <rect width={VIEW_W} height={VIEW_H} fill="url(#ag-vignette)" pointerEvents="none" />
      </svg>

      {/* The stage: platform, emblem + view toggle in the center column */}
      <div className="ag-stage">
        <SpeakerPanel side="pro" speakers={proSpeakers} />
        <div className="ag-stage-center">
          <div className="ag-stage-emblem">
            <span className="ag-stage-emblem-icon">🏛️</span>
          </div>
          <button
            className="ag-switch-view"
            onClick={onSwitchView}
            disabled={!onSwitchView}
            title="Speaker view — coming soon"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M8 21h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>
              <strong>Switch speaker view</strong>
              <small>focused view of the debaters</small>
            </span>
          </button>
        </div>
        <SpeakerPanel side="con" speakers={conSpeakers} />
      </div>
    </div>
  );
}
