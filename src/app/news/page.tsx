/* /news — the day's stories and the discussions they start. A hero tap
   on a phone arrives with ?story=<id>; the page reads it once up. */

import type { Metadata } from "next";
import SiteChrome from "@/components/SiteChrome";
import NewsPage from "@/components/NewsPage";

export const metadata: Metadata = { title: "News · AgoraSphere" };

export default function NewsRoute() {
  return (
    <SiteChrome activeId="news">
      <NewsPage />
    </SiteChrome>
  );
}
