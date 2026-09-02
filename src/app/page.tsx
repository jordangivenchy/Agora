"use client";

/* Homepage — MVP design (WorkingIndexV5) driven by real AgoraSphere data.
   The visual layer is the original MVP HTML/CSS/JS carried over verbatim;
   mvp-adapter.js swaps its demo data for the rooms fetched here and routes
   clicks to the real app (rooms, login, create modal). */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { userPath } from "@/lib/urls";
import CreateRoomModal from "@/components/CreateRoomModal";
import TrendingPage from "@/components/TrendingPage";
import TopicsHome from "@/components/TopicsHome";
import HomeSidebar, { type HomeNavId } from "@/components/HomeSidebar";
import NotificationsBell from "@/components/NotificationsBell";
import NewsTicker from "@/components/NewsTicker";
import CommunitiesPage from "@/components/CommunitiesPage";
import NewsPage, { topicFor } from "@/components/NewsPage";
import FeedPage from "@/components/feed/FeedPage";
import SearchPage, { type SearchKeyHandler } from "@/components/search/SearchPage";
import useNavbarSearch from "@/components/search/useNavbarSearch";
import ExploreGrid from "@/components/ExploreGrid";
import { MVP_HOME_HTML } from "@/components/mvp-home-html";
import { displayName } from "@/lib/names";
import { parseHomeRoute, canonicalPath, pathFor, sectionTitle, setSectionTitle, type HomeRoute } from "@/lib/routes";
import "./mvp-home.css";

const TOPIC_MAP: Record<string, string> = {
  "politics-law": "politics-law",
  ethics: "politics-ethics",
  sports: "sports",
  culture: "culture",
  economics: "economics",
  "science-tech": "science-tech",
  "foreign-policy": "foreign-policy",
  philosophy: "philosophy",
};

const GRADIENTS = [
  "linear-gradient(135deg, #0d1b3e 0%, #1e0533 100%)",
  "linear-gradient(135deg, #1a1000 0%, #002d3d 100%)",
  "linear-gradient(135deg, #0d2b1a 0%, #2d1a00 100%)",
  "linear-gradient(135deg, #001a2e 0%, #002214 100%)",
  "linear-gradient(135deg, #2d0a1a 0%, #1a1500 100%)",
  "linear-gradient(135deg, #0d0a2e 0%, #2e0d0d 100%)",
  "linear-gradient(135deg, #001e2e 0%, #0d001a 100%)",
  "linear-gradient(135deg, #001a3d 0%, #1a001a 100%)",
];

const PALETTE = ["#00b894", "#e17055", "#e2b96b", "#fd79a8", "#4a9eff", "#00cec9", "#64B5F6", "#1976D2"];

const FORMAT_LABEL: Record<string, string> = {
  open: "Open",
  oxford: "Oxford",
  "1v1": "1v1",
  panel: "Panel",
};

type PanelTab = "feed" | "trending" | "communities" | "news" | "search";
const PANEL_TABS: readonly string[] = ["feed", "trending", "communities", "news", "search"];
const isPanelTab = (s: string): s is PanelTab => PANEL_TABS.includes(s);
const HOME_CHOSEN_KEY = "agora:home-chosen";

function fmtViewers(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n);
}

