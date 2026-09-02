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
import { Icon } from "@/components/icons";
import NotificationsBell from "@/components/NotificationsBell";
import { pathFor } from "@/lib/routes";
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

interface NavUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

function SiteNavbar() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [q, setQ] = useState("");
  /* undefined = still resolving (render neither auth state to avoid a
     Log in flash for signed-in users). */
  const [user, setUser] = useState<NavUser | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!alive) return;
      const uid = data.user?.id;
      if (!uid) { setUser(null); return; }
      const { data: row } = await supabase
        .from("users")
        .select("id, username, display_name, avatar_url")
        .eq("id", uid)
        .maybeSingle();
      if (alive) setUser((row as NavUser | null) ?? null);
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

  const submitSearch = () => router.push(pathFor.search(q));

  return (
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
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submitSearch(); }}
          placeholder="Search topics, people, or keywords…"
          aria-label="Search"
          autoComplete="off"
        />
        <button
          className="create-btn nav-search-btn"
          id="searchBtn"
          type="button"
          aria-label="Create a discussion"
          onClick={() => router.push(user ? "/?create=1" : "/login")}
        >
          <span className="create-icon"><Icon name="sparkles" size={16} /></span>
          <span className="create-label"><span>C</span><span>r</span><span>e</span><span>a</span><span>t</span><span>e</span></span>
        </button>
      </div>
      <div className="nav-auth">
        {/* Phones only (CSS): the search pill is hidden there, so search
            lives behind an icon in the right cluster, Kick-style. */}
        <a
          className="nav-search-icon"
          href="/search"
          aria-label="Search"
          onClick={(e) => { e.preventDefault(); router.push(pathFor.search()); }}
        >
          <Icon name="search" size={17} />
        </a>
        {/* Phones only (CSS): Create lives in the hidden search pill on
            desktop, so it gets its own yellow "+" here. */}
        <a
          className="nav-create-icon"
          href="/?create=1"
          aria-label="Create a discussion"
          onClick={(e) => { e.preventDefault(); router.push(user ? "/?create=1" : "/login"); }}
        >
          <Icon name="sparkles" size={17} />
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
  );
}

export default function SiteChrome({
  activeId = null,
  children,
}: {
  activeId?: HomeNavId | null;
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <div className="min-h-screen site-chrome" style={{ background: "#000", fontFamily: "'DM Sans', sans-serif" }}>
      <Starfield />
      <SiteNavbar />

      {/* Always mounted: the desktop rail at lg+, an off-canvas drawer
          (hamburger-driven) below — never simply gone. */}
      <div>
        <HomeSidebar activeId={activeId} onNavigate={(id) => router.push(pathFor.section(id))} />
      </div>

      {/* .nav is position:fixed (60px), so the page content starts below
          it; relative + z-1 lifts it above the starfield canvas (same
          stacking the homepage's .main uses). */}
      <div style={{ paddingTop: "var(--nav-height, 60px)", position: "relative", zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
