/* The site's starfield behind the home page: a fixed scatter of tiny
   dots, mostly white, a few yellow. Seeded, so it never twinkles into a
   different sky on re-render. */
import { useMemo } from "react";
import { View } from "react-native";

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function Starfield({ width, height, count = 90 }: { width: number; height: number; count?: number }) {
  const stars = useMemo(() => {
    const rnd = mulberry32(7);
    return Array.from({ length: count }, (_, i) => ({
      key: i,
      x: rnd() * width,
      y: rnd() * height,
      size: rnd() < 0.2 ? 2.5 : rnd() < 0.5 ? 2 : 1.5,
      yellow: rnd() < 0.18,
      opacity: 0.25 + rnd() * 0.6,
    }));
  }, [width, height, count]);
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height }}>
      {stars.map((s) => (
        <View
          key={s.key}
          style={{
            position: "absolute", left: s.x, top: s.y, width: s.size, height: s.size, borderRadius: s.size / 2,
            backgroundColor: s.yellow ? "#ffd166" : "#ffffff", opacity: s.opacity,
          }}
        />
      ))}
    </View>
  );
}
