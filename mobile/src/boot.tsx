/* The boot splash: the app's opening, the sky over everything while the
   fonts and the session load, held for a beat with the mark up, then a
   fade into the page (components/BootSplash.tsx on the site). */
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet } from "react-native";
import { LoadingScreen } from "./sky";

const FULL_MS = 1200; // the mark is up at 0.7s; a beat with it, then the fade
const FADE_MS = 500;

export function BootSplash({ ready }: { ready: boolean }) {
  const [gone, setGone] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const t0 = useRef(Date.now());
  useEffect(() => {
    if (!ready || gone) return;
    const wait = Math.max(0, FULL_MS - (Date.now() - t0.current));
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setGone(true));
    }, wait);
    return () => clearTimeout(t);
  }, [ready, gone, opacity]);
  if (gone) return null;
  return (
    <Animated.View pointerEvents={ready ? "none" : "auto"} style={[StyleSheet.absoluteFill, { opacity, zIndex: 1000, elevation: 1000 }]}>
      <LoadingScreen markAt={700} />
    </Animated.View>
  );
}
