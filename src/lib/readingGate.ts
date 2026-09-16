/* The door for readers, kept ready but not hung.

   While the beta is closed, everything asks for the pass — see
   src/proxy.ts. The day reading should be open to anyone with a link
   (a shared discussion, a thread, someone's profile), this is what does
   it: in proxy.ts, exempt a request when `isReading(method, pathname)`,
   and the archive at /replays, the sitemap and robots.txt start working
   for strangers and crawlers alike.

   Reading only: a GET, and the database's own rules still decide what a
   signed-out reader may see. */

export const PUBLIC_READ = [
  "/", // the shop window: what's live, the day's topics, the news
  "/agora", // a discussion, live or past — the thing people share
  "/rooms", // its older spelling
  "/replays",
  "/clips",
  "/posts",
  "/communities",
  "/users", // and /@name
  "/news",
  "/explore",
  "/trending",
  "/api/news", // what those pages read
  "/api/recordings",
  "/robots.txt", // a crawler can't hold a pass, and asks for these first
  "/sitemap.xml",
];

/** Is this a request to read something anyone should be able to read? */
export function isReading(method: string, pathname: string): boolean {
  return (
    method === "GET" &&
    (PUBLIC_READ.includes(pathname) ||
      PUBLIC_READ.some((p) => p !== "/" && pathname.startsWith(p + "/")) ||
      pathname.startsWith("/@"))
  );
}
