/* Reduce motion, the site's setting (user_settings.reduce_motion): the
   sky, the starfield and the marquee hold still when it is on. Mirrored
   in storage so a cold start reads it before the account does. */
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "agora-reduce-motion";
let current = false;
const listeners = new Set<(on: boolean) => void>();

export function reduceMotion(): boolean {
  return current;
}

export function setReduceMotion(on: boolean) {
  current = on;
  listeners.forEach((l) => l(on));
  AsyncStorage.setItem(KEY, on ? "1" : "0").catch(() => {});
}

export async function loadReduceMotion(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    current = v === "1";
  } catch {
    current = false;
  }
  listeners.forEach((l) => l(current));
  return current;
}

export function useReduceMotion(): boolean {
  const [on, setOn] = useState(current);
  useEffect(() => {
    listeners.add(setOn);
    setOn(current);
    return () => { listeners.delete(setOn); };
  }, []);
  return on;
}
