"use client";

/* Homepage: the home shell — starfield, navbar, hero carousel, the
   daily topics and Explore — with the section panels (feed, trending,
   communities, news, search) as overlays. The shell's look is the
   original MVP stylesheet (mvp-home.css); its markup and behaviour are
   React now, driven by the rooms fetched here. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { readNavUser, writeNavUser } from "@/lib/navUserCache";
import LoadingScreen from "@/components/LoadingScreen";
import { userPath } from "@/lib/urls";
import CreateRoomModal from "@/components/CreateRoomModal";
import CreateCommunityModal from "@/components/community/CreateCommunityModal";
import TrendingPage from "@/components/TrendingPage";
import TopicsHome from "@/components/TopicsHome";
import HomeSidebar, { type HomeNavId } from "@/components/HomeSidebar";
import SiteNavbar from "@/components/SiteNavbar";
import Starfield from "@/components/Starfield";
import HeroCarousel, { type HeroRoom } from "@/components/HeroCarousel";
import ShootingStars from "@/components/ShootingStars";
import KeyboardGuard from "@/components/KeyboardGuard";
import CommunitiesPage from "@/components/CommunitiesPage";
import NewsPage, { topicFor } from "@/components/NewsPage";
import FeedPage from "@/components/feed/FeedPage";
import SearchPage, { type SearchKeyHandler } from "@/components/search/SearchPage";
import useNavbarSearch from "@/components/search/useNavbarSearch";
import ExplorePage, { type ShellStats } from "@/components/ExplorePage";
import { displayName } from "@/lib/names";
import { parseHomeRoute, canonicalPath, pathFor, sectionTitle, setSectionTitle, type HomeRoute } from "@/lib/routes";
import "./mvp-home.css";
import { sessionUser } from "@/lib/session";

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



export default function Home() {
  const [supabase] = useState(() => createClient());
  const [showCreate, setShowCreate] = useState(false);
  /* Site-wide community creation: /?create=community, agora:create-community,
     and the hand-off at the foot of the discussion modal. */
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  /* The Discussion ⇄ Community switch crossfades the two modals in place:
     `createLeaving` is the one fading out for ~170ms, `createVia` the one
     that arrived by switching (its overlay must not fade in again). */
  const [createLeaving, setCreateLeaving] = useState<"discussion" | "community" | null>(null);
  const [createVia, setCreateVia] = useState<"discussion" | "community" | null>(null);
  const switchCreate = useCallback((to: "discussion" | "community") => {
    const from = to === "discussion" ? "community" : "discussion";
    if (to === "community") setShowCreateCommunity(true);
    else setShowCreate(true);
    setCreateVia(to);
    setCreateLeaving(from);
    window.setTimeout(() => {
      if (from === "community") setShowCreateCommunity(false);
      else setShowCreate(false);
      setCreateLeaving(null);
    }, 170);
  }, []);
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
  const [carouselHost, setCarouselHost] = useState<HTMLElement | null>(null);
  const [exploreHost, setExploreHost] = useState<HTMLElement | null>(null);
  /* The hero's rooms: live ones ranked by viewers, from the data pass. */
  const [heroRooms, setHeroRooms] = useState<HeroRoom[]>([]);
  /* Live platform figures for the Explore banner, from the data pass below. */
  const [shellStats, setShellStats] = useState<ShellStats | null>(null);
  const [createPrefill, setCreatePrefill] = useState<{
    motion: string; topic: string; schedule?: boolean;
    communityId?: string; communityName?: string;
  } | null>(null);
  const [booted, setBooted] = useState(false);

  /* The shell's own loading screen: up until the data has landed and the
     hero's news fetch has settled — so the page never reveals itself
     half-built — then a short fade. Capped so a stalled fetch can't trap
     the page.
     Its sky continues the boot splash's on a full load and the chrome's
     overlay on a client-side arrival (they share a session). */
  const [shellReady, setShellReady] = useState(false);
  const waitRef = useRef<HTMLDivElement>(null);
  const waitFlags = useRef({ hero: false, done: false });
  useEffect(() => {
    if (shellReady) return;
    const f = waitFlags.current;
    const finish = () => {
      if (f.done) return;
      f.done = true;
      waitRef.current?.classList.add("is-leaving");
      window.setTimeout(() => setShellReady(true), 420);
    };
    const check = () => { if (booted && f.hero) finish(); };
    const onHero = () => { f.hero = true; check(); };
    window.addEventListener("agora:hero-settled", onHero);
    const cap = window.setTimeout(finish, 7000);
    check();
    return () => {
      window.removeEventListener("agora:hero-settled", onHero);
      clearTimeout(cap);
    };
  }, [booted, shellReady]);
  const [dbOffline, setDbOffline] = useState(false);
  const dataLandedRef = useRef(false);
  /** The signed-in user's id, for the navbar's own-profile jump. */
  const meIdRef = useRef<string | null>(null);

  /* Fetch real rooms + auth + platform stats, expose to the MVP scripts.
     Called on boot, on realtime changes, and every 30s as a live tracker. */
  const loadData = useCallback(async () => {
      try {
        const [{ data: auth }, { data: roomsData }, { count: memberCount }] = await Promise.all([
          sessionUser(supabase),
          supabase
            .from("debate_rooms")
            .select(`*, host:users!host_id(avatar_url), participants:debate_participants(*, user:users(username, display_name, avatar_url))`)
            .in("status", ["live", "created", "scheduled"])
            .order("created_at", { ascending: false })
            .limit(100),
          supabase.from("users").select("id", { count: "exact", head: true }),
        ]);

        const rooms = roomsData ?? [];

        /* Community-hosted rooms are presented under the community's name.
           The colour lands in a CSS variable on the hero's chip, so only a
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

        /* The hero features live rooms only, ranked by viewers — its slide
           says "Watch Live", so anything else up there would lie. Colours
           and gradients are keyed to the room's place in the list. */
        const hero: HeroRoom[] = rooms
          .map((room, i) => ({ room, i }))
          .filter(({ room }) => room.status === "live")
          .sort((a, b) => (b.room.viewer_count ?? 0) - (a.room.viewer_count ?? 0))
          .slice(0, 4)
          .map(({ room, i }) => {
            const active = (room.participants ?? []).filter(
              (p: { left_at: string | null }) => !p.left_at
            );
            const debaters = active.filter((p: { role: string }) => p.role === "debater");
            const audienceCount = active.filter((p: { role: string }) => p.role === "spectator").length;
            const proD = debaters.find((p: { stance: string | null }) => p.stance === "PRO");
            const conD = debaters.find((p: { stance: string | null }) => p.stance === "CON");
            const host = room.host as { avatar_url?: string | null } | { avatar_url?: string | null }[] | null;
            const hostAvatar = Array.isArray(host) ? host[0]?.avatar_url : host?.avatar_url;
            // Same fallback as the room cards: uploaded thumbnail, else the host's avatar.
            const pick = room.thumbnail_url || hostAvatar || null;
            return {
              roomId: room.id,
              motion: room.motion,
              // "Open seat" rather than an empty string: the panel shows its initial.
              debater1: proD?.user ? displayName(proD.user) : "Open seat",
              debater2: conD?.user ? displayName(conD.user) : "Open seat",
              color1: PALETTE[i % PALETTE.length],
              color2: PALETTE[(i + 3) % PALETTE.length],
              gradient: GRADIENTS[i % GRADIENTS.length],
              thumbnailUrl: typeof pick === "string" && /^https:\/\//.test(pick) ? pick : null,
              topicKey: TOPIC_MAP[room.topic_key] ?? "culture",
              secondaryTopics: (room.secondary_topics ?? []).map((k: string) => TOPIC_MAP[k] ?? k),
              format: FORMAT_LABEL[room.format] ?? "Open",
              language: (room.language ?? "EN").toUpperCase().slice(0, 2),
              community: room.community_id ? (communityById.get(room.community_id)?.name ?? null) : null,
              communityColor: room.community_id ? (communityById.get(room.community_id)?.color ?? null) : null,
              liveSince: room.started_at ?? room.created_at ?? null,
              speakerCount: debaters.length,
              audienceCount,
              viewersNum: room.viewer_count ?? 0,
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
          user: user ? { id: user.id, name: profileName ?? user.user_metadata?.name ?? user.email ?? "U", username: profileUsername, avatarUrl: profileAvatar } : null,
          stats: {
            activeRooms: rooms.length,
            members: memberCount ?? 0,
            watching: liveRooms.reduce((sum, r) => sum + (r.viewer_count ?? 0), 0),
          },
        };
        writeNavUser(data.user);
        setShellStats(data.stats);
        /* Replaced only when something changed, so the 30s tracker doesn't
           rebuild an unchanged strip. */
        setHeroRooms((prev) => (JSON.stringify(prev) === JSON.stringify(hero) ? prev : hero));
        meIdRef.current = user?.id ?? null;
        dataLandedRef.current = true;
        setDbOffline(false);
        setBooted(true);
      } catch (e) {
        console.error("home data load failed", e);
        // Boot anyway so the page isn't blank.
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
      const { data: auth } = await sessionUser(supabase);
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
          if (data?.username) {
            window.__agoraLeave?.();
            window.location.href = userPath(data.username);
          }
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
     `loadData` can hang well past any reasonable paint. Reveal the shell
     on a short timer regardless; the data flows in when the fetch lands. */
  useEffect(() => {
    const t = setTimeout(() => {
      if (dataLandedRef.current) return;
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

  /* Sidebar navigation: React panels for trending/communities/news;
     home and explore are this page's own state (the shell's home feed
     hides while Explore is up; ExplorePage mounts into #exploreHost). */
  const onSidebarNavigate = useCallback((id: HomeNavId) => {
    if (isPanelTab(id)) {
      setActiveTab(id);
      return;
    }
    if (id === "home") {
      try { sessionStorage.setItem(HOME_CHOSEN_KEY, "1"); } catch { /* private mode */ }
    }
    setActiveTab(null);
    setMvpPage(id);
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
          setActiveTab(null);
          setMvpPage("explore");
          done();
        } else {
          setActiveTab(null);
          if (mvpPage !== "home") setMvpPage("home");
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
    const onCreateCommunity = async () => {
      const { data: auth } = await sessionUser(supabase);
      if (!auth?.user) { window.location.href = "/login"; return; }
      setShowCreate(false);
      setShowCreateCommunity(true);
    };
    window.addEventListener("agora:create-community", onCreateCommunity);
    const onProfile = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string" && detail) {
        // Someone else: their full profile page.
        goToProfileById(detail);
        return;
      }
      // Own profile (nav avatar → Profile): same destination.
      const myId = meIdRef.current ?? readNavUser()?.id;
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
      writeNavUser(null);
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
        if (c === "community") void onCreateCommunity();
        else openCreate({ motion: "", topic: "", schedule: c === "schedule" });
      }
    }
    window.addEventListener("agora:profile", onProfile);
    window.addEventListener("agora:tab", onTab);
    window.addEventListener("agora:logout", onLogout);
    return () => {
      window.removeEventListener("agora:create", onCreate);
      window.removeEventListener("agora:create-community", onCreateCommunity);
      window.removeEventListener("agora:profile", onProfile);
      window.removeEventListener("agora:tab", onTab);
      window.removeEventListener("agora:logout", onLogout);
    };
  }, [supabase, onSidebarNavigate, openCreate, goToProfileById]);

  /* Hero "Queue a discussion": the carousel (HeroCarousel.tsx) raises
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
      const { data: auth } = await sessionUser(supabase);
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
      {!shellReady && (
        <div ref={waitRef} className="ld-page-wait">
          <LoadingScreen />
        </div>
      )}
      {/* The starfield and the navbar are React (phase 1 of retiring the
          shell's scripts); the shell's own search wiring below binds the
          navbar's box, so the navbar leaves search to it. */}
      <Starfield />
      <SiteNavbar
        ownSearch={false}
        onLogo={() => window.dispatchEvent(new CustomEvent("agora:tab", { detail: "home" }))}
      />
      {/* The shell: the SVG filters mvp-home.css refers to (the avatar
          ring's refraction, the glass modal), the shooting stars, the
          keyboard guard, and the main column with the home feed and
          Explore. The hosts are portal targets for the pieces rendered
          below. The search panel floats over whatever was showing; the
          other panels replace the main column. */}
      <svg style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden="true">
        <defs>
          <filter id="avatar-glass-distort" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.65 0.45" numOctaves="3" seed="4" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <svg style={{ display: "none", position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden="true">
        <defs>
          <filter id="liquid-glass-modal" x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.001 0.005" numOctaves="1" seed="17" result="turbulence" />
            <feComponentTransfer in="turbulence" result="mapped">
              <feFuncR type="gamma" amplitude="1" exponent="10" offset="0.5" />
              <feFuncG type="gamma" amplitude="0" exponent="1" offset="0" />
              <feFuncB type="gamma" amplitude="0" exponent="1" offset="0.5" />
            </feComponentTransfer>
            <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap" />
            <feSpecularLighting in="softMap" surfaceScale="5" specularConstant="1" specularExponent="100" lightingColor="white" result="specLight">
              <fePointLight x="-200" y="-200" z="300" />
            </feSpecularLighting>
            <feComposite in="specLight" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="litImage" />
            <feDisplacementMap in="SourceGraphic" in2="softMap" scale="120" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <ShootingStars />
      <KeyboardGuard />
      <main className="main" style={{ display: activeTab && activeTab !== "search" ? "none" : undefined }}>
        <div id="homeFeed" style={{ display: mvpPage === "explore" ? "none" : undefined }}>
          <div id="carouselHost" ref={setCarouselHost} />
          <section id="fieldsSection" ref={setFieldsHost} />
        </div>
        <div id="exploreHost" ref={setExploreHost} />
      </main>
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
      <HeroCarousel container={carouselHost} rooms={heroRooms} />
      <ExplorePage container={exploreHost} open={mvpPage === "explore"} stats={shellStats} />
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
        onClose={() => { setShowCreate(false); setCreateVia((v) => (v === "discussion" ? null : v)); }}
        switchPhase={createLeaving === "discussion" ? "out" : createVia === "discussion" ? "in" : undefined}
        initialMotion={createPrefill?.motion}
        initialTopic={createPrefill?.topic}
        initialSchedule={createPrefill?.schedule}
        communityId={createPrefill?.communityId}
        communityName={createPrefill?.communityName}
        onCreateCommunity={() => switchCreate("community")}
      />
      <CreateCommunityModal
        open={showCreateCommunity}
        onClose={() => { setShowCreateCommunity(false); setCreateVia((v) => (v === "community" ? null : v)); }}
        onCreateDiscussion={() => switchCreate("discussion")}
        switchPhase={createLeaving === "community" ? "out" : createVia === "community" ? "in" : undefined}
        onCreated={(c) => {
          /* Land in the new board: open the Communities tab, then ask it
             to select the board once it has refreshed its list. */
          onSidebarNavigate("communities");
          setTimeout(() => {
            document.dispatchEvent(new CustomEvent("agora:open-community", { detail: { communityId: c.id, refresh: true } }));
          }, 80);
        }}
      />
    </>
  );
}
