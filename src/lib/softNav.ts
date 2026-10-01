/* Page changes that keep a live call.

   A room lives in the root layout's call slot (app/@call), which stays
   mounted across in-app navigation — that is what lets a call carry on,
   minimized, while you browse. A full page load would hang it up. So
   while a call is live the room registers window.__agoraSoftNav, and:

   - goTo(url) sends code-driven page changes through it (falling back to
     a full load when there is no call);
   - softNavTarget() decides which plain <a> clicks the room may turn
     into in-app navigation (Next's own links already are).

   Rooms themselves are left alone: opening another room is a full load,
   and that ending the call you were in is the point of it. Opening the
   room you are already in is not a page change at all: the live room
   registers window.__agoraOpenCall, and a link or card that points to it
   (pointsToRoom) brings the room back up from its card instead of
   loading it — and joining it — all over again. */

import { parseRoomParam } from "@/lib/urls";

type AnchorLike = { href: string; target: string; hasAttribute(name: string): boolean };
type ClickLike = { defaultPrevented: boolean; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };
type Where = { href: string; origin: string; pathname: string; search: string };

/** Where a plain click on a link to this site goes — or null for a new
    tab, a modified click, a download, another site: the browser's. */
export function plainLinkUrl(a: AnchorLike, e: ClickLike, here: Where): URL | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
  let url: URL;
  try {
    url = new URL(a.href, here.href);
  } catch {
    return null;
  }
  return url.origin === here.origin ? url : null;
}

/** The in-app path a plain link click should go to without a page load,
    or null to let the browser have it. */
export function softNavTarget(a: AnchorLike, e: ClickLike, here: Where): string | null {
  const url = plainLinkUrl(a, e, here);
  if (!url) return null;
  // Same page with only a #fragment: the browser scrolls, nothing to route.
  if (url.pathname === here.pathname && url.search === here.search) return null;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return null;
  if (/\.[a-z0-9]{2,5}$/i.test(url.pathname)) return null; // a file, not a page
  if (url.pathname.startsWith("/agora/")) return null; // another room: a fresh page
  return url.pathname + url.search + url.hash;
}

/** Whether an address on this site is the room with this id: its own
    page, by the full id (older links) or a name ending in the id's first
    eight characters (roomPath). */
export function pointsToRoom(href: string, roomId: string, here: string): boolean {
  let url: URL;
  try {
    url = new URL(href, here);
  } catch {
    return false;
  }
  if (url.origin !== new URL(here).origin) return false;
  const m = url.pathname.match(/^\/agora\/([^/]+)\/?$/);
  if (!m) return false;
  const { uuid, prefix } = parseRoomParam(m[1]);
  const id = roomId.toLowerCase();
  return uuid ? uuid === id : !!prefix && id.startsWith(prefix);
}

/** Go to a page — in the app while a call is live, so it carries on;
    otherwise a normal page load. */
export function goTo(url: string): void {
  if (typeof window === "undefined") return;
  if (window.__agoraSoftNav?.(url)) return;
  window.location.href = url;
}

declare global {
  interface Window {
    /** Set by a live room: navigate in-app and report true, or false to decline. */
    __agoraSoftNav?: (url: string) => boolean;
    /** Set by a live room: if url is that room, bring it back up (from its
        card) and report true; false for anywhere else. */
    __agoraOpenCall?: (url: string) => boolean;
  }
}
