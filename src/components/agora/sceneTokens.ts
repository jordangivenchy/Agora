/* ── Agora environment design tokens ─────────────────────────────────
   Every colour and dimension the *environment* uses, in one place, so the
   night/ground/platform look can be tuned without reading the geometry.

   The scene deliberately keeps two identities:
   - `speaker` — a modern digital forum under the stars. Open sky behind
     the participant screens, a shallow stone hint underfoot.
   - `audience` — the amphitheatre proper: terraces, crowd, queue. That
     bowl is unchanged; these tokens only govern the shared environment
     and the stage area both cameras look at.

   The glass values here and `.ag-switch-view` in agora.css share the same
   translucent-navy treatment, so the WebGL screens and what's left of the
   HTML controls read as one system. */

export const SKY = {
  /** Straight overhead — near-black with a blue undertone. */
  zenith: 0x05070f,
  /** At the horizon, so ground and sky meet without a hard seam. */
  horizon: 0x0d1526,
  /** Dome radius; comfortably outside the terraces and the tree ring. */
  radius: 150,
} as const;

/* Three sparse star layers instead of one uniform field: a few bright
   ones carry the eye, the faint majority give depth. Counts stay low —
   the field should read as sparse, never as a Milky Way texture. */
export const STARS = {
  layers: [
    { count: 130, size: 1.0, opacity: 0.95, color: 0xe6ecff },
    { count: 300, size: 0.62, opacity: 0.7, color: 0xbfd0ff },
    { count: 460, size: 0.4, opacity: 0.42, color: 0x9fb2e0 },
  ],
  /** Twinkle amplitude as a fraction of base opacity — deliberately tiny. */
  twinkleAmount: 0.12,
  /** Seconds per twinkle cycle, per layer. Long and out of phase. */
  twinklePeriods: [17, 23, 31],
} as const;

export const GROUND = {
  /** Lit olive directly under the discussion area. */
  lit: "#1b2a1c",
  /** Mid falloff. */
  mid: "#101a12",
  /** Far edge — effectively the night itself. */
  far: "#070b09",
  radius: 90,
  /** Radial-gradient texture resolution. One 512² canvas, no tiling. */
  textureSize: 512,
} as const;

/* A hint of architecture, not a monument: two shallow steps whose total
   rise is a fraction of the old 1.1-unit stage block. Heights are chosen
   so the medallion top stays at MIC_POS.y — the speaker queue anchors to
   it, and that geometry is not ours to move. */
export const PLATFORM = {
  /** Outer step: the wide, barely-raised apron. */
  outerRadius: 7.4,
  outerRise: 0.16,
  /** Inner step. */
  innerRadius: 5.0,
  innerRise: 0.15,
  /** Ellipse flattening along z, so it reads as a shallow disc in perspective. */
  squash: 0.62,
  /** Front edge of the platform, matching the old stage's footprint centre. */
  z: 1.1,
  stoneEdge: 0x5a5346,
  stoneFace: 0x4a4438,
  /** Faint radial joints scribed into the top step. */
  jointColor: 0x6b6355,
  jointCount: 24,
} as const;

/* Cool night + one small warm pool at the centre. No torches, no lamps —
   the light has no visible source, which is what keeps it from reading as
   a video-game scene. */
export const STAGE_LIGHT = {
  color: 0xffb570,
  intensity: 26,
  distance: 22,
  decay: 1.9,
  position: { x: 0, y: 2.4, z: -1.2 },
  /** Flicker amplitude. Near-still; a warm pool, not a campfire. */
  flicker: 1.4,
} as const;

/* Participant screens. Translucent dark navy with a frosted transmission
   pass, a thin light border, and a restrained state colour per side —
   identity, not neon. */
export const GLASS = {
  /** Body tint — the WebGL equivalent of rgba(10,14,28,0.68). */
  tint: 0x0a0e1c,
  opacity: 0.68,
  /** Frosted refraction of the starfield. Dropped on weak GPUs. */
  transmission: 0.82,
  roughness: 0.34,
  thickness: 0.9,
  ior: 1.22,
  /** Thin border, matching --glass-border in globals.css. Stroked, not
      filled — `borderWidth` is the stroke's thickness in world units. */
  border: 0xffffff,
  borderOpacity: 0.34,
  borderWidth: 0.035,
  /** Glass margin around the content plane, per side. A slim bezel: at
      the old 0.75 it read as a second box drawn around the first. */
  bezel: 0.22,
  /** Corner radius on the content plane, in world units. The glass adds
      the bezel to this so both outlines stay concentric. */
  cornerRadius: 0.55,
  /** Per-side state colours, mirroring agora.css. Retained for the DOM
      side and for any future state cue on the panels. */
  pro: 0xa78bfa,
  con: 0x7ab8ff,
  /** Name plate height in world units, and its inset from the corner. */
  nameHeight: 0.62,
  nameInset: 0.42,
} as const;

/* Vertical breathing room so the screens float clear of the platform
   rather than sitting on it (brief §8). */
export const SCREEN = {
  /* Lowered from 7.9 when the scene went full-bleed: the canvas grew
     upward behind the topbar, which pushed the panels into it. */
  y: 7.1,
  z: 8.4,
  spreadX: 8.1,
} as const;
