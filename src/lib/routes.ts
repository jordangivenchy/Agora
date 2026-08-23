/* Shareable URLs for sections that are state on the homepage shell.
   next.config rewrites every path here to "/"; page.tsx reads the browser
   pathname to pick the section, and pushes these paths as the user moves. */

export type HomeSection = "home" | "feed" | "explore" | "trending" | "communities" | "news" | "search";

export type HomeRoute =
  | { kind: "section"; id: HomeSection }
  /* /search?q=… — the query rides along so the panel can open on it. */
  | { kind: "search"; q: string }
  | { kind: "community"; slug: string }
  | { kind: "post"; id: string; commentId: string | null }
  | { kind: "messages"; username: string | null }
  /* Legacy /?dm=<userId>: resolved to /messages/<username> in page.tsx. */
  | { kind: "dm-user"; userId: string };

export const pathFor = {
  section(id: HomeSection): string {
    return id === "home" ? "/" : `/${id}`;
  },
  community(slug: string | null): string {
    return slug ? `/communities/${encodeURIComponent(slug)}` : "/communities";
  },
  post(id: string, commentId?: string | null): string {
    return `/posts/${encodeURIComponent(id)}${commentId ? `#comment-${encodeURIComponent(commentId)}` : ""}`;
  },
  messages(username?: string | null): string {
    return username ? `/messages/${encodeURIComponent(username)}` : "/messages";
  },
  search(q?: string | null): string {
    const t = (q ?? "").trim();
    return t ? `/search?q=${encodeURIComponent(t)}` : "/search";
  },
};

/* Rewrites are declared in next.config.ts; keep the two lists in step. */
export const REWRITTEN_SOURCES = [
  "/feed", "/trending", "/news", "/explore", "/communities", "/communities/:slug",
  "/posts/:id", "/messages", "/messages/:username", "/search",
];

const SECTIONS: HomeSection[] = ["home", "feed", "explore", "trending", "communities", "news", "search"];

export function isHomeSection(s: string): s is HomeSection {
  return (SECTIONS as string[]).includes(s);
}

/** Parse a location into a route. `legacy` is true when the route came
    from an old query-param form and the URL should be canonicalised. */
export function parseHomeRoute(
  pathname: string,
  search: string,
  hash: string
): { route: HomeRoute; legacy: boolean } {
  const seg = pathname.replace(/\/+$/, "").split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const hashComment = /^#comment-(.+)$/.exec(hash)?.[1] ?? null;
  const params = new URLSearchParams(search);

  if (seg.length >= 1) {
    if (seg[0] === "posts" && seg[1]) {
      return {
        route: { kind: "post", id: seg[1], commentId: hashComment ?? params.get("comment") },
        legacy: false,
      };
    }
    if (seg[0] === "communities") {
      return {
        route: seg[1] ? { kind: "community", slug: seg[1] } : { kind: "section", id: "communities" },
        legacy: false,
      };
    }
    if (seg[0] === "messages") {
      return { route: { kind: "messages", username: seg[1] ?? null }, legacy: false };
    }
    if (seg.length === 1 && seg[0] === "search") {
      return { route: { kind: "search", q: (params.get("q") ?? "").trim() }, legacy: false };
    }
    if (seg.length === 1 && isHomeSection(seg[0])) {
      return { route: { kind: "section", id: seg[0] }, legacy: false };
    }
  }

  const post = params.get("post");
  if (post) return { route: { kind: "post", id: post, commentId: hashComment ?? params.get("comment") }, legacy: true };
  const dm = params.get("dm");
  if (dm) return { route: { kind: "dm-user", userId: dm }, legacy: true };
  const nav = params.get("nav");
  if (nav && isHomeSection(nav)) return { route: { kind: "section", id: nav }, legacy: true };

  return { route: { kind: "section", id: "home" }, legacy: false };
}

export function canonicalPath(route: HomeRoute): string | null {
  switch (route.kind) {
    case "section": return pathFor.section(route.id);
    case "community": return pathFor.community(route.slug);
    case "post": return pathFor.post(route.id, route.commentId);
    case "messages": return pathFor.messages(route.username);
    case "search": return pathFor.search(route.q);
    case "dm-user": return null;
  }
}

export function sectionTitle(id: HomeSection): string {
  const names: Record<HomeSection, string> = {
    home: "AgoraSphere",
    feed: "Your feed · AgoraSphere",
    explore: "Explore · AgoraSphere",
    trending: "Trending · AgoraSphere",
    communities: "Communities · AgoraSphere",
    news: "News · AgoraSphere",
    search: "Search · AgoraSphere",
  };
  return names[id];
}

/* Next's streamed metadata writes <title> after hydration, which would
   clobber a title set in a mount effect. Keep the section title pinned:
   set it now and re-assert it whenever <head> changes it to something
   else. One observer per document. */
let desiredTitle: string | null = null;
let titleObserver: MutationObserver | null = null;
export function setSectionTitle(title: string): void {
  if (typeof document === "undefined") return;
  desiredTitle = title;
  if (document.title !== title) document.title = title;
  if (!titleObserver) {
    titleObserver = new MutationObserver(() => {
      if (desiredTitle && document.title !== desiredTitle) document.title = desiredTitle;
    });
    titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  }
}
