/* /feed — what the people you follow are doing. Its own route with the
   shared chrome; the page fetches as the viewer once it is up. */

import type { Metadata } from "next";
import SiteChrome from "@/components/SiteChrome";
import FeedPage from "@/components/feed/FeedPage";

export const metadata: Metadata = { title: "Your feed · AgoraSphere" };

export default function FeedRoute() {
  return (
    <SiteChrome activeId="feed">
      <FeedPage />
    </SiteChrome>
  );
}
