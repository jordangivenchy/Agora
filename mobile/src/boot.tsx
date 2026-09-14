/* The boot splash: the app's opening, the sky over everything while the
   fonts and the session load, held for a beat with the mark up, then a
   fade into the page (components/BootSplash.tsx on the site). It is the
   only loading screen on the way in: the native launch screen before it
   is plain black and dissolves into it (app/_layout.tsx). */
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { LoadingScreen } from "./sky";

const FULL_MS = 1200; // the mark is up at 0.7s; a beat with it, then the fade
const FADE_MS = 500;

export function BootSplash({ ready }: { ready: boolean }) {
  const [gone, setGone] = useState(false);
  const [shown, setShown] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const shownAt = useRef(0);
  /* The launch screen would otherwise stay up until the first route is
     in, with the sky turning unseen behind it: let it go as soon as the
     sky is laid out, and count the sky's beat from then. */
  const onLayout = () => {
    if (shownAt.current) return;
    shownAt.current = Date.now();
    SplashScreen.hide();
    setShown(true);
  };
  useEffect(() => {
    if (!ready || !shown || gone) return;
    const wait = Math.max(0, FULL_MS - (Date.now() - shownAt.current));
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setGone(true));
    }, wait);
    return () => clearTimeout(t);
  }, [ready, shown, gone, opacity]);
  if (gone) return null;
  return (
    <Animated.View onLayout={onLayout} pointerEvents={ready ? "none" : "auto"} style={[StyleSheet.absoluteFill, { opacity, zIndex: 1000, elevation: 1000 }]}>
      <LoadingScreen markAt={700} />
    </Animated.View>
  );
}
