/* Outlet marks for the news UI (the hero's story slides, the ticker,
   the news page). Most outlets get their favicon from Google's service;
   the ones whose favicon is a dark mark on a transparent ground — lost
   on our night — carry their own white mark from public/outlets. */

const OWN_MARKS: Record<string, string> = {
  "nytimes.com": "/outlets/nytimes.png",
};

/** The icon for an outlet's domain ("nytimes.com"), at about `size` px. */
export function outletIcon(domain: string, size = 32): string {
  const d = domain.trim().toLowerCase().replace(/^www\./, "");
  return OWN_MARKS[d] ?? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=${size}`;
}
