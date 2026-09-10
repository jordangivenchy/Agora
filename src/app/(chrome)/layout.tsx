/* The chrome — starfield, navbar, sidebar and tab bar, the site-wide
   actions — as a layout, so it stays put while the routes under it
   change: a tab tap swaps the content, not the frame. Everything
   except the live room and the sign-in flows lives here. */

import type { ReactNode } from "react";
import SiteChrome from "@/components/SiteChrome";

export default function ChromeLayout({ children }: { children: ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>;
}
