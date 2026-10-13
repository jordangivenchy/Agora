/* A tap you can feel under every press (Jordan, 2026-10-13, after the
   Chess.com app: "it's a tap with every input"). One light tap, the same
   everywhere, so the whole app answers a finger the same way:

   - anything pressed goes through the app's own Pressable
     (pressable.tsx), which taps as it acts;
   - a link in a line of text is wrapped in `felt`;
   - the tab bar is Apple's and reports its presses ((tabs)/_layout.tsx).

   One press, one tap: a press whose own action already gave a firmer
   one (the mic going live: `thump`) is not tapped again on top. An
   outcome that arrives by itself (brought up to the stage) is
   `success`.

   It can be switched off in Settings (this phone only). The phone stays
   still by itself in Low Power Mode, when its owner has turned system
   haptics off, and while the camera or dictation is running; the
   website build of the app has nothing to shake. */
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";

const KEY = "agora-haptics";
let on = true;
const listeners = new Set<(on: boolean) => void>();
const quiet = () => undefined;
/* When the phone last answered a finger, so one press is never answered twice. */
let feltAt = 0;
const able = () => on && Platform.OS !== "web";

/** The tap itself. */
export function tap(): void {
  if (!able()) return;
  feltAt = Date.now();
  if (Platform.OS === "android") void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click).catch(quiet);
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(quiet);
}

/** A firmer one, for a press that changes something you should not miss: your mic going live or off. */
export function thump(): void {
  if (!able()) return;
  feltAt = Date.now();
  if (Platform.OS === "android") void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm).catch(quiet);
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(quiet);
}

/** Good news that arrives by itself: you were brought up to the stage. */
export function success(): void {
  if (!able()) return;
  feltAt = Date.now();
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(quiet);
}

/** Runs what a press does, then taps, unless doing it already answered the finger. */
export function pressed<A extends unknown[]>(fn: (...args: A) => void, ...args: A): void {
  const from = Date.now();
  try {
    fn(...args);
  } finally {
    if (feltAt < from) tap();
  }
}

/** A handler that taps before it runs: for presses that aren't a Pressable (a link in text). */
export function felt<A extends unknown[]>(fn: ((...args: A) => void) | null | undefined): ((...args: A) => void) | undefined {
  if (!fn) return undefined;
  return (...args: A) => pressed(fn, ...args);
}

export function hapticsOn(): boolean {
  return on;
}

/** Switching it on answers with a tap, so you feel what you chose. */
export function setHaptics(next: boolean) {
  on = next;
  listeners.forEach((l) => l(next));
  AsyncStorage.setItem(KEY, next ? "1" : "0").catch(quiet);
  if (next) tap();
}

/** Read at launch: on unless this phone was told otherwise. */
export async function loadHaptics(): Promise<boolean> {
  try {
    on = (await AsyncStorage.getItem(KEY)) !== "0";
  } catch {
    on = true;
  }
  listeners.forEach((l) => l(on));
  return on;
}

export function useHaptics(): boolean {
  const [value, setValue] = useState(on);
  useEffect(() => {
    listeners.add(setValue);
    setValue(on);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
