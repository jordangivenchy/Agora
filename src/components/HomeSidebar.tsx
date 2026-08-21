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
   MVP page switch; the profile route maps them to /?nav= deep links. */

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import FriendsSection from "@/components/friends/FriendsSection";
import "./home-sidebar.css";

export type HomeNavId = "home" | "trending" | "explore" | "communities" | "news";

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
  page?: "home" | "explore";
  sparkles: Sparkle[];
  icon: ReactElement;
}

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
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" clipRule="evenodd" d="M11.31 1.776a1 1 0 0 1 1.38 0l8 7.619 2.5 2.381a1 1 0 0 1-1.38 1.448L21 12.452V20a2 2 0 0 1-2 2h-5v-5a2 2 0 0 0-4 0v5H5a2 2 0 0 1-2-2v-7.548l-.81.772a1 1 0 0 1-1.38-1.448l2.5-2.381 8-7.619Z" />
      </svg>
    ),
  },
  {
    id: "trending",
    label: "Trending",
    sparkles: [
      ["0.3s", "4.2s", "28%", "42%", "5px"],
      ["1.1s", "3.6s", "68%", "60%", "-5px"],
      ["1.9s", "4.5s", "84%", "25%", "4px"],
      ["2.7s", "3.8s", "45%", "82%", "-4px"],
    ],
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
        <path d="M9.32 15.653a.812.812 0 0 1-.086-.855c.176-.342.245-.733.2-1.118a2.106 2.106 0 0 0-.267-.779 2.027 2.027 0 0 0-.541-.606 3.96 3.96 0 0 1-1.481-2.282c-1.708 2.239-1.053 3.51-.235 4.63a.748.748 0 0 1-.014.901.87.87 0 0 1-.394.283.838.838 0 0 1-.478.023c-1.105-.27-2.145-.784-2.85-1.603a4.686 4.686 0 0 1-.906-1.555 4.811 4.811 0 0 1-.263-1.797s-.133-2.463 2.837-4.876c0 0 3.51-2.978 2.292-5.18a.621.621 0 0 1 .112-.653.558.558 0 0 1 .623-.147l.146.058a7.63 7.63 0 0 1 2.96 3.5c.58 1.413.576 3.06.184 4.527.325-.292.596-.641.801-1.033l.029-.064c.198-.477.821-.325 1.055-.013.086.137 2.292 3.343 1.107 6.048a5.516 5.516 0 0 1-1.84 2.027 6.127 6.127 0 0 1-2.138.893.834.834 0 0 1-.472-.038.867.867 0 0 1-.381-.29z" />
      </svg>
    ),
  },
  {
    id: "explore",
    label: "Explore",
    page: "explore",
    sparkles: [
      ["0.5s", "4.3s", "18%", "55%", "-5px"],
      ["1.3s", "3.8s", "62%", "35%", "6px"],
      ["2.1s", "4.6s", "85%", "68%", "-4px"],
      ["2.9s", "3.5s", "38%", "22%", "5px"],
    ],
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <path d="M9.879 9.879L15.536 8.464 14.121 14.121 8.464 15.536z" fill="currentColor" />
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    id: "communities",
    label: "Communities",
    sparkles: [
      ["0.4s", "4.4s", "24%", "58%", "-5px"],
      ["1.2s", "3.9s", "65%", "32%", "6px"],
      ["2.0s", "4.7s", "82%", "76%", "-4px"],
    ],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a4 4 0 0 1-4-4V6" />
        <path d="M2 13h6" />
        <path d="M2 9h6" />
        <path d="M2 17h6" />
      </svg>
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
      if ((e.target as HTMLElement).closest?.("#hamburger")) setOpen((o) => !o);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
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
  );
}
