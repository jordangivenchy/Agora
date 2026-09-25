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
/* "1": asked for the simple stage. "0": asked for the 3D stage even on a
   machine that reported no GPU. Nothing: let the machine decide. */
type Choice = "1" | "0" | null;
const readChoice = (): Choice => {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "1" || v === "0" ? v : null;
  } catch {
    return null;
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

/** The person's own choice, kept across rooms and reloads. Turning it
    off is a choice too: it overrules a machine that said no GPU. */
export function setSimpleStage(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode: the choice lasts as long as the page */
  }
  for (const l of listeners) l();
}

export interface SimpleStage {
  /** Skip the 3D stage: chosen, or the machine's default. */
  on: boolean;
  /** The person asked for it themselves. */
  chosen: boolean;
  /** What the machine says, when it says anything: a software renderer. */
  forced: "software" | null;
}

export function useSimpleStage(): SimpleStage {
  const choice = useSyncExternalStore(subscribe, readChoice, () => null);
  const noGpu = useSyncExternalStore(noSubscribe, softwareWebGL, () => false);
  const forced = noGpu ? "software" : null;
  /* The machine's verdict is a default, never a lock: a person who turns
     the 3D stage back on gets it, slow or not. */
  const on = choice === "1" || (choice === null && forced !== null);
  return { on, chosen: choice === "1", forced };
}
