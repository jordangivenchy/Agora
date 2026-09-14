/* The site's thin yellow bar (lib/progress.ts, .sk-progress in
   globals.css): the one loading indicator inside a session. It runs
   along the line under the top bar while the page beneath is loading —
   a tab arriving, a page's own fetch — trickling toward the end (0.35 at
   a tenth of the way, 0.7 at two fifths, 0.92 at eight seconds), then
   runs to the end and fades once the wait is over. Waits nest: the bar
   stays until the last one ends, and one nothing ends leaves after ten
   seconds. Reduce motion holds it still at 60%. */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native";
import { useIsFocused } from "expo-router";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useReduceMotion } from "./motion";

let waits = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Raise the bar for a wait; call the returned function when it is over. */
export function startProgress(): () => void {
  waits++;
  if (waits === 1) emit();
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    clearTimeout(safety);
    waits = Math.max(0, waits - 1);
    if (waits === 0) emit();
  };
  const safety = setTimeout(end, 10000);
  return end;
}

/** The bar up for as long as a promise takes. */
export function withProgress<T>(p: Promise<T>): Promise<T> {
  const end = startProgress();
  return p.finally(end);
}

/* Every tab keeps its header, so a bar per visited tab was listening:
   each wait re-rendered and animated all of them, the hidden ones too.
   Only the bar on the screen in front listens now. */
function useLoading(active: boolean): boolean {
  const subscribe = useCallback((l: () => void) => {
    if (!active) return () => {};
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [active]);
  return useSyncExternalStore(subscribe, () => active && waits > 0, () => false);
}

const TRICKLE = Easing.bezier(0.15, 0.6, 0.25, 1);
const HEIGHT = 3;

/** The bar itself, laid along the bottom edge of its parent. */
export function ProgressBar() {
  const loading = useLoading(useIsFocused());
  const reduce = useReduceMotion();
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    running.current?.stop();
    if (loading) {
      /* A frame later: a native-driven animation started in the same
         moment its view appears never drew on iOS (toast.tsx). */
      const raf = requestAnimationFrame(() => {
        opacity.setValue(1);
        if (reduce) { progress.setValue(0.6); return; }
        progress.setValue(0);
        running.current = Animated.sequence([
          Animated.timing(progress, { toValue: 0.35, duration: 960, easing: TRICKLE, useNativeDriver: true }),
          Animated.timing(progress, { toValue: 0.7, duration: 2240, easing: TRICKLE, useNativeDriver: true }),
          Animated.timing(progress, { toValue: 0.92, duration: 4800, easing: TRICKLE, useNativeDriver: true }),
        ]);
        running.current.start();
      });
      return () => cancelAnimationFrame(raf);
    }
    /* Over: to the end, then gone. */
    running.current = Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: reduce ? 0 : 140, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 350, delay: 100, useNativeDriver: true }),
    ]);
    running.current.start();
  }, [loading, reduce, progress, opacity]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] });
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: HEIGHT, overflow: "visible", zIndex: 10 }}>
      {/* Drawn once and moved as a picture: an unrasterized shadow was
          re-rendered offscreen on every frame of the slide. */}
      <Animated.View
        shouldRasterizeIOS
        style={{
          width, height: HEIGHT, opacity, transform: [{ translateX }],
          backgroundColor: "#ffb700",
          shadowColor: "#ffb700", shadowOpacity: 0.6, shadowRadius: 5, shadowOffset: { width: 0, height: 0 },
        }}
      >
        <Svg width={width} height={HEIGHT} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="agora-progress" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#ffb700" />
              <Stop offset="1" stopColor="#ffd45c" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={width} height={HEIGHT} fill="url(#agora-progress)" />
        </Svg>
      </Animated.View>
    </View>
  );
}