export default function Home() {
  const [supabase] = useState(() => createClient());
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab | null>(null);
  /* Search panel (anchored under the navbar box, see search/SearchPage):
     open+pinned ⇔ activeTab === "search" (/search?q=…); open+unpinned is
     transient UI state with no URL change. The navbar input is the only
     input — useNavbarSearch binds to it. */
  const searchKeyRef = useRef<SearchKeyHandler | null>(null);
  const searchPinnedFromRef = useRef<string | null>(null);
  const navSearch = useNavbarSearch({
    onKey: (e, v) => searchKeyRef.current?.(e, v) ?? false,
    onCloseRequest: () => closeSearchRef.current(),
  });
  const closeSearchRef = useRef<() => void>(() => {});
  /* Signed-in users landing on a bare "/" get their feed. Once they've
     explicitly picked Home in the sidebar, "/" stays the browse page for
     the rest of the session. */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [fieldsHost, setFieldsHost] = useState<HTMLElement | null>(null);
  /* Which MVP-rendered page is showing when no React tab is open; the
     sidebar highlights activeTab ?? mvpPage. */
  const [mvpPage, setMvpPage] = useState<"home" | "explore">("home");
  const [bellHost, setBellHost] = useState<HTMLElement | null>(null);
  const [newsHost, setNewsHost] = useState<HTMLElement | null>(null);
  const [exploreHost, setExploreHost] = useState<HTMLElement | null>(null);
  const [createPrefill, setCreatePrefill] = useState<{
    motion: string; topic: string; schedule?: boolean;
    communityId?: string; communityName?: string;
  } | null>(null);
  const [booted, setBooted] = useState(false);
  const [dbOffline, setDbOffline] = useState(false);
  const dataLandedRef = useRef(false);
  const hostRef = useRef<HTMLDivElement>(null);

  /* Inject the MVP markup imperatively, outside React's diffing, so state
     changes (e.g. opening the create modal) can never rewrite it and wipe
     the mutations made by the MVP scripts and adapter. */
  useEffect(() => {
    if (hostRef.current && !hostRef.current.firstChild) {
      hostRef.current.innerHTML = MVP_HOME_HTML;
    }
    // Portal targets living inside the MVP markup: the Browse section
    // below the carousel, and the navbar's notification bell slot.
    setFieldsHost(document.getElementById("fieldsSection"));
    setBellHost(document.getElementById("notifBellHost"));
    setNewsHost(document.getElementById("newsTickerHost"));
    setExploreHost(document.getElementById("epResultsGrid"));
  }, []);

  /* Fetch real rooms + auth + platform stats, expose to the MVP scripts.
     Called on boot, on realtime changes, and every 30s as a live tracker. */
  const loadData = useCallback(async () => {
      try {
        const [{ data: auth }, { data: roomsData }, { count: memberCount }] = await Promise.all([
          supabase.auth.getUser(),
          supabase
            .from("debate_rooms")
            .select(`*, host:users!host_id(avatar_url), participants:debate_participants(*, user:users(username, display_name, avatar_url))`)
            .in("status", ["live", "created", "scheduled"])
            .order("created_at", { ascending: false })
            .limit(100),
          supabase.from("users").select("id", { count: "exact", head: true }),
        ]);

        const rooms = roomsData ?? [];
        const votesByRoom: Record<string, { pro: number; con: number }> = {};
        if (rooms.length) {
          const { data: votes } = await supabase
            .from("debate_votes")
            .select("room_id, stance")
            .in("room_id", rooms.map((r) => r.id));
          for (const v of votes ?? []) {
            const rec = (votesByRoom[v.room_id] ??= { pro: 0, con: 0 });
            if (v.stance === "PRO") rec.pro++;
            else rec.con++;
          }
        }

        /* Community-hosted rooms are presented under the community's name.
           The color lands inside mvp-home.js innerHTML templates, so only a
           strict hex value may pass (the DB also constrains the format). */
        const safeColor = (c: string | null) =>
          c && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : null;
        const communityById = new Map<string, { name: string; color: string | null }>();
        const communityIds = [...new Set(rooms.map((r) => r.community_id).filter(Boolean))] as string[];
        if (communityIds.length) {
          const { data: comms } = await supabase
            .from("communities")
            .select("id, name, color")
            .in("id", communityIds);
          for (const c of comms ?? []) communityById.set(c.id, { name: c.name, color: safeColor(c.color) });
        }

        const debates = rooms.map((room, i) => {
          const active = (room.participants ?? []).filter(
            (p: { left_at: string | null }) => !p.left_at
          );
          const debaters = active.filter((p: { role: string }) => p.role === "debater");
          const audienceCount = active.filter((p: { role: string }) => p.role === "spectator").length;
          const proD = debaters.find((p: { stance: string | null }) => p.stance === "PRO");
          const conD = debaters.find((p: { stance: string | null }) => p.stance === "CON");
          const key = TOPIC_MAP[room.topic_key] ?? "culture";
          const v = votesByRoom[room.id] ?? { pro: 0, con: 0 };
          const total = v.pro + v.con;
          return {
            motion: room.motion,
            debater1: proD?.user ? displayName(proD.user) : "Open seat",
            // Mirror debater1's fallback: an empty string renders its initial as
            // literal "undefined" in the card avatar.
            debater2: conD?.user ? displayName(conD.user) : "Open seat",
            color1: PALETTE[i % PALETTE.length],
            color2: PALETTE[(i + 3) % PALETTE.length],
            elo: "—",
            viewers: fmtViewers(room.viewer_count ?? 0),
            viewersNum: room.viewer_count ?? 0,
            progress: total ? Math.round((v.pro / total) * 100) : 50,
            topicKey: key,
            secondaryTopics: (room.secondary_topics ?? []).map((k: string) => TOPIC_MAP[k] ?? k),
            subTags: [],
            gradient: GRADIENTS[i % GRADIENTS.length],
            liveSince: room.started_at ?? room.created_at ?? null,
            speakerCount: debaters.length,
            audienceCount,
            // Same fallback as the room cards: uploaded thumbnail, else the host's avatar.
            thumbnailUrl: (() => {
              const host = room.host as { avatar_url?: string | null } | { avatar_url?: string | null }[] | null;
              const hostAvatar = Array.isArray(host) ? host[0]?.avatar_url : host?.avatar_url;
              const pick = room.thumbnail_url || hostAvatar || null;
              return typeof pick === "string" && /^https:\/\//.test(pick) ? pick : null;
            })(),
            debater1Stance: "PRO",
            debater2Stance: "CON",
            status: room.status === "live" ? "live" : room.scheduled_start ? "scheduled" : "queue",
            format: FORMAT_LABEL[room.format] ?? "Open",
            language: (room.language ?? "EN").toUpperCase().slice(0, 2),
            votesPro: v.pro,
            votesCon: v.con,
            roomId: room.id,
            community: room.community_id ? (communityById.get(room.community_id)?.name ?? null) : null,
            communityColor: room.community_id ? (communityById.get(room.community_id)?.color ?? null) : null,
          };
        });

        const user = auth?.user;
        setSignedIn(!!user);
        let profileName: string | null = null;
        let profileAvatar: string | null = null;
        let profileUsername: string | null = null;
        if (user) {
          const { data: me } = await supabase
            .from("users")
            .select("username, display_name, avatar_url")
            .eq("id", user.id)
            .maybeSingle();
          if (me) {
            profileName = displayName(me) || null;
            profileAvatar = me.avatar_url ?? null;
            profileUsername = me.username ?? null;
          }
        }
        const liveRooms = rooms.filter((r) => r.status === "live");
        const data = {
          debates,
          user: user ? { id: user.id, name: profileName ?? user.user_metadata?.name ?? user.email ?? "U", username: profileUsername, avatarUrl: profileAvatar } : null,
          stats: {
            activeRooms: rooms.length,
            members: memberCount ?? 0,
            watching: liveRooms.reduce((sum, r) => sum + (r.viewer_count ?? 0), 0),
          },
        };
        const w = window as unknown as Record<string, unknown>;
        w.__AGORA_DATA__ = data;
        // Live update path: if the MVP engine is already running, push the
        // fresh data straight into it.
        if (typeof w.__agoraApplyData === "function") {
          (w.__agoraApplyData as (d: unknown) => void)(data);
        }
        dataLandedRef.current = true;
        setDbOffline(false);
        setBooted(true);
      } catch (e) {
        console.error("home data load failed", e);
        // Boot anyway so the MVP demo data renders and the page isn't blank.
        (window as unknown as Record<string, unknown>).__AGORA_DATA__ ??= { debates: [], user: null };
        setDbOffline(true);
        setBooted(true);
      }
  }, [supabase]);

  /* Every path into the create modal goes through here: signed-out
     visitors are sent to /login instead of a modal they can't submit. */
  const openCreate = useCallback(
    async (prefill: {
      motion: string; topic: string; schedule?: boolean;
      communityId?: string; communityName?: string;
    } | null) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) { window.location.href = "/login"; return; }
      setCreatePrefill(prefill);
      setShowCreate(true);
    },
    [supabase]
  );

  /* Profile links always land on the standalone page — the quick-look
     modal is retired. Ids (events, legacy links) resolve to a username
     first; unresolvable ids are silently dropped. */
  const goToProfileById = useCallback(
    (id: string) => {
      supabase
        .from("users")
        .select("username")
        .eq("id", id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.username) window.location.href = userPath(data.username);
        });
    },
    [supabase]
  );

  // Deep link support: /?profile=<userId> (old "Copy profile link" URLs and
  // pre-migration notification emails). The quick-look modal is gone —
  // resolve the id to a username and land on the real profile page.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("profile");
    if (p) goToProfileById(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Never let a slow or unreachable backend hold the UI hostage. Supabase's
     auth client retries with backoff for minutes when its host is down, so
     `loadData` can hang well past any reasonable paint. Boot the visual
     engine on a short timer regardless; real data flows in later via
     __agoraApplyData if and when the fetch lands. */
  useEffect(() => {
    const t = setTimeout(() => {
      if (dataLandedRef.current) return;
      (window as unknown as Record<string, unknown>).__AGORA_DATA__ ??= { debates: [], user: null };
      setDbOffline(true);
      setBooted(true);
    }, 3500);
    return () => clearTimeout(t);
  }, []);

  /* Boot + live tracking: realtime DB changes and a 30s heartbeat both
     re-run loadData, so viewer counts and member totals stay current. */
  useEffect(() => {
    loadData();
    const channel = supabase
      .channel("mvp-home-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_rooms" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_participants" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, loadData)
      .subscribe();
    const heartbeat = setInterval(loadData, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(heartbeat);
    };
  }, [loadData, supabase]);

  /* Load the MVP engine once, after the DOM above is in place. */
  useEffect(() => {
    if (!booted) return;
    const w = window as unknown as Record<string, unknown>;
    if (w.__MVP_BOOTED__) {
      // Engine already loaded (client-side remount): re-init against the
      // freshly injected DOM and re-apply the data adapter.
      if (typeof w.init === "function") (w.init as () => void)();
      const adapter = document.createElement("script");
      adapter.src = "/mvp-adapter.js";
      document.body.appendChild(adapter);
      return;
    }
    w.__MVP_BOOTED__ = true;

    // Fonts come from next/font in the root layout — no injected stylesheet.
    const three = document.createElement("script");
    three.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
    three.onload = () => {
      const engine = document.createElement("script");
      engine.src = "/mvp-home.js";
      engine.onload = () => {
        const adapter = document.createElement("script");
        adapter.src = "/mvp-adapter.js";
        document.body.appendChild(adapter);
      };
      document.body.appendChild(engine);
    };
    document.body.appendChild(three);
  }, [booted]);

  /* Keep the MVP shell in sync with the active React tab: hide the MVP's
     main content while a tab panel is open. (The sidebar highlight is
     React state now — see HomeSidebar below.) */
  useEffect(() => {
    const main = document.querySelector(".main") as HTMLElement | null;
    /* The search panel floats over whatever was showing; it never hides it. */
    if (main) main.style.display = activeTab && activeTab !== "search" ? "none" : "";
  }, [activeTab, booted]);

  /* Sidebar navigation: React panels for trending/communities/news; the
     MVP engine's own page switch for home/explore (it exposes both). */
  const onSidebarNavigate = useCallback((id: HomeNavId) => {
    const w = window as unknown as { loadHomePage?: () => void; loadExplorePage?: () => void };
    if (isPanelTab(id)) {
      setActiveTab(id);
      return;
    }
    if (id === "home") {
      try { sessionStorage.setItem(HOME_CHOSEN_KEY, "1"); } catch { /* private mode */ }
    }
    setActiveTab(null);
    setMvpPage(id);
    if (id === "explore") w.loadExplorePage?.();
    else w.loadHomePage?.();
  }, []);

  /* ── URL routing ──
     Sections live as state on this page; next.config rewrites
     /trending, /news, /explore, /communities[/slug] and /posts/:id to
     "/" so the browser keeps the pretty path. (/messages is a REAL
     route — src/app/messages — since the dedicated page.) On
     mount and on popstate the path is parsed into state; when state
     changes from in-app navigation, the matching path is pushed.
     Community/post routes are resolved by CommunitiesPage (it owns the
     lists) via the "agora:route" event; legacy ?nav=/?post=/?dm= forms
     are replaced with the canonical URL. */
  const routeRef = useRef<{ route: HomeRoute; seq: number } | null>(null);
  const [pendingRoute, setPendingRoute] = useState<{ route: HomeRoute; seq: number } | null>(null);

  useEffect(() => {
    let seq = 0;
    const read = (replaceLegacy: boolean) => {
      const { route, legacy } = parseHomeRoute(window.location.pathname, window.location.search, window.location.hash);
      if (legacy && replaceLegacy) {
        const canon = canonicalPath(route);
        if (canon) window.history.replaceState(null, "", canon);
      }
      const next = { route, seq: ++seq };
      routeRef.current = next;
      setPendingRoute(next);
    };
    read(true);
    const onPop = () => read(false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /* Apply a parsed route to state. React panels open immediately (they
     cover the home shell while it boots); Explore is MVP driven and the
     legacy ?dm= redirect waits for `booted`. */
  const appliedSeqRef = useRef(0);
  const lastPushedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingRoute || appliedSeqRef.current === pendingRoute.seq) return;
    const { route } = pendingRoute;
    const w = window as unknown as { loadHomePage?: () => void };
    const done = () => {
      appliedSeqRef.current = pendingRoute.seq;
      lastPushedRef.current = window.location.pathname;
    };
    switch (route.kind) {
      case "section":
        if (isPanelTab(route.id)) {
          setActiveTab(route.id);
          done();
        } else if (route.id === "explore") {
          if (!booted) return;
          setActiveTab(null);
          setMvpPage("explore");
          done();
          /* The MVP engine loads asynchronously after `booted` (three.js,
             then mvp-home.js); wait for loadExplorePage to exist. */
          const w2 = window as unknown as { loadExplorePage?: () => void };
          let tries = 0;
          const tick = () => {
            if (typeof w2.loadExplorePage === "function") { w2.loadExplorePage(); return; }
            if (++tries < 100) setTimeout(tick, 100);
          };
          tick();
        } else {
          setActiveTab(null);
          if (mvpPage !== "home") { setMvpPage("home"); w.loadHomePage?.(); }
          done();
        }
        return;
      case "search":
        navSearch.setQuery(route.q);
        setActiveTab("search");
        navSearch.openPanel();
        done();
        return;
      case "community":
      case "post":
        setActiveTab("communities");
        document.dispatchEvent(new CustomEvent("agora:route", { detail: route }));
        done();
        return;
      case "dm-user":
        /* Legacy /?dm=<id> deep link — messages live on a real route
           now, so resolve the username and hand the browser over. */
        if (!booted) return;
        done();
        (async () => {
          const { data } = await supabase
            .from("users").select("username").eq("id", route.userId).maybeSingle();
          /* replace(), not assign(): consume the /?dm= history entry so
             Back skips the redirect hop. */
          if (data) window.location.replace(pathFor.messages((data as { username: string }).username));
          else window.history.replaceState(null, "", "/");
        })();
        return;
    }
  }, [pendingRoute, booted, supabase, mvpPage, navSearch]);

  /* Signed-in landing on a bare "/" (no section, no query, no hash):
     open the feed and rewrite the address to /feed. Skipped once the
     user has chosen Home this session, and never on popstate (the
     route effect above handles those). */
  const feedRedirectRef = useRef(false);
  useEffect(() => {
    if (feedRedirectRef.current || signedIn !== true || !pendingRoute) return;
    const { route } = pendingRoute;
    if (route.kind !== "section" || route.id !== "home") return;
    if (window.location.pathname !== "/" || window.location.search || window.location.hash) return;
    let chosen = false;
    try { chosen = sessionStorage.getItem(HOME_CHOSEN_KEY) === "1"; } catch { /* private mode */ }
    feedRedirectRef.current = true;
    if (chosen) return;
    window.history.replaceState(null, "", pathFor.section("feed"));
    lastPushedRef.current = "/feed";
    setActiveTab("feed");
  }, [signedIn, pendingRoute]);

  /* Push the section path when in-app navigation changes it. Only pushes
     when the desired path actually changed (so an unrelated URL such as
     /messages isn't clobbered) and differs from the address bar (so
     popstate-driven changes don't add duplicate entries). The
     Communities panel pushes its own /communities[/slug] and /posts/:id. */
  useEffect(() => {
    /* Search owns its own /search?q=… (replaceState as the user types). */
    if (activeTab === "communities" || activeTab === "search") return;
    const desired = activeTab ? pathFor.section(activeTab) : pathFor.section(mvpPage);
    setSectionTitle(sectionTitle(activeTab ?? mvpPage));
    // First run (before the mount route is applied): record, don't push.
    if (lastPushedRef.current === null) { lastPushedRef.current = desired; return; }
    if (lastPushedRef.current === desired) return;
    lastPushedRef.current = desired;
    if (window.location.pathname !== desired) window.history.pushState(null, "", desired);
  }, [activeTab, mvpPage]);

  /* ── Search panel open / pin / close ── */
  const searchOpen = navSearch.open || activeTab === "search";
  const pinSearch = useCallback((q: string) => {
    const t = q.trim();
    if (!t) return;
    if (activeTab !== "search") {
      searchPinnedFromRef.current = window.location.pathname + window.location.search;
      window.history.pushState(null, "", pathFor.search(t));
      lastPushedRef.current = "/search";
      setActiveTab("search");
    } else {
      window.history.replaceState(null, "", pathFor.search(t));
    }
    navSearch.setQuery(t);
    navSearch.openPanel();
  }, [activeTab, navSearch]);
  const closeSearch = useCallback(() => {
    navSearch.closePanel();
    if (activeTab !== "search") return;
    /* Pinned: step back to where the user came from if we pushed the
       /search entry ourselves, else push the prior section path (same
       pattern as the section-path effect above). */
    const from = searchPinnedFromRef.current;
    searchPinnedFromRef.current = null;
    if (from !== null) { window.history.back(); return; }
    setActiveTab(null);
  }, [activeTab, navSearch]);
  useEffect(() => { closeSearchRef.current = closeSearch; }, [closeSearch]);
  /* Leaving /search by any other route (back button, sidebar, a result
     click) drops the pin and closes the panel. */
  const prevTabRef = useRef<PanelTab | null>(null);
  useEffect(() => {
    if (prevTabRef.current === "search" && activeTab !== "search") {
      searchPinnedFromRef.current = null;
      navSearch.closePanel();
    }
    prevTabRef.current = activeTab;
  }, [activeTab, navSearch]);

  useEffect(() => {
    const onCreate = () => { openCreate(null); };
    const onProfile = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string" && detail) {
        // Someone else: their full profile page.
        goToProfileById(detail);
        return;
      }
      // Own profile (nav avatar → Profile): same destination.
      const w = window as unknown as { __AGORA_DATA__?: { user?: { id?: string } } };
      const myId = w.__AGORA_DATA__?.user?.id;
      if (myId) goToProfileById(myId);
    };
    const onTab = (e: Event) => {
      const tab = (e as CustomEvent).detail;
      if (typeof tab === "string" && isPanelTab(tab)) setActiveTab(tab);
      else if (tab === "close") setActiveTab(null);
      else if (tab === "home") onSidebarNavigate("home");
      else if (tab === "battle") {
        // Legacy Topics-tab key: the dropdowns now live on the home feed.
        setActiveTab(null);
        (document.querySelector('[data-nav-id="home"]') as HTMLElement | null)?.click();
        setTimeout(() => {
          document.getElementById("fieldsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
      }
    };
    const onLogout = async () => {
      await supabase.auth.signOut();
      window.location.reload();
    };
    window.addEventListener("agora:create", onCreate);
    /* /?create=1 or /?create=schedule (from profile empty states) opens the
       create modal directly — scheduling pre-toggled for the latter. */
    {
      const params = new URLSearchParams(window.location.search);
      const c = params.get("create");
      if (c) {
        params.delete("create");
        const q = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
        openCreate({ motion: "", topic: "", schedule: c === "schedule" });
      }
    }
    window.addEventListener("agora:profile", onProfile);
    window.addEventListener("agora:tab", onTab);
    window.addEventListener("agora:logout", onLogout);
    return () => {
      window.removeEventListener("agora:create", onCreate);
      window.removeEventListener("agora:profile", onProfile);
      window.removeEventListener("agora:tab", onTab);
      window.removeEventListener("agora:logout", onLogout);
    };
  }, [supabase, onSidebarNavigate, openCreate, goToProfileById]);

  /* Hero "Queue a discussion": the vanilla carousel raises
     agora:queue-headline; this owns the RPC + the match poll and answers
     with agora:hero-queue-state so the button can paint itself. Same
     queue_for_headline / check_topic_match flow as the News panel. */
  useEffect(() => {
    const topicByHeadline = new Map<string, string>();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
    const ensurePoll = () => {
      if (pollTimer || topicByHeadline.size === 0) return;
      pollTimer = setInterval(async () => {
        const { data: roomId } = await supabase.rpc("check_topic_match");
        if (roomId) { stopPoll(); window.location.href = `/agora/${roomId}`; }
      }, 2500);
    };
    const emit = (headline: string, state: string, message?: string) =>
      window.dispatchEvent(new CustomEvent("agora:hero-queue-state", { detail: { headline, state, message } }));

    const onQueueHeadline = async (e: Event) => {
      const d = (e as CustomEvent).detail as { headline?: string; category?: string; url?: string } | undefined;
      const headline = d?.headline;
      if (!headline) return;
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { window.location.href = "/login"; return; }

      const existing = topicByHeadline.get(headline);
      emit(headline, "busy");
      if (existing) {
        await supabase.rpc("leave_topic_queue", { p_topic: existing });
        topicByHeadline.delete(headline);
        if (topicByHeadline.size === 0) stopPoll();
        emit(headline, "idle");
        return;
      }
      const { data, error } = await supabase.rpc("queue_for_headline", {
        p_question: headline,
        p_topic_key: topicFor(d?.category || null),
        p_stance: "PRO",
        p_source_url: d?.url || null,
      });
      if (error) { emit(headline, "error", error.message.replace(/^[a-z_]+:\s*/, "")); return; }
      const res = data as { status?: string; room_id?: string; topic_id?: string } | null;
      if (res?.status === "matched" && res.room_id) { window.location.href = `/agora/${res.room_id}`; return; }
      if (res?.topic_id) { topicByHeadline.set(headline, res.topic_id); emit(headline, "queued"); ensurePoll(); }
      else emit(headline, "idle");
    };

    window.addEventListener("agora:queue-headline", onQueueHeadline);
    return () => { window.removeEventListener("agora:queue-headline", onQueueHeadline); stopPoll(); };
  }, [supabase]);

  return (
    <>
      <div ref={hostRef} />
      {dbOffline && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            zIndex: 300,
            maxWidth: 340,
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(51,41,26,0.96)",
            border: "1px solid #6b5a30",
            color: "#f4d47c",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ fontWeight: 600 }}>Database unreachable</strong> — showing the
          interface with example content. Live discussions, sign-in, and your profile need the
          Supabase project to be running.
        </div>
      )}
      <NotificationsBell container={bellHost} />
      <NewsTicker container={newsHost} />
      <ExploreGrid container={exploreHost} />
      <TrendingPage open={activeTab === "trending"} onClose={() => setActiveTab(null)} />
      <FeedPage open={activeTab === "feed"} onClose={() => setActiveTab(null)} />
      <SearchPage
        open={searchOpen}
        pinned={activeTab === "search"}
        query={navSearch.query}
        setQuery={navSearch.setQuery}
        onClose={closeSearch}
        onPin={pinSearch}
        keyHandlerRef={searchKeyRef}
      />
      <HomeSidebar activeId={activeTab === "search" ? null : (activeTab ?? mvpPage)} onNavigate={onSidebarNavigate} />
      <TopicsHome
        container={fieldsHost}
        onCreateLobby={(topic, schedule) => openCreate({ motion: "", topic, schedule })}
      />
      <CommunitiesPage
        open={activeTab === "communities"}
        onClose={() => setActiveTab(null)}
        onStartDiscussion={(communityId, communityName) => {
          // Starts live by default — "Schedule for later" stays available
          // inside the modal for members who want a future slot.
          openCreate({ motion: "", topic: "", communityId, communityName });
        }}
      />
      <NewsPage
        open={activeTab === "news"}
        onClose={() => setActiveTab(null)}
        onStartDebate={(motion, topic) => openCreate({ motion, topic })}
      />
      <CreateRoomModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        initialMotion={createPrefill?.motion}
        initialTopic={createPrefill?.topic}
        initialSchedule={createPrefill?.schedule}
        communityId={createPrefill?.communityId}
        communityName={createPrefill?.communityName}
      />
    </>
  );
}
