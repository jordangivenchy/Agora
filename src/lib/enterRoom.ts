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
