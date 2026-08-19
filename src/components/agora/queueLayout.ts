/* The speaker queue's physical layout, as pure math.

   World frame (see AgoraScene3D): stage toward +z, seats at −z, the center
   aisle runs along x = 0. The mic stands on the plaza medallion at
   z = −1.6; the visible line stretches from just behind it back to the
   orchestra rim (INNER_R = 10), where a portal opens into a recessed
   tunnel that continues under the seating. Positions are feet-level —
   the scene adds body offsets. */

/* y is the marble floor's top surface. The raised medallion it used to
   stand on is gone — the Marble Agora is one flat tablet. */
export const MIC_POS = { x: 0, y: 0.17, z: -1.6 } as const;

/** Slots standing in the open on the orchestra floor. */
export const VISIBLE_SLOTS = 5;
/** Most queue members ever rendered; beyond this the tunnel "continues". */
export const RENDER_CAP = 12;

const FIRST_SLOT_Z = -4.4; // just behind the medallion's rim
const SPACING = 1.3;
/** Portal into the tunnel sits at the orchestra rim. */
export const PORTAL_Z = FIRST_SLOT_Z - VISIBLE_SLOTS * SPACING - 0.35; // ≈ −11.25
const TUNNEL_FLOOR_Y = -0.85;
const TUNNEL_RAMP_STEP = 0.3;

export interface QueueSlot {
  x: number;
  y: number;
  z: number;
  tunnel: boolean;
}

/** Feet position for 0-based queue index. Monotonic: lower index = closer mic. */
export function slotPosition(index: number): QueueSlot {
  const z = FIRST_SLOT_Z - index * SPACING;
  if (index < VISIBLE_SLOTS) return { x: 0, y: 0, z, tunnel: false };
  const depth = index - VISIBLE_SLOTS; // 0 = first tunnel slot
  const y = Math.max(TUNNEL_FLOOR_Y, -TUNNEL_RAMP_STEP * (depth + 1));
  return { x: 0, y, z, tunnel: true };
}

/** How many members to actually render for a queue of length n. */
export function renderedCount(n: number): number {
  return Math.min(n, RENDER_CAP);
}

/** People hidden past the render cap (shown as a "+N" depth cue). */
export function overflowCount(n: number): number {
  return Math.max(0, n - RENDER_CAP);
}
