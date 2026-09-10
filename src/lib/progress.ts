/* The thin yellow bar at the top of the page: the site's one loading
   indicator inside a session — a tab tap, a link, a route arriving, an
   in-page wait. Started when a navigation begins, ended by the chrome
   once the address has moved (SiteChrome.tsx) or by whoever started it
   for an in-page wait (RouteLoading.tsx). One element, shared with the
   inline __agoraLeave (lib/skySplash.ts) that full-load links use, and
   removed on its own after six seconds if nothing ends it. The sky is
   the site's opening only (BootSplash.tsx). */

const LIVE = ".sk-progress[data-nav]:not(.is-done)";

export function startProgress(): void {
  if (typeof document === "undefined" || document.querySelector(LIVE)) return;
  const bar = document.createElement("div");
  bar.className = "sk-progress";
  bar.setAttribute("data-nav", "1");
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);
  window.setTimeout(() => { if (bar.isConnected) bar.remove(); }, 6000);
}

/* Run to the end, fade, go. */
export function endProgress(): void {
  if (typeof document === "undefined") return;
  document.querySelectorAll<HTMLElement>(LIVE).forEach((bar) => {
    bar.classList.add("is-done");
    window.setTimeout(() => bar.remove(), 500);
  });
}

/* The same address as the page already showing has nothing to wait for
   (the chrome ends the bar when the address moves, and it wouldn't). */
function sameAddress(href: string): boolean {
  try {
    const u = new URL(href, window.location.href);
    return u.pathname === window.location.pathname && u.search === window.location.search;
  } catch { return false; }
}

/** Navigate in place with the bar up until the address moves. */
export function navigateTo(router: { push: (href: string) => void }, href: string): void {
  if (!sameAddress(href)) startProgress();
  router.push(href);
}

/** For a Link's onClick: the bar up until its address arrives. */
export function progressOnClick(e: { currentTarget: { href: string } }): void {
  if (!sameAddress(e.currentTarget.href)) startProgress();
}
