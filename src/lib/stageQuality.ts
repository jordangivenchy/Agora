/* Whether this machine should draw the 3D amphitheatre at all.

   The room's stage is a full three.js scene — shadow maps, a dozen
   point lights — drawn every frame under every layout. A browser
   without a graphics card (hardware acceleration off, a remote desktop,
   LiveKit's recorder) draws it in software and the whole call turns to
   syrup: the same scene ran the recorder out of CPU twenty seconds into
   every camera room. Two ways out, both landing on the phones' flat
   backdrop (components/agora/Amphitheater.tsx `flat`):

   - a choice, kept in localStorage: "Simple stage" in the call's
     settings, for anyone whose computer is struggling;
   - no GPU: WebGL reports a software renderer, and the choice is made
     for them. */

import { useSyncExternalStore } from "react";

const KEY = "agora:simple-stage";

let software: boolean | null = null;

/** True when WebGL here is drawn by the CPU (or not at all). Read once. */
export function softwareWebGL(): boolean {
  if (typeof document === "undefined") return false;
  if (software !== null) return software;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return (software = true);
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    software = /swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa offscreen|angle \(software/i.test(name);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return software;
  } catch {
    return (software = false);
  }
}

const listeners = new Set<() => void>();
const readChoice = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
};
const noSubscribe = () => () => {};

/** The person's own choice, kept across rooms and reloads. */
export function setSimpleStage(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private mode: the choice lasts as long as the page */
  }
  for (const l of listeners) l();
}

export interface SimpleStage {
  /** Skip the 3D stage: chosen, or decided by the machine. */
  on: boolean;
  /** The person asked for it. */
  chosen: boolean;
  /** Why it is on regardless of the choice, when it is. */
  forced: "software" | null;
}

export function useSimpleStage(): SimpleStage {
  const chosen = useSyncExternalStore(subscribe, readChoice, () => false);
  const noGpu = useSyncExternalStore(noSubscribe, softwareWebGL, () => false);
  const forced = noGpu ? "software" : null;
  return { on: chosen || forced !== null, chosen, forced };
}
