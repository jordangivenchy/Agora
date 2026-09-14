/* The boot splash: the app's opening, the sky over everything while the
   fonts and the session load, held for a beat with the mark up, then a
   fade into the page (components/BootSplash.tsx on the site). It is the
   only loading screen on the way in: the native launch screen before it
   is plain black (app.json: a blank image on #000) and goes, without a
   dissolve (that snapshots the whole window and costs frames), once the
   app has stood up out of sight (app/_layout.tsx reports the navigator
   laid out); the stars then come up out of the black on their own. It
   also waits, a little, for the first screen's content: a screen that
   calls holdBoot() keeps the sky up until it lets go or HOLD_MS have
   passed, so the page the sky fades to is whole rather than filling in.
   Measured on an iPhone 16 Pro Max (release build, cold launches): the
   sky up about 60-100 ms after the JS starts and turning at 88-102 fps
   (sky.tsx draws at three-quarter size, at most 60 redraws a second),
   the half-second fade to the page a steady 40 fps, home by ~1.8 s. */
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { LoadingScreen } from "./sky";

const FULL_MS = 1200; // the mark is up at 0.7s; a beat with it, then the fade
const FADE_MS = 500;
const HOLD_MS = 3000; // the longest a first screen's content may keep the sky up
const REVEAL_MS = 1000; // the longest the black launch screen waits for the app to stand up

let holds = 0;
let settled = false;
const listeners = new Set<() => void>();

/** Keeps the opening sky up until this screen has its content (never past
    HOLD_MS from the sky's start). Returns the release; a no-op once the
    opening has begun to fade. */
export function holdBoot(): () => void {
  if (settled) return () => {};
  holds++;
  listeners.forEach((f) => f());
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holds--;
    listeners.forEach((f) => f());
  };
}

export function BootSplash({ ready, screenIn }: { ready: boolean; screenIn: boolean }) {
  const [gone, setGone] = useState(false);
  const [laid, setLaid] = useState(false);
  const [shown, setShown] = useState(false);
  const [held, setHeld] = useState(holds > 0);
  const opacity = useRef(new Animated.Value(1)).current;
  const shownAt = useRef(0);
  const laidAt = useRef(0);
  const fading = useRef(false);
  useEffect(() => {
    const f = () => setHeld(holds > 0);
    listeners.add(f);
    f();
    return () => { listeners.delete(f); };
  }, []);
  /* The reveal: the black launch screen lets go once the sky is laid out
     and the app has stood up beneath it — the fonts and the session in,
     the navigator mounted, so that first burst of mounting (it stalls the
     main thread, where every animation runs) happens out of sight — and
     the sky starts turning, and counting its beat, when it is seen. The
     first screen's content lands under the sky; the fade waits for it.
     The black waits no longer than REVEAL_MS. */
  useEffect(() => {
    if (!laid || shown) return;
    const now = Date.now();
    if (!laidAt.current) laidAt.current = now;
    const reveal = () => {
      if (shownAt.current) return;
      shownAt.current = Date.now();
      SplashScreen.hide();
      setShown(true);
    };
    if (screenIn && ready) {
      const raf = requestAnimationFrame(reveal);
      return () => cancelAnimationFrame(raf);
    }
    const t = setTimeout(reveal, Math.max(0, laidAt.current + REVEAL_MS - now));
    return () => clearTimeout(t);
  }, [laid, screenIn, ready, shown]);
  useEffect(() => {
    if (!ready || !shown || gone || fading.current) return;
    const wait = Math.max(0, (held ? HOLD_MS : FULL_MS) - (Date.now() - shownAt.current));
    const t = setTimeout(() => {
      fading.current = true;
      settled = true;
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setGone(true));
    }, wait);
    return () => clearTimeout(t);
  }, [ready, shown, held, gone, opacity]);
  if (gone) return null;
  return (
    <Animated.View onLayout={() => setLaid(true)} pointerEvents={ready ? "none" : "auto"} style={[StyleSheet.absoluteFill, { opacity, zIndex: 1000, elevation: 1000 }]}>
      <LoadingScreen markAt={700} start={shown} />
    </Animated.View>
  );
}
