/* A media query as React state, read through useSyncExternalStore: a
   server-rendered page hydrates with the server's answer and then
   re-renders with the browser's, instead of a hydration mismatch React
   would leave in place. */

import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string, onServer = false): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [query]);
  const read = useCallback(() => window.matchMedia(query).matches, [query]);
  const readOnServer = useCallback(() => onServer, [onServer]);
  return useSyncExternalStore(subscribe, read, readOnServer);
}

/** True once the page is running in a browser (false while hydrating). */
export function useIsClient(): boolean {
  return useSyncExternalStore(() => () => {}, () => true, () => false);
}

/* The visual viewport — what's left of the screen above the keyboard —
   for sheets that must stay clear of it. Null where unsupported. */
type Viewport = { top: number; height: number };
let viewportCache: Viewport | null = null;
function readViewport(): Viewport | null {
  const v = window.visualViewport;
  if (!v) return null;
  const top = v.offsetTop, height = v.height;
  if (!viewportCache || viewportCache.top !== top || viewportCache.height !== height) viewportCache = { top, height };
  return viewportCache;
}
function subscribeViewport(onChange: () => void): () => void {
  const v = window.visualViewport;
  if (!v) return () => {};
  v.addEventListener("resize", onChange);
  v.addEventListener("scroll", onChange);
  return () => { v.removeEventListener("resize", onChange); v.removeEventListener("scroll", onChange); };
}
const noViewport = () => null;
export function useVisualViewport(): Viewport | null {
  return useSyncExternalStore(subscribeViewport, readViewport, noViewport);
}
