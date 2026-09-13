/* The loading screen: the site's time-lapse of the night sky
   (lib/skySplash.ts, components/LoadingScreen.tsx). A fresh sky is
   scattered over the whole screen, then turns about the centre the way
   a long exposure records it, each star drawing its arc behind a bright
   head, gathering speed over the first moments and then turning
   steadily; the AS mark comes up at the centre after a beat. The arcs
   are SVG when the build has it (react-native-svg); a build without it,
   or reduce motion, shows the still sky with the mark at once. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, TurboModuleRegistry, UIManager, View, useWindowDimensions } from "react-native";
import { useReduceMotion } from "./motion";

type Star = { r: number; a: number; w: number; style: string };
type Group = { style: string; width: number; stars: Star[] };

const COLOURS: [number, number, number][] = [[200, 225, 255], [120, 170, 255], [255, 240, 214], [255, 183, 0]];
const SIZES: [number, number][] = [[0.7, 0.4], [1.2, 0.62], [1.9, 0.9]];
const TAU = Math.PI * 2;
const MARK_RATIO = 426 / 202;

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
  return speed * (s - ramp + ramp * Math.exp(-s / ramp));
}

function groupsOf(stars: Star[]): Group[] {
  const key = new Map<string, Group>();
  const out: Group[] = [];
  for (const st of stars) {
    const k = `${st.style}/${st.w}`;
    let g = key.get(k);
    if (!g) { g = { style: st.style, width: st.w, stars: [] }; key.set(k, g); out.push(g); }
    g.stars.push(st);
  }
  return out;
}

type SvgModule = typeof import("react-native-svg");
let svgMod: SvgModule | null | undefined;
function loadSvg(): SvgModule | null {
  if (svgMod !== undefined) return svgMod;
  try {
    const native = TurboModuleRegistry.get("RNSVGSvgViewModule") != null || !!UIManager.hasViewManagerConfig?.("RNSVGSvgView");
    if (!native) throw new Error("no native svg");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    svgMod = require("react-native-svg") as SvgModule;
  } catch {
    svgMod = null;
  }
  return svgMod;
}

const f = (n: number) => n.toFixed(1);

function arcsPath(g: Group, cx: number, cy: number, theta: number): string {
  const sweep = Math.min(theta, TAU - 0.01);
  let d = "";
  for (const s of g.stars) {
    const x0 = cx + s.r * Math.cos(s.a), y0 = cy + s.r * Math.sin(s.a);
    if (sweep < 0.002) {
      d += `M${f(x0)} ${f(y0)}l0.01 0`;
    } else {
      const a1 = s.a + sweep;
      d += `M${f(x0)} ${f(y0)}A${f(s.r)} ${f(s.r)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${f(cx + s.r * Math.cos(a1))} ${f(cy + s.r * Math.sin(a1))}`;
    }
  }
  return d;
}

function headsPath(g: Group, cx: number, cy: number, theta: number): string {
  const rad = g.width * 0.9;
  let d = "";
  for (const s of g.stars) {
    const a = s.a + theta;
    const x = cx + s.r * Math.cos(a), y = cy + s.r * Math.sin(a);
    d += `M${f(x + rad)} ${f(y)}a${rad} ${rad} 0 1 0 ${-2 * rad} 0a${rad} ${rad} 0 1 0 ${2 * rad} 0`;
  }
  return d;
}

/** The sky alone, filling its parent. `still` holds it at rest. */
export function Sky({ still = false, seed }: { still?: boolean; seed?: number }) {
  const { width: w, height: h } = useWindowDimensions();
  const svg = loadSvg();
  const stars = useMemo(() => scatterSky(seed ?? ((Math.random() * 4294967296) >>> 0), w, h), [seed, w, h]);
  const groups = useMemo(() => groupsOf(stars), [stars]);
  const [theta, setTheta] = useState(0);
  const rot = useRef(new Animated.Value(0)).current;
  const cx = w / 2, cy = h / 2;

  useEffect(() => {
    if (still) { setTheta(0); return; }
    if (!svg) {
      /* No arcs: the heads turn as one picture, easing in then steady. */
      rot.setValue(0);
      const anim = Animated.sequence([
        Animated.timing(rot, { toValue: 0.3, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(rot, { toValue: 0.3 + 6 * TAU, duration: (6 * TAU / 1.3) * 1000, easing: Easing.linear, useNativeDriver: true }),
      ]);
      anim.start();
      return () => anim.stop();
    }
    let raf = 0;
    let start: number | null = null;
    let last = 0;
    const frame = (now: number) => {
      if (start === null) start = now;
      if (now - last >= 33) {
        last = now;
        setTheta(turned((now - start) / 1000));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [still, svg, rot]);

  if (svg) {
    const { Svg, Path } = svg;
    return (
      <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
        {groups.map((g, i) => (
          <Path key={`t${i}`} d={arcsPath(g, cx, cy, theta)} stroke={g.style} strokeWidth={g.width} fill="none" strokeLinecap={theta < 0.002 ? "round" : "butt"} />
        ))}
        {groups.filter((g) => g.width >= 1).map((g, i) => (
          <Path key={`h${i}`} d={headsPath(g, cx, cy, theta)} fill={g.style} />
        ))}
      </Svg>
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

/** The whole screen: black, the sky turning, the mark at the centre after `markAt` ms. */
export function LoadingScreen({ label, markAt = 1000 }: { label?: string; markAt?: number }) {
  const reduce = useReduceMotion();
  const svg = loadSvg();
  const { width: w, height: h } = useWindowDimensions();
  const mark = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => Animated.timing(mark, { toValue: 1, duration: reduce ? 0 : 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(), reduce ? 0 : markAt);
    return () => clearTimeout(t);
  }, [mark, markAt, reduce]);
  const scale = mark.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000", overflow: "hidden" }]}>
      <Sky still={reduce} />
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
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", opacity: mark, transform: [{ scale }] }}>
        <Image source={require("../assets/as-mark.png")} style={{ height: 22, width: 22 * MARK_RATIO }} resizeMode="contain" accessibilityLabel="AgoraSphere" />
        {!!label && (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14 }}>
            <Text style={{ color: "#9aa0ac", fontSize: 12.5, letterSpacing: 0.5 }}>{label}</Text>
            <Ellipsis />
          </View>
        )}
      </Animated.View>
    </View>
  );
}
