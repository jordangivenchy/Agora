"use client";

/* The chrome, rendered once by app/(chrome)/layout.tsx and kept across
   the routes under it: the top navbar (logo, search bar, Create, messages, bell, avatar menu — the
   exact mvp-home markup/classes, styled by mvp-home.css which arrives
   through the sidebar's home-sidebar.css layer) plus the glass sidebar.
   Used everywhere except the live room (amphitheater) and the focused
   auth flows. The sidebar hides under lg; content that should sit beside
   the rail brings its own offset class (profile-beside-sidebar /
   replay-beside-sidebar). */

import { useEffect, type ReactNode } from "react";
import { endProgress, navigateTo } from "@/lib/progress";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import SiteNavbar from "@/components/SiteNavbar";
import GlobalActions from "@/components/GlobalActions";
import QueueDock from "@/components/QueueDock";
import { pathFor } from "@/lib/routes";
import type { HomeNavId } from "@/components/HomeSidebar";
/* Statically, not via the sidebar's dynamic chunk: the navbar renders on
   first paint, and without this the mvp styles arrive a beat later — the
   logo flashes at natural size and the bar loads unstyled. */
import "@/components/home-sidebar.css";

/* Client-only like on the profile route, so mvp-home.css (imported
   inside the sidebar) stays wrapped in its layer. */
const HomeSidebar = dynamic(() => import("@/components/HomeSidebar"), { ssr: false });
const Starfield = dynamic(() => import("@/components/Starfield"), { ssr: false });

/* Which sidebar item the address belongs to. */
function activeFor(pathname: string | null): HomeNavId | null {
  if (!pathname) return null;
  if (pathname === "/") return "home";
  if (pathname.startsWith("/feed")) return "feed";
  if (pathname.startsWith("/trending")) return "trending";
  if (pathname.startsWith("/explore")) return "explore";
  if (pathname.startsWith("/communities") || pathname.startsWith("/posts")) return "communities";
  if (pathname.startsWith("/news")) return "news";
  return null;
}

export default function SiteChrome({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = activeFor(pathname);
  /* A tab tap navigates in place: the frame stays, the content swaps
     when the route is ready, and the bar at the top shows the wait in
     between (the sidebar's links prefetch, so in production there is
     rarely one). */
  const go = (id: HomeNavId) => {
    navigateTo(router, pathFor.section(id));
  };
  /* The address has moved: whatever was navigating has arrived. */
  useEffect(() => { endProgress(); }, [pathname]);

  return (
    <div className="min-h-screen site-chrome" style={{ background: "#000", fontFamily: "'DM Sans', sans-serif" }}>
      <Starfield />
      <SiteNavbar />
      <GlobalActions />
      <QueueDock />

      {/* Always mounted: the desktop rail at lg+, an off-canvas drawer
          (hamburger-driven) below — never simply gone. */}
      <div>
        <HomeSidebar activeId={activeId} onNavigate={go} />
      </div>

      {/* .nav is position:fixed (60px), so the page content starts below
          it; relative + z-1 lifts it above the starfield canvas (same
          stacking the homepage's .main uses). */}
      <div className="site-chrome-content" style={{ paddingTop: "var(--nav-height, 60px)", position: "relative", zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
