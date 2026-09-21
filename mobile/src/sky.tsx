/* The loading screen: the site's time-lapse of the night sky
   (lib/skySplash.ts, components/LoadingScreen.tsx). A fresh sky is
   scattered over the whole screen, then turns about the centre the way
   a long exposure records it, each star drawing its arc behind a bright
   head, gathering speed over the first moments and then turning
   steadily; the AS mark comes up at the centre after a beat. The arcs
   are SVG paths rebuilt on the UI thread every frame (Reanimated), and
   the mark rises there too, so a busy JS thread — the app mounting
   beneath the opening, a page's data arriving — never stalls the turn.
   A build without react-native-svg, or reduce motion, shows the still
   sky with the mark at once. */
import { memo, useCallback, useEffect, useMemo, useRef, type ComponentType } from "react";
import { Animated, Easing, Image, Platform, StyleSheet, Text, TurboModuleRegistry, UIManager, View, useWindowDimensions } from "react-native";
import Reanimated, { Easing as REasing, useAnimatedProps, useAnimatedStyle, useFrameCallback, useSharedValue, withDelay, withTiming, type FrameInfo, type SharedValue } from "react-native-reanimated";
import { useReduceMotion } from "./motion";

type Star = { r: number; a: number; w: number; style: string };
/* The stars of one colour and width, as plain number lists a worklet can carry. */
type Trail = { style: string; width: number; r: number[]; a: number[] };

const COLOURS: [number, number, number][] = [[200, 225, 255], [120, 170, 255], [255, 240, 214], [255, 183, 0]];
/* Line widths a touch over the site's (0.7, 1.2, 1.9): drawn scaled down, its hairlines broke up. */
const SIZES: [number, number][] = [[0.9, 0.4], [1.3, 0.62], [1.9, 0.9]];
const TAU = Math.PI * 2;
const MARK_RATIO = 426 / 202;
const DRAW_SCALE = 0.75; // the turning sky's drawing size against the screen
const MAX_STEP_MS = 20; // the most one frame may move the sky on
const DRAW_EVERY_MS = 15; // at most one redraw a sixtieth: a 120 Hz screen would draw twice the work for no visible gain

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The site's scatter: polar about the centre, a tier's width, a colour at a fixed alpha. */
export function scatterSky(seed: number, w: number, h: number): Star[] {
  const rnd = seeded(seed);
  const px = w / 2, py = h / 2;
  const count = Math.max(220, Math.round(w * h * 0.00035));
  const m = Math.hypot(w, h) * 0.06;
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const x = -m + rnd() * (w + 2 * m), y = -m + rnd() * (h + 2 * m);
    const r = Math.hypot(x - px, y - py);
    if (r < 12) continue;
    const t = rnd();
    const size = SIZES[t < 0.7 ? 0 : t < 0.94 ? 1 : 2];
    const c = rnd();
    const col = COLOURS[c < 0.62 ? 0 : c < 0.84 ? 1 : c < 0.95 ? 2 : 3];
    const alpha = +(size[1] * (rnd() < 0.5 ? 0.72 : 1)).toFixed(2);
    stars.push({ r, a: Math.atan2(y - py, x - px), w: size[0], style: `rgba(${col[0]},${col[1]},${col[2]},${alpha})` });
  }
  return stars;
}

/* How far the sky has turned after s seconds: gathering speed, then steady. */
export function turned(s: number, speed = 1.3, ramp = 0.2): number {
  "worklet";
  return speed * (s - ramp + ramp * Math.exp(-s / ramp));
}

function trailsOf(stars: Star[]): Trail[] {
  const key = new Map<string, Trail>();
  const out: Trail[] = [];
  for (const st of stars) {
    const k = `${st.style}/${st.w}`;
    let t = key.get(k);
    if (!t) { t = { style: st.style, width: st.w, r: [], a: [] }; key.set(k, t); out.push(t); }
    t.r.push(st.r);
    t.a.push(st.a);
  }
  return out;
}

type SvgModule = typeof import("react-native-svg");
let svgMod: SvgModule | null | undefined;
function loadSvg(): SvgModule | null {
  if (svgMod !== undefined) return svgMod;
  try {
    /* On the web there is no native module to find: react-native-svg
       draws with the DOM there, so the probe below would say "no svg"
       and leave the web build with the still sky — a different opening
       from the site's and the phone's. */
    const native = Platform.OS === "web" || TurboModuleRegistry.get("RNSVGSvgViewModule") != null || !!UIManager.hasViewManagerConfig?.("RNSVGSvgView");
    if (!native) throw new Error("no native svg");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    svgMod = require("react-native-svg") as SvgModule;
  } catch {
    svgMod = null;
  }
  return svgMod;
}

