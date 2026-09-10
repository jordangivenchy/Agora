/* The app's paths, in one place. Every section is a route of its own
   (app/feed, app/trending, app/news, app/explore, app/search, and the
   boards under app/(boards)); the sidebar and the pages build their
   links from here. */

export type HomeSection = "home" | "feed" | "explore" | "trending" | "communities" | "news" | "search";

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
  messagesGroup(chatId: string): string {
    return `/messages/g/${encodeURIComponent(chatId)}`;
  },
  search(q?: string | null): string {
    const t = (q ?? "").trim();
    return t ? `/search?q=${encodeURIComponent(t)}` : "/search";
  },
};

const SECTIONS: HomeSection[] = ["home", "feed", "explore", "trending", "communities", "news", "search"];

export function isHomeSection(s: string): s is HomeSection {
  return (SECTIONS as string[]).includes(s);
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
/** The page that pinned a title has left: the next route's own title stands. */
export function releaseSectionTitle(): void {
  desiredTitle = null;
}
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
