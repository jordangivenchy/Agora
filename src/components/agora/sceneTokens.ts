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

/* Marble Agora — the discussion floor as one flat circular tablet of
   pale marble slabs, photoreal-leaning: the slab pattern, the veining,
   the joints and the warm center light are all BAKED into a procedural
   texture at build time (see buildClassicStone), because that soft
   lit-from-within look is a global-illumination effect no real-time
   point light can produce. Real lights still add the pools and flicker
   on top. */
export const STONE = {
  /** Main tablet: radius and the (flat, low) top height. MIC_POS.y in
      queueLayout must equal topY — the mic stands on this surface. */
  radius: 7.0,
  topY: 0.17,
  /** Outer step ring beneath the tablet's edge. */
  stepRadius: 7.55,
  stepRise: 0.085,
  /** Marble palette, HSL-ish anchors used by the texture bake. */
  sideColor: 0x6a6355,
  stepColor: 0x847c6c,
  /** How much the baked-light albedo self-illuminates. This is the "GI"
      dial: 0 = floor only visible where real lights reach; 0.5 = glows
      like a screenshot regardless of scene light. */
  emissive: 0.3,
  /** Perimeter lanterns. */
  lanternPost: 0x241f18,
  lanternFlame: 0xffc985,
  lanternLight: 0xffb570,
  /** Grass-and-rock fringe around the rim. */
  grass: 0x16281a,
  rockDark: 0x3a362e,
  rockPale: 0x5e584c,
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


/* Vertical breathing room so the screens float clear of the platform
   rather than sitting on it (brief §8). */
export const SCREEN = {
  /* Lowered from 7.9 when the scene went full-bleed: the canvas grew
     upward behind the topbar, which pushed the panels into it. */
  y: 7.1,
  z: 8.4,
  spreadX: 8.1,
} as const;
