import type { MouseEvent } from "react";
import { roomPath } from "@/lib/urls";

/* Into a room. A live one is entered through the sky: it comes up over
   the page you are on and carries across the page load into the room's
   own, one exposure from the click to the stage (lib/skySplash.ts).
   Anything else — a scheduled room, a past discussion — is a plain page
   load, as before. */
export function enterRoom(url: string): void {
  if (window.__agoraEnter) window.__agoraEnter(url);
  else window.location.href = url;
}

/** Into a room that opens in the app (router.push) — one you have just
    made, or joined by code: the same sky comes up over this page, and
    the room's own screens carry it on in the same document. */
export function enterRoomInApp(push: () => void): void {
  window.__agoraSkyOver?.();
  push();
}

/** The sky, up now, for a room about to open in the app — before the
    room even exists, so making it is part of the entrance. Returns a way
    to take it down again if the room never comes (an error to show). */
export function skyForRoom(): () => void {
  window.__agoraSkyOver?.();
  return () => {
    const el = document.querySelector(".ld-enter[data-over]");
    if (el) window.__agoraSkyOverEnd?.(el, true);
  };
}

export function openRoom(room: { id: string; motion?: string | null; status?: string | null }): void {
  const url = roomPath(room);
  if (room.status === "live") enterRoom(url);
  else window.location.href = url;
}

/** For an <a> into a live room: a plain click goes through the sky; a
    new tab, or any modified click, is left to the browser. */
export function enterRoomOnClick(e: MouseEvent<HTMLAnchorElement>): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  enterRoom(e.currentTarget.href);
}
