/* Whether the primary pointer is a finger (phones, tablets) — for copy
   that only makes sense with a keyboard, like a composer's "⌘↩ to
   send". Read through useSyncExternalStore so a server-rendered page
   hydrates with the keyboard wording and then re-renders with the
   right one, instead of a hydration mismatch React would leave as is. */

import { useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void): () => void {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

const read = () => window.matchMedia(QUERY).matches;
const readOnServer = () => false;

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, read, readOnServer);
}
