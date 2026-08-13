"use client";

/* The Agora amphitheater — a top-down semicircular theater rendered as
   procedural SVG so it scales to any room. Seats are generated in concentric
   arcs: the left wedge is PRO (purple), the right wedge CON (blue), with a
   central aisle between them. Occupancy is driven by real data — named
   spectators get initialed avatars, and the remaining viewer_count fills
   seats with generic figures, placed by a deterministic PRNG seeded from the
   room id so every visitor sees the same crowd. */

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

/* ── Deterministic PRNG (mulberry32) seeded from the room id ── */
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

interface Seat {
  x: number;
  y: number;
  rotation: number; // degrees; seat faces the stage
  side: "pro" | "con";
  row: number;
}

/* Geometry: semicircle opening downward toward the stage.
   Angles are measured from the positive x-axis; 0° = right, 180° = left.
   The aisle is a gap around 90°. */
const CX = 660;
const CY = 700;
const ROWS = 8;
const INNER_R = 235;
const ROW_STEP = 55;
const SEAT_SPACING = 46;
const AISLE_HALF_DEG = 5.2; // half-width of the central aisle, in degrees
const EDGE_DEG = 12; // trim at the far left/right ends

function generateSeats(): Seat[] {
  const seats: Seat[] = [];
  for (let row = 0; row < ROWS; row++) {
    const r = INNER_R + row * ROW_STEP;
    // Two arcs per row: PRO (left) from 90+aisle → 180-edge, CON (right)
    // from 0+edge → 90-aisle.
    const wedges: { side: "pro" | "con"; from: number; to: number }[] = [
      { side: "con", from: EDGE_DEG, to: 90 - AISLE_HALF_DEG },
      { side: "pro", from: 90 + AISLE_HALF_DEG, to: 180 - EDGE_DEG },
    ];
    for (const w of wedges) {
      const arcLen = ((w.to - w.from) * Math.PI * r) / 180;
      const count = Math.max(1, Math.floor(arcLen / SEAT_SPACING));
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const angle = w.from + t * (w.to - w.from);
        const rad = (angle * Math.PI) / 180;
        const x = CX + r * Math.cos(rad);
        const y = CY - r * Math.sin(rad);
        // Rotate so the seat back faces outward (seat looks at the stage).
        seats.push({ x, y, rotation: 90 - angle, side: w.side, row });
      }
    }
  }
  return seats;
}

const AVATAR_COLORS = [
  "#8b5cf6", "#4a9eff", "#e17055", "#00b894", "#fd79a8",
  "#e2b96b", "#00cec9", "#9c84ef", "#3ba3d0", "#eb459e",
];

function colorFor(id: string): string {
  return AVATAR_COLORS[hashString(id) % AVATAR_COLORS.length];
}

/* One occupied seat: chair highlight + person. Named audience members get an
   initialed disc; anonymous viewers get a simple figure. */
function Occupant({ seat, person }: { seat: Seat; person: SeatedPerson | null }) {
  const base = seat.side === "pro" ? "#6d4aa8" : "#3d6fb8";
  const glow = seat.side === "pro" ? "#a78bfa" : "#7ab8ff";
  return (
    <g transform={`translate(${seat.x} ${seat.y}) rotate(${seat.rotation})`}>
      <rect x={-16} y={-14} width={32} height={30} rx={7} fill={base} opacity={0.92} />
      <rect x={-16} y={-14} width={32} height={30} rx={7} fill="none" stroke={glow} strokeOpacity={0.35} strokeWidth={1} />
      {person ? (
        <>
          <circle r={10} cy={1} fill={colorFor(person.id)} />
          <text
            y={4.5}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            fill="#fff"
            style={{ userSelect: "none" }}
          >
            {(person.username || "?").charAt(0).toUpperCase()}
          </text>
          <title>{person.username}</title>
        </>
      ) : (
        <>
          {/* Generic viewer: head + shoulders */}
          <circle r={5.5} cy={-3} fill={glow} opacity={0.9} />
          <path d="M -8.5 9 A 8.5 8.5 0 0 1 8.5 9 Z" fill={glow} opacity={0.75} />
        </>
      )}
    </g>
  );
}

function EmptySeat({ seat }: { seat: Seat }) {
  const base = seat.side === "pro" ? "#2c2150" : "#1b2c4e";
  return (
    <g transform={`translate(${seat.x} ${seat.y}) rotate(${seat.rotation})`}>
      <rect x={-16} y={-14} width={32} height={30} rx={7} fill={base} opacity={0.85} />
      <rect x={-16} y={-6} width={32} height={22} rx={7} fill="#000" opacity={0.25} />
    </g>
  );
}

/* Speaker card on the stage: mic header, count, avatar row, animated wave. */
function SpeakerPanel({
  side,
  speakers,
}: {
  side: "pro" | "con";
  speakers: StagePerson[];
}) {
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
  /* Seat plan + occupancy, recomputed only when the crowd changes. */
  const { seats, occupancy } = useMemo(() => {
    const allSeats = generateSeats();
    const rng = mulberry32(hashString(roomId));

    // Shuffle seat indices per side (Fisher–Yates with the seeded PRNG) so
    // the crowd looks organic but identical for everyone.
    const bySide: Record<"pro" | "con", number[]> = { pro: [], con: [] };
    allSeats.forEach((s, i) => bySide[s.side].push(i));
    (["pro", "con"] as const).forEach((side) => {
      const arr = bySide[side];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    });

    // Named audience first (split evenly), then generic figures up to the
    // room's viewer_count.
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
    return { seats: allSeats, occupancy: occ };
  }, [roomId, audience, viewerCount]);

  return (
    <div className="ag-theater">
      <svg
        className="ag-theater-svg"
        viewBox="0 0 1320 760"
        preserveAspectRatio="xMidYMax meet"
        role="img"
        aria-label="Amphitheater seating"
      >
        {/* Ground: stone rings behind the seats */}
        {Array.from({ length: ROWS + 1 }, (_, i) => (
          <path
            key={i}
            d={describeArc(CX, CY, INNER_R - 28 + i * ROW_STEP, 8, 172)}
            fill="none"
            stroke="#3a3632"
            strokeOpacity={0.55}
            strokeWidth={ROW_STEP - 6}
          />
        ))}
        {/* Central aisle */}
        <rect x={CX - 26} y={CY - INNER_R - ROWS * ROW_STEP + 30} width={52} height={ROWS * ROW_STEP + 30} fill="#474139" opacity={0.55} />

        {seats.map((seat, i) =>
          occupancy.has(i) ? (
            <Occupant key={i} seat={seat} person={occupancy.get(i) ?? null} />
          ) : (
            <EmptySeat key={i} seat={seat} />
          )
        )}
      </svg>

      {/* The stage: stone platform, emblem, speaker panels, view toggle */}
      <div className="ag-stage">
        <div className="ag-stage-emblem">
          <span className="ag-stage-emblem-icon">🏛️</span>
        </div>
        <SpeakerPanel side="pro" speakers={proSpeakers} />
        <SpeakerPanel side="con" speakers={conSpeakers} />
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
    </div>
  );
}

/* SVG arc path helper (angles in degrees, 0° = right, CCW positive). */
function describeArc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const start = {
    x: cx + r * Math.cos((fromDeg * Math.PI) / 180),
    y: cy - r * Math.sin((fromDeg * Math.PI) / 180),
  };
  const end = {
    x: cx + r * Math.cos((toDeg * Math.PI) / 180),
    y: cy - r * Math.sin((toDeg * Math.PI) / 180),
  };
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`;
}
