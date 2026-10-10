/* What the call knows about who is in a room that the seats don't, kept
   where any screen can read it. Two things, both under the website's
   rules (src/components/agora/roomPresence in the site):

   - Which connection is this phone's. Leaving says which one left, so a
     seat still held on another device stands. It is kept after the call
     ends: a phone the call has moved away from still has to say which
     connection was its own.
   - How many people are listening without an account. They hold no
     seat, so only the call can count them.

   Fed by the watcher in callHost. */
import { useSyncExternalStore } from "react";

let sid: string | null = null;
let counted: { roomId: string; guests: number } | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The call is up: its room, our own connection, the guests in it. */
export function noteCall(roomId: string, ownSid: string | undefined, guests: number) {
  if (ownSid) sid = ownSid;
  if (counted?.roomId === roomId && counted.guests === guests) return;
  counted = { roomId, guests };
  listeners.forEach((fn) => fn());
}

/** Out of the call: nobody can be counted from here. */
export function noteCallGone() {
  if (!counted) return;
  counted = null;
  listeners.forEach((fn) => fn());
}

/** This phone's connection to the call, the last one if it has ended; null if there never was one. */
export const callSid = (): string | null => sid;

/** Guests listening in this room, as far as this phone's call can see. */
export function useGuests(roomId: string): number {
  return useSyncExternalStore(subscribe, () => (counted?.roomId === roomId ? counted.guests : 0));
}