/* Each star's arc, from where it started to where the sky has turned it. */
function arcsPath(r: number[], a: number[], cx: number, cy: number, theta: number): string {
  "worklet";
  const sweep = Math.min(theta, Math.PI * 2 - 0.01);
  const large = sweep > Math.PI ? 1 : 0;
  let d = "";
  for (let i = 0; i < r.length; i++) {
    const x0 = (cx + r[i] * Math.cos(a[i])).toFixed(1);
    const y0 = (cy + r[i] * Math.sin(a[i])).toFixed(1);
    if (sweep < 0.002) {
      d += `M${x0} ${y0}l0.01 0`;
    } else {
      const a1 = a[i] + sweep;
      const rr = r[i].toFixed(1);
      d += `M${x0} ${y0}A${rr} ${rr} 0 ${large} 1 ${(cx + r[i] * Math.cos(a1)).toFixed(1)} ${(cy + r[i] * Math.sin(a1)).toFixed(1)}`;
    }
  }
  return d;
}

/* The bright head at the leading end of each arc. */
function headsPath(r: number[], a: number[], rad: number, cx: number, cy: number, theta: number): string {
  "worklet";
  let d = "";
  for (let i = 0; i < r.length; i++) {
    const ang = a[i] + theta;
    const x = cx + r[i] * Math.cos(ang);
    const y = cy + r[i] * Math.sin(ang);
    d += `M${(x + rad).toFixed(1)} ${y.toFixed(1)}a${rad} ${rad} 0 1 0 ${-2 * rad} 0a${rad} ${rad} 0 1 0 ${2 * rad} 0`;
  }
  return d;
}

type PathProps = Record<string, unknown>;
let AnimatedPath: ComponentType<PathProps> | null = null;
function animatedPath(svg: SvgModule): ComponentType<PathProps> {
  if (!AnimatedPath) AnimatedPath = Reanimated.createAnimatedComponent(svg.Path) as unknown as ComponentType<PathProps>;
  return AnimatedPath;
}

type TrailProps = { trail: Trail; cx: number; cy: number; theta: SharedValue<number>; Path: ComponentType<PathProps> };

/* Memoised: their props never change, so a re-render of the sky (it
   starts, reduce motion loads) doesn't touch the paths. */
const TrailArcs = memo(function TrailArcs({ trail, cx, cy, theta, Path }: TrailProps) {
  const { r, a } = trail;
  const animatedProps = useAnimatedProps(() => ({ d: arcsPath(r, a, cx, cy, theta.value) }));
  return <Path animatedProps={animatedProps} stroke={trail.style} strokeWidth={trail.width} strokeLinecap="round" fill="none" />;
});

const TrailHeads = memo(function TrailHeads({ trail, cx, cy, theta, Path }: TrailProps) {
  const { r, a } = trail;
  const rad = +(trail.width * 0.9).toFixed(2);
  const animatedProps = useAnimatedProps(() => ({ d: headsPath(r, a, rad, cx, cy, theta.value) }));
  return <Path animatedProps={animatedProps} fill={trail.style} />;
});

/** The sky alone, filling its parent. `still` holds it at rest; it turns from
    the moment `start` is true (at once by default). */
