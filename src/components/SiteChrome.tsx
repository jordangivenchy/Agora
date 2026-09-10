"use client";

/* Shared page chrome for standalone routes: the SAME top navbar as the
   homepage (logo, search bar, Create, messages, bell, avatar menu — the
   exact mvp-home markup/classes, styled by mvp-home.css which arrives
   through the sidebar's home-sidebar.css layer) plus the glass sidebar.
   Used everywhere except the live room (amphitheater) and the focused
   auth flows. The sidebar hides under lg; content that should sit beside
   the rail brings its own offset class (profile-beside-sidebar /
   replay-beside-sidebar). */

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import LoadingScreen from "@/components/LoadingScreen";
import SiteNavbar from "@/components/SiteNavbar";
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

const SECTION_LABEL: Record<HomeNavId, string> = {
  home: "Going home",
  feed: "Opening the feed",
  trending: "Opening Trending",
  explore: "Opening Explore",
  communities: "Opening Communities",
  news: "Opening News",
};

export default function SiteChrome({
  activeId = null,
  children,
}: {
  activeId?: HomeNavId | null;
  children: ReactNode;
}) {
  const router = useRouter();
  /* Every tab leads to the home shell (lib/routes.ts: its section
     paths all rewrite to "/"), a route with no loading fallback of its
     own (its tabs switch client-side and its boot does not tolerate
     one), so this page shows the sky itself until the shell arrives
     and this chrome unmounts with the page. */
  const [leaving, setLeaving] = useState<HomeNavId | null>(null);
  const leaveTimer = useRef(0);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const go = (id: HomeNavId) => {
    // A quarter second's grace: a shell that arrives that fast needs no
    // curtain, and this page stays up until it does.
    clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setLeaving(id), 250);
    router.push(pathFor.section(id));
  };

  return (
    <div className="min-h-screen site-chrome" style={{ background: "#000", fontFamily: "'DM Sans', sans-serif" }}>
      <Starfield />
      <SiteNavbar />
      {leaving && <LoadingScreen label={SECTION_LABEL[leaving]} />}

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
