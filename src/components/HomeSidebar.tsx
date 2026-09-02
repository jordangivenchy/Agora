"use client";

/* The glass sidebar, as a React component — shared by the homepage and
   the standalone profile route. Step 1 of strangling the MVP shell
   (static HTML string + mvp-home.js + mvp-adapter.js) into React: the
   markup and class names are byte-for-byte what the static aside used,
   so mvp-home.css styles it unchanged, but state (active item, mobile
   open/closed, spotlight, friends hosts) now lives here instead of in
   three scripts poking the DOM.

   mvp-home.css is pulled in through home-sidebar.css, which demotes it
   into a cascade layer so its universal reset can't zero Tailwind
   spacing on routes that only borrow the sidebar.

   Navigation is a callback: the homepage maps ids to its React panels /
   MVP page switch; the profile route maps them to their /trending-style paths (src/lib/routes.ts). */

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import FriendsSection from "@/components/friends/FriendsSection";
import { Icon } from "@/components/icons";
import "./home-sidebar.css";

export type HomeNavId = "home" | "feed" | "trending" | "explore" | "communities" | "news";

interface Props {
  activeId: HomeNavId | null;
  onNavigate: (id: HomeNavId) => void;
}

/* [delay, duration, left, top, drift] — the per-link sparkle layouts
   from the original markup, preserved exactly. */
type Sparkle = [string, string, string, string, string];

interface NavItem {
  id: HomeNavId;
  label: string;
  /** Phone tab-bar label when the full one won't fit. */
  short?: string;
  /** false = not in the phone tab bar (five tabs read evenly; six cram). */
  phoneTab?: boolean;
  page?: "home" | "explore";
  sparkles: Sparkle[];
  icon: ReactElement;
}

/* Ordered "yours" (Home · Feed · Communities) over "discover"
   (Trending · News · Explore): the landing page leads, the personal
   destinations follow, and search-adjacent Explore closes the list. */
const NAV: NavItem[] = [
  {
    id: "home",
    label: "Home",
    page: "home",
    sparkles: [
      ["0s", "4s", "22%", "28%", "5px"],
      ["0.8s", "3.7s", "55%", "70%", "-4px"],
      ["1.5s", "4.4s", "78%", "30%", "5px"],
      ["2.3s", "3.9s", "40%", "78%", "-3px"],
      ["3.1s", "4.6s", "88%", "52%", "4px"],
    ],
    icon: (
      <Icon name="home" size={15} />
    ),
  },
  {
    id: "feed",
    label: "Feed",
    sparkles: [
      ["0.2s", "4.1s", "26%", "36%", "5px"],
      ["1.0s", "3.8s", "60%", "66%", "-4px"],
      ["1.8s", "4.5s", "82%", "28%", "4px"],
      ["2.6s", "3.7s", "42%", "80%", "-3px"],
    ],
    icon: (
      <Icon name="sparkles" size={15} />
    ),
  },
  {
    id: "communities",
    label: "Communities",
    short: "Boards",
    sparkles: [
      ["0.4s", "4.4s", "24%", "58%", "-5px"],
      ["1.2s", "3.9s", "65%", "32%", "6px"],
      ["2.0s", "4.7s", "82%", "76%", "-4px"],
    ],
    icon: (
      <Icon name="users-round" size={16} />
    ),
  },
  {
    id: "trending",
    label: "Trending",
    /* Not in the phone bar: Home · Feed · [+ create] · Boards · News. */
    phoneTab: false,
    sparkles: [
      ["0.3s", "4.2s", "28%", "42%", "5px"],
      ["1.1s", "3.6s", "68%", "60%", "-5px"],
      ["1.9s", "4.5s", "84%", "25%", "4px"],
      ["2.7s", "3.8s", "45%", "82%", "-4px"],
    ],
    icon: (
      <Icon name="flame" size={15} />
    ),
  },
  {
    id: "news",
    label: "News",
    sparkles: [
      ["0.7s", "4.2s", "30%", "46%", "5px"],
      ["1.5s", "3.8s", "70%", "66%", "-5px"],
      ["2.3s", "4.6s", "86%", "32%", "4px"],
    ],
    icon: (
      <Icon name="newspaper" size={16} />
    ),
  },
  {
    id: "explore",
    label: "Explore",
    page: "explore",
    /* On phones the top bar's search icon is the way into Explore. */
    phoneTab: false,
    sparkles: [
      ["0.5s", "4.3s", "18%", "55%", "-5px"],
      ["1.3s", "3.8s", "62%", "35%", "6px"],
      ["2.1s", "4.6s", "85%", "68%", "-4px"],
      ["2.9s", "3.5s", "38%", "22%", "5px"],
    ],
    icon: (
      <Icon name="compass" size={15} />
    ),
  },
];