export function Sky({ still = false, start = true, seed }: { still?: boolean; start?: boolean; seed?: number }) {
  const { width: w, height: h } = useWindowDimensions();
  const svg = loadSvg();
  const stars = useMemo(() => scatterSky(seed ?? ((Math.random() * 4294967296) >>> 0), w, h), [seed, w, h]);
  const trails = useMemo(() => trailsOf(stars), [stars]);
  const theta = useSharedValue(0);
  const rot = useRef(new Animated.Value(0)).current;
  const cx = w / 2, cy = h / 2;
  /* The turn keeps its own clock: useFrameCallback registers the callback
     afresh whenever it changes, and a fresh registration counts
     timeSinceFirstFrame from zero — the sky would snap back to its dots.
     A late frame advances it by no more than MAX_STEP_MS, so a stall
     reads as a pause rather than a leap; the arcs are redrawn at most
     every DRAW_EVERY_MS. */
  const last = useSharedValue(-1);
  const elapsed = useSharedValue(0);
  const drawn = useSharedValue(-1);
  const onFrame = useCallback((frame: FrameInfo) => {
    "worklet";
    const step = last.value < 0 ? 0 : Math.min(frame.timestamp - last.value, MAX_STEP_MS);
    last.value = frame.timestamp;
    elapsed.value += step;
    if (drawn.value >= 0 && frame.timestamp - drawn.value < DRAW_EVERY_MS) return;
    drawn.value = frame.timestamp;
    theta.value = turned(elapsed.value / 1000);
  }, [last, elapsed, drawn, theta]);
  const turn = useFrameCallback(onFrame, false);

  useEffect(() => {
    if (still || !start) { theta.value = 0; return; }
    if (svg) {
      last.value = -1;
      elapsed.value = 0;
      drawn.value = -1;
      turn.setActive(true);
      return () => turn.setActive(false);
    }
    /* No arcs: the heads turn as one picture, easing in then steady. */
    rot.setValue(0);
    const anim = Animated.sequence([
      Animated.timing(rot, { toValue: 0.3, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(rot, { toValue: 0.3 + 6 * TAU, duration: (6 * TAU / 1.3) * 1000, easing: Easing.linear, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, start, svg, rot]);

  if (svg) {
    const { Svg } = svg;
    const P = animatedPath(svg);
    /* Drawn at three-quarter size and shown at full: the arcs are redrawn
       on the CPU every frame, and fewer pixels keep that inside a frame
       (the site caps its canvas at 1.5x for the same reason). Half size
       was cheaper still, but its thinnest lines came out broken. */
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg
          width={w * DRAW_SCALE}
          height={h * DRAW_SCALE}
          viewBox={`0 0 ${w} ${h}`}
          style={{ position: "absolute", left: (w - w * DRAW_SCALE) / 2, top: (h - h * DRAW_SCALE) / 2, transform: [{ scale: 1 / DRAW_SCALE }] }}
        >
          {trails.map((t, i) => <TrailArcs key={`t${i}`} trail={t} cx={cx} cy={cy} theta={theta} Path={P} />)}
          {trails.map((t, i) => (t.width >= 1 ? <TrailHeads key={`h${i}`} trail={t} cx={cx} cy={cy} theta={theta} Path={P} /> : null))}
        </Svg>
      </View>
    );
  }
  const rotate = rot.interpolate({ inputRange: [0, TAU], outputRange: ["0rad", `${TAU}rad`] });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
      {stars.map((s, i) => {
        const size = Math.max(1.5, s.w * 1.8);
        return <View key={i} style={{ position: "absolute", left: cx + s.r * Math.cos(s.a) - size / 2, top: cy + s.r * Math.sin(s.a) - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: s.style }} />;
      })}
    </Animated.View>
  );
}

/* The ticking ellipsis after a label: three dots, one after another. */
export function Ellipsis({ color = "#9aa0ac" }: { color?: string }) {
  const dots = useRef([new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]).current;
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) return;
    const anims = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(v, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 500, useNativeDriver: true }),
          Animated.delay(400 - i * 200),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [dots, reduce]);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", marginLeft: 3, paddingBottom: 3 }}>
      {dots.map((v, i) => <Animated.View key={i} style={{ width: 3, height: 3, borderRadius: 1.5, marginLeft: 3, backgroundColor: color, opacity: v }} />)}
    </View>
  );
}

/** An in-page wait: a line with the ticking ellipsis, never a spinner. */
export function LoadingLine({ label = "Loading" }: { label?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 20, justifyContent: "center" }}>
      <Text style={{ color: "#9aa0ac", fontSize: 12.5, letterSpacing: 0.5 }}>{label}</Text>
      <Ellipsis />
    </View>
  );
}

/** The whole screen: black, the sky turning, the mark at the centre after
    `markAt` ms — both counted from `start` (at once by default). */
export function LoadingScreen({ label, markAt = 1000, start = true }: { label?: string; markAt?: number; start?: boolean }) {
  const reduce = useReduceMotion();
  const svg = loadSvg();
  const { width: w, height: h } = useWindowDimensions();
  const mark = useSharedValue(0);
  /* A sky that waits for `start` comes up out of the black as it begins. */
  const skyIn = useSharedValue(start ? 1 : 0);
  useEffect(() => {
    if (!start) return;
    skyIn.value = reduce ? 1 : withTiming(1, { duration: 300, easing: REasing.out(REasing.quad) });
    mark.value = reduce ? 1 : withDelay(markAt, withTiming(1, { duration: 800, easing: REasing.out(REasing.cubic) }));
  }, [mark, skyIn, markAt, reduce, start]);
  const skyStyle = useAnimatedStyle(() => ({ opacity: skyIn.value }));
  const markStyle = useAnimatedStyle(() => ({ opacity: mark.value, transform: [{ scale: 0.94 + 0.06 * mark.value }] }));
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000", overflow: "hidden" }]}>
      <Reanimated.View style={[StyleSheet.absoluteFill, skyStyle]} pointerEvents="none">
        <Sky still={reduce} start={start} />
      </Reanimated.View>
      {svg && (() => {
        const { Svg, Defs, RadialGradient, Stop, Ellipse } = svg;
        return (
          <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <RadialGradient id="pool" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#000" stopOpacity="0.92" />
                <Stop offset="0.42" stopColor="#000" stopOpacity="0.7" />
                <Stop offset="0.7" stopColor="#000" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Ellipse cx={w / 2} cy={h / 2} rx={110} ry={64} fill="url(#pool)" />
          </Svg>
        );
      })()}
      <Reanimated.View pointerEvents="none" style={[{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }, markStyle]}>
        <Image source={require("../assets/as-mark.png")} style={{ height: 22, width: 22 * MARK_RATIO }} resizeMode="contain" accessibilityLabel="AgoraSphere" />
        {!!label && (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14 }}>
            <Text style={{ color: "#9aa0ac", fontSize: 12.5, letterSpacing: 0.5 }}>{label}</Text>
            <Ellipsis />
          </View>
        )}
      </Reanimated.View>
    </View>
  );
}
