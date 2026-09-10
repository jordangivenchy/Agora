"use client";

/* The top navbar, shared by the home shell and every standalone route:
   logo, search box with the Create pill, messages, bell, avatar menu —
   the mvp-home markup and classes, styled by mvp-home.css. Auth state
   starts from the last known user (lib/navUserCache.ts) and the session
   confirms it. The typeahead search panel is mounted here too so search
   opens in place on every route; the home shell wires the box itself
   (ownSearch={false}). */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { markHomeChosen } from "@/lib/homeChoice";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import NotificationsBell from "@/components/NotificationsBell";
import useNavbarSearch from "@/components/search/useNavbarSearch";
import type { SearchKeyHandler } from "@/components/search/SearchPage";
import { pathFor } from "@/lib/routes";
import { readNavUser, writeNavUser } from "@/lib/navUserCache";
import { userPath } from "@/lib/urls";
import { sessionUser } from "@/lib/session";

const SearchPage = dynamic(() => import("@/components/search/SearchPage"), { ssr: false });

interface NavUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export default function SiteNavbar({ onLogo, ownSearch = true }: {
  /** The logo's click; by default it goes home in place. */
  onLogo?: () => void;
  /** false: the host wires the search box and panel itself (the home
      shell does), so the hook stays off and no panel is rendered here. */
  ownSearch?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  /* /search?q=…: the panel pinned as a page, opened on the address's query. */
  const pinned = ownSearch && pathname === "/search";
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
    enabled: ownSearch,
  });
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
    sessionUser(supabase).then(async ({ data }) => {
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
    if (pinned) { router.replace(pathFor.search(query)); return; }
    navSearch.closePanel();
    router.push(pathFor.search(query));
  };
  const closeSearch = useCallback(() => {
    navSearch.closePanel();
    if (pinned) router.push("/");
  }, [navSearch, pinned, router]);
  useEffect(() => { closeSearchRef.current = closeSearch; }, [closeSearch]);
  useEffect(() => {
    if (!pinned) return;
    let q = "";
    try { q = new URLSearchParams(window.location.search).get("q") ?? ""; } catch {}
    navSearch.setQuery(q);
    navSearch.openPanel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned]);

  /* See-through at the top of the page and solid once scrolled
     (mvp-home.css .nav:not(.is-scrolled)); toggled on the element so
     scrolling never re-renders the bar. */
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const apply = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      navRef.current?.classList.toggle("is-scrolled", y > 8);
    };
    apply();
    window.addEventListener("scroll", apply, { passive: true });
    return () => window.removeEventListener("scroll", apply);
  }, []);

  return (
    <>
    <nav className="nav" ref={navRef}>
      <a
        className="nav-logo"
        href="/"
        aria-label="AgoraSphere"
        onClick={(e) => {
          e.preventDefault();
          markHomeChosen();
          if (onLogo) onLogo();
          else router.push("/");
        }}
      >
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
    {ownSearch && (
      <SearchPage
        open={navSearch.open || pinned}
        pinned={pinned}
        query={navSearch.query}
        setQuery={navSearch.setQuery}
        onClose={closeSearch}
        onPin={pinSearch}
        keyHandlerRef={searchKeyRef}
      />
    )}
    </>
  );
}

