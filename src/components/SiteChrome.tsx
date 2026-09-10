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
import { createClient } from "@/lib/supabase-browser";
import LoadingScreen from "@/components/LoadingScreen";
import { Icon } from "@/components/icons";
import NotificationsBell from "@/components/NotificationsBell";
import useNavbarSearch from "@/components/search/useNavbarSearch";
import type { SearchKeyHandler } from "@/components/search/SearchPage";
import { pathFor } from "@/lib/routes";
import { readNavUser, writeNavUser } from "@/lib/navUserCache";
import { userPath } from "@/lib/urls";
import type { HomeNavId } from "@/components/HomeSidebar";
/* Statically, not via the sidebar's dynamic chunk: the navbar renders on
   first paint, and without this the mvp styles arrive a beat later — the
   logo flashes at natural size and the bar loads unstyled. */
import "@/components/home-sidebar.css";

/* Client-only like on the profile route, so mvp-home.css (imported
   inside the sidebar) stays wrapped in its layer. */
const HomeSidebar = dynamic(() => import("@/components/HomeSidebar"), { ssr: false });
const Starfield = dynamic(() => import("@/components/Starfield"), { ssr: false });
/* The homepage's typeahead search panel, mounted here too so search
   opens in place on every route (it reads localStorage for recents). */
const SearchPage = dynamic(() => import("@/components/search/SearchPage"), { ssr: false });

interface NavUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

