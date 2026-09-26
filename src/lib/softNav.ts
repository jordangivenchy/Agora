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
   and that ending the call you were in is the point of it. */

type AnchorLike = { href: string; target: string; hasAttribute(name: string): boolean };
type ClickLike = { defaultPrevented: boolean; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };
type Where = { href: string; origin: string; pathname: string; search: string };

/** The in-app path a plain link click should go to without a page load,
    or null to let the browser have it. */
export function softNavTarget(a: AnchorLike, e: ClickLike, here: Where): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
  let url: URL;
  try {
    url = new URL(a.href, here.href);
  } catch {
    return null;
  }
  if (url.origin !== here.origin) return null;
  // Same page with only a #fragment: the browser scrolls, nothing to route.
  if (url.pathname === here.pathname && url.search === here.search) return null;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return null;
  if (/\.[a-z0-9]{2,5}$/i.test(url.pathname)) return null; // a file, not a page
  if (url.pathname.startsWith("/agora/")) return null; // another room: a fresh page
  return url.pathname + url.search + url.hash;
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
  }
}
