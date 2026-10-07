"use client";

/* How a person likes the cameras laid out in a call. Their own choices,
   kept on their browser across rooms and reloads; nothing here changes
   what anyone else sees.

   - Small faces (on unless turned off): once someone has a camera or a
     screen on, the people without a camera sit small beside the windows
     instead of each holding a window of their own.
   - Tall cameras (off unless turned on): the cameras stack in a
     phone-shaped column in the middle of the stage — the arrangement a
     vertical stream shows — with the room around them as it was. */
import { useSyncExternalStore } from "react";

const SMALL_FACES_KEY = "agora:small-faces";
const TALL_KEY = "agora:cameras-tall";

const listeners = new Set<() => void>();
const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice lasts as long as the page */
  }
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
};

export function setSmallFaces(on: boolean): void {
  write(SMALL_FACES_KEY, on ? "1" : "0");
}
export function setCamerasTall(on: boolean): void {
  write(TALL_KEY, on ? "1" : "0");
}

export interface CallView {
  smallFaces: boolean;
  tall: boolean;
}

export function useCallView(): CallView {
  const smallFaces = useSyncExternalStore(subscribe, () => read(SMALL_FACES_KEY) !== "0", () => true);
  const tall = useSyncExternalStore(subscribe, () => read(TALL_KEY) === "1", () => false);
  return { smallFaces, tall };
}