function SiteNavbar() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  /* The same typeahead search panel the homepage has: the hook binds
     the navbar box (#searchInput) and drives SearchPage, so search opens
     in place on every route instead of loading the home shell. Pinning
     (Enter / "See all results") is the one thing that navigates. */
  const searchKeyRef = useRef<SearchKeyHandler | null>(null);
  const closeSearchRef = useRef<() => void>(() => {});
  const navSearch = useNavbarSearch({
    onKey: (e, v) => searchKeyRef.current?.(e, v) ?? false,
    onCloseRequest: () => closeSearchRef.current(),
  });
  useEffect(() => { closeSearchRef.current = navSearch.closePanel; }, [navSearch.closePanel]);
  /* undefined = still resolving (render neither auth state to avoid a
     Log in flash for signed-in users). */
  const [user, setUser] = useState<NavUser | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    /* The last known user first (lib/navUserCache.ts), so a signed-in
       visitor sees their avatar at once; the session confirms or clears
       it below. */
    const cached = readNavUser();
    if (cached) {
      queueMicrotask(() => {
        if (!alive) return;
        setUser((prev) => prev === undefined
          ? { id: cached.id, username: cached.username ?? "", display_name: cached.name, avatar_url: cached.avatarUrl }
          : prev);
      });
    }
    supabase.auth.getUser().then(async ({ data }) => {
      if (!alive) return;
      const uid = data.user?.id;
      if (!uid) { setUser(null); writeNavUser(null); return; }
      const { data: row } = await supabase
        .from("users")
        .select("id, username, display_name, avatar_url")
        .eq("id", uid)
        .maybeSingle();
      const u = (row as NavUser | null) ?? null;
      if (alive) setUser(u);
      writeNavUser(u ? { id: u.id, name: u.display_name || u.username, username: u.username, avatarUrl: u.avatar_url } : null);
    });
    return () => { alive = false; };
  }, [supabase]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const pinSearch = (query: string) => {
    navSearch.closePanel();
    router.push(pathFor.search(query));
  };

  return (
    <>
    <nav className="nav">
      <a className="nav-logo" href="/" aria-label="AgoraSphere">
        {/* Inline height is the pre-CSS fallback; the stylesheet's
            clamp(...) !important takes over once loaded. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="AgoraSphere" style={{ height: 24, width: "auto" }} />
      </a>
      <div className="nav-search agora-search-shell" id="navSearchWrap">
        <div className="search-active-indicator" />
        <input
          id="searchInput"
          type="text"
          /* Uncontrolled on purpose: useNavbarSearch owns this element. */
          placeholder="Search topics, people, or keywords…"
          aria-label="Search"
          autoComplete="off"
        />
        <button
          className="create-btn nav-search-btn"
          id="searchBtn"
          type="button"
          aria-label="Create"
          onClick={(e) => {
            if (!user) { router.push("/login"); return; }
            const r = e.currentTarget.getBoundingClientRect();
            window.dispatchEvent(new CustomEvent("agora:create-menu", { detail: { top: r.bottom, right: window.innerWidth - r.right } }));
          }}
        >
          <span className="create-label"><span>C</span><span>r</span><span>e</span><span>a</span><span>t</span><span>e</span></span>
        </button>
      </div>
      <div className="nav-auth">
        {/* Phones only (CSS): the search pill is hidden there, so search
            lives behind an icon in the right cluster, Kick-style. The
            search hook binds the tap (reveal box, focus, open panel);
            the href is the no-JS fallback. */}
        <a className="nav-search-icon" href="/search" aria-label="Search">
          <Icon name="search" size={17} />
        </a>
        {user === null && (
          <>
            <button className="btn-ghost" onClick={() => router.push("/login")}>Log in</button>
            <button className="btn-signup" onClick={() => router.push("/login")}>Sign up</button>
          </>
        )}
        {user && (
          <>
            <button
              className="nav-messages-btn"
              id="nav-messages-btn"
              type="button"
              aria-label="Messages"
              onClick={() => router.push("/messages")}
            >
              <Icon name="message-circle" size={16} />
            </button>
            <div style={{ display: "flex", alignItems: "center" }}>
              <NotificationsBell />
            </div>
            <div className="nav-avatar" id="profileAvatarWrap" ref={wrapRef}>
              <button
                className="avatar-btn"
                aria-label="Profile menu"
                aria-expanded={menuOpen}
                aria-haspopup="true"
                onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
              >
                <div className="avatar-neon-ring" />
                {user.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="avatar-photo" alt="" src={user.avatar_url} />
                ) : (
                  <span className="avatar-initial">
                    {(user.display_name || user.username || "U").charAt(0).toUpperCase()}
                  </span>
                )}
              </button>
              <div className={`avatar-dropdown${menuOpen ? " open" : ""}`} role="menu">
                <div className="avatar-menu-head">
                  <span className="avatar-menu-head-name">{user.display_name || user.username}</span>
                  <span className="avatar-menu-head-sub">@{user.username}</span>
                </div>
                <a
                  className="avatar-menu-item"
                  href={userPath(user.username)}
                  role="menuitem"
                  onClick={(e) => { e.preventDefault(); setMenuOpen(false); router.push(userPath(user.username)); }}
                >
                  <span className="avatar-menu-icon"><Icon name="user" size={14} /></span>Profile
                </a>
                <a
                  className="avatar-menu-item"
                  href="/settings"
                  role="menuitem"
                  onClick={(e) => { e.preventDefault(); setMenuOpen(false); router.push("/settings"); }}
                >
                  <span className="avatar-menu-icon"><Icon name="settings" size={14} /></span>Settings
                </a>
                <a
                  className="avatar-menu-item"
                  href="#friends"
                  role="menuitem"
                  onClick={(e) => { e.preventDefault(); setMenuOpen(false); window.dispatchEvent(new CustomEvent("agora:friends")); }}
                >
                  <span className="avatar-menu-icon"><Icon name="users" size={14} /></span>Friends
                </a>
                <div className="avatar-dropdown-divider" />
                <a
                  className="avatar-menu-item avatar-menu-item--danger"
                  href="#logout"
                  role="menuitem"
                  onClick={async (e) => {
                    e.preventDefault();
                    setMenuOpen(false);
                    writeNavUser(null);
                    await supabase.auth.signOut();
                    window.location.href = "/";
                  }}
                >
                  <span className="avatar-menu-icon"><Icon name="log-out" size={14} /></span>Log out
                </a>
              </div>
            </div>
          </>
        )}
      </div>
    </nav>
    <SearchPage
      open={navSearch.open}
      pinned={false}
      query={navSearch.query}
      setQuery={navSearch.setQuery}
      onClose={navSearch.closePanel}
      onPin={pinSearch}
      keyHandlerRef={searchKeyRef}
    />
    </>
  );
}

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