export default function HomeSidebar({ activeId, onNavigate }: Props) {
  const asideRef = useRef<HTMLElement | null>(null);
  const friendsRef = useRef<HTMLDivElement | null>(null);
  const [hosts, setHosts] = useState<{ friends: HTMLElement; aside: HTMLElement } | null>(null);
  /* Mobile drawer state (the navbar's hamburger lives in the MVP shell on
     the homepage; listen by delegation so it works without coupling). */
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (asideRef.current && friendsRef.current) {
      setHosts({ aside: asideRef.current, friends: friendsRef.current });
    }
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.("#hamburger")) {
        setOpen((o) => !o);
        return;
      }
      /* Drawer mode (<900px, where the rail overlays the page): a tap on
         a nav row or anywhere outside the rail closes it. Harmless on
         desktop, where `open` has no effect. */
      setOpen((o) => (o && (!asideRef.current?.contains(t) || !!t.closest?.(".sidebar-link")) ? false : o));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  /* Spotlight border — same cursor→hue mapping mvp-home.js used, but
     rAF-throttled to one batch of style writes per frame. */
  useEffect(() => {
    let frame = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      const aside = asideRef.current;
      const e = last;
      if (!aside || !e) return;
      aside.style.setProperty("--x", e.clientX.toFixed(2));
      aside.style.setProperty("--y", e.clientY.toFixed(2));
      aside.style.setProperty("--xp", (e.clientX / window.innerWidth).toFixed(2));
      aside.style.setProperty("--yp", (e.clientY / window.innerHeight).toFixed(2));
      aside.style.setProperty("--hue", String(Math.round(210 - (e.clientX / window.innerWidth) * 180)));
    };
    const onPointer = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    document.addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onPointer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
    <aside ref={asideRef} id="sidebar" className={`sidebar${open ? " open" : ""}`}>
      {/* glass edge layers */}
      <div className="sidebar-edge-blur" aria-hidden="true">
        <div className="sidebar-edge-blur-inner" />
      </div>
      <div className="sidebar-edge-tint" aria-hidden="true" />

      <div className="sidebar-scroll-area">
        <div className="sidebar-top-zone">
          <nav className="sidebar-nav" id="mvNav">
            {NAV.map((item) => (
              <a
                key={item.id}
                className={`sidebar-link${activeId === item.id ? " active" : ""}`}
                href="#"
                data-page={item.page}
                data-nav-id={item.id}
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  onNavigate(item.id);
                }}
              >
                <span className="nav-hover-shimmer" />
                <span className="nav-light-slit" />
                <div className="nav-light-beam">
                  <div className="nav-light-beam-cone" />
                  <div className="nav-light-beam-center" />
                  <div className="nav-light-beam-glow" />
                </div>
                <div className="nav-light-shadow">
                  <div className="nav-light-shadow-right" />
                </div>
                {item.sparkles.map(([delay, dur, left, top, sx], i) => (
                  <span
                    key={i}
                    className="nav-sparkle"
                    style={{ "--delay": delay, "--dur": dur, left, top, "--sx": sx } as CSSProperties}
                  />
                ))}
                <div className="nav-inner">
                  <span className="nav-icon-wrap">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </div>
              </a>
            ))}
          </nav>
        </div>

        <div className="sidebar-bottom-zone">
          <div className="friends-section" id="friendsSection" ref={friendsRef} />
          <div
            className="sidebar-footer"
            style={{ paddingBottom: 12, fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", margin: 0, paddingTop: 8 }}
          >
            © 2025 AgoraSphere
          </div>
        </div>
      </div>

      {hosts && <FriendsSection container={hosts.friends} sidebar={hosts.aside} />}
    </aside>

    {/* Phones (<640px): the rail is hidden and this Kick-style bottom
        tab bar is the navigation — same items, same callback. Styled in
        globals.css (.mobile-tabbar); display:none above the breakpoint. */}
    <nav className="mobile-tabbar" aria-label="Sections">
      {(() => {
        const tabs = NAV.filter((item) => item.phoneTab !== false);
        const tab = (item: NavItem) => (
          <a
            key={item.id}
            className={`mobile-tab${activeId === item.id ? " active" : ""}`}
            href="#"
            data-nav-id={item.id}
            aria-current={activeId === item.id ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(item.id);
            }}
          >
            <span className="mobile-tab-icon">{item.icon}</span>
            <span className="mobile-tab-label">{item.short ?? item.label}</span>
          </a>
        );
        const mid = Math.ceil(tabs.length / 2);
        return (
          <>
            {tabs.slice(0, mid).map(tab)}
            {/* Centre action: create a room. /?create=1 opens the create
                modal on the home shell (signed-out users land on /login). */}
            <a
              className="mobile-tab mobile-tab-create"
              href="/?create=1"
              aria-label="Create a room"
              onClick={(e) => {
                /* On the home shell the modal can open in place; the
                   href is the fallback from every other route. */
                if (document.getElementById("createModal")) {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent("agora:create"));
                }
              }}
            >
              <span className="mobile-tab-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </a>
            {tabs.slice(mid).map(tab)}
          </>
        );
      })()}
    </nav>
    </>
  );
}
