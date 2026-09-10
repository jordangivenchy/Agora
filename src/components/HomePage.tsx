"use client";

/* The home page: the hero carousel (the busiest live rooms and the
   day's stories) and the daily topics, in the home shell's look
   (mvp-home.css, which arrives with the chrome like everywhere else).
   The route (app/page.tsx) fetches the first view on the server and
   decides the redirects; this keeps it live — realtime changes and a
   30s heartbeat refresh the hero — and owns the hero's queue button.
   The sections are routes of their own; the chrome (app/(chrome)/
   layout.tsx) carries the navbar, the sidebar and the site-wide
   actions and stays put between them. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { writeNavUser } from "@/lib/navUserCache";
import { sessionUser } from "@/lib/session";
import { fetchHeroRooms, fetchNavUser, type HomeInitial } from "@/lib/homeData";
import LoadingScreen from "@/components/LoadingScreen";
import TopicsHome from "@/components/TopicsHome";
import HeroCarousel, { type HeroRoom } from "@/components/HeroCarousel";
import ShootingStars from "@/components/ShootingStars";
import KeyboardGuard from "@/components/KeyboardGuard";
import { requestCreate } from "@/components/GlobalActions";
import { topicFor } from "@/components/NewsPage";

export default function HomePage({ initial }: { initial: HomeInitial }) {
  const [supabase] = useState(() => createClient());
  const [heroRooms, setHeroRooms] = useState<HeroRoom[]>(initial.heroRooms);
  const [carouselHost, setCarouselHost] = useState<HTMLElement | null>(null);
  const [fieldsHost, setFieldsHost] = useState<HTMLElement | null>(null);
  const [dbOffline, setDbOffline] = useState(false);

  /* The navbar's cache starts from what the route knew. */
  useEffect(() => { writeNavUser(initial.navUser); }, [initial.navUser]);

  /* The page's own loading screen on a full load: up until the hero's
     news fetch has settled — so the strip never pops in under a page
     already shown — then a short fade. Capped so a stalled fetch can't
     trap the page. Its sky continues the boot splash's (they share a
     session). */
  /* Only a full load waits: the boot splash is up then, and this keeps
     its sky until the hero has settled. A client-side arrival — a tab
     tap — shows the page at once and lets the strip fill in. */
  const [shellReady, setShellReady] = useState(
    () => typeof document !== "undefined" && !!document.getElementById("ag-boot")?.classList.contains("is-done"),
  );
  const waitRef = useRef<HTMLDivElement>(null);
  const waitDone = useRef(false);
  useEffect(() => {
    if (shellReady) return;
    const finish = () => {
      if (waitDone.current) return;
      waitDone.current = true;
      waitRef.current?.classList.add("is-leaving");
      window.setTimeout(() => setShellReady(true), 420);
    };
    window.addEventListener("agora:hero-settled", finish);
    const cap = window.setTimeout(finish, 7000);
    return () => {
      window.removeEventListener("agora:hero-settled", finish);
      clearTimeout(cap);
    };
  }, [shellReady]);

  /* "/#topics" (the old Topics tab): scroll to the dropdowns once the
     page is up. */
  useEffect(() => {
    if (!shellReady || window.location.hash !== "#topics") return;
    document.getElementById("fieldsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [shellReady]);

  /* Live tracking: realtime changes and a 30s heartbeat refresh the hero
     and the navbar's user with the route's own fetchers. */
  const refresh = useCallback(async () => {
    try {
      const [{ data: auth }, hero] = await Promise.all([sessionUser(supabase), fetchHeroRooms(supabase)]);
      const user = auth?.user;
      const navUser = await fetchNavUser(supabase, user
        ? { id: user.id, name: (user.user_metadata as { name?: string } | undefined)?.name ?? null, email: user.email ?? null }
        : null);
      writeNavUser(navUser);
      /* Replaced only when something changed, so the tracker doesn't
         rebuild an unchanged strip. */
      setHeroRooms((prev) => (JSON.stringify(prev) === JSON.stringify(hero) ? prev : hero));
      setDbOffline(false);
    } catch (e) {
      console.error("home refresh failed", e);
      setDbOffline(true);
    }
  }, [supabase]);
  useEffect(() => {
    const channel = supabase
      .channel("mvp-home-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_rooms" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_participants" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, refresh)
      .subscribe();
    const heartbeat = setInterval(refresh, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(heartbeat);
    };
  }, [refresh, supabase]);

  /* Hero "Queue a discussion": the carousel (HeroCarousel.tsx) raises
     agora:queue-headline; this owns the RPC + the match poll and answers
     with agora:hero-queue-state so the button can paint itself. Same
     queue_for_headline / check_topic_match flow as the News page. */
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
      {/* The SVG filters mvp-home.css refers to (the avatar ring's
          refraction, the glass modal), the shooting stars, the keyboard
          guard, and the main column: the carousel host and the topics
          section are portal targets for the pieces rendered below. */}
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
      {/* The chrome already leaves room for the navbar; .main's own top margin would double it. */}
      <main className="main" style={{ marginTop: 0 }}>
        <div id="homeFeed">
          <div id="carouselHost" ref={setCarouselHost} />
          <section id="fieldsSection" ref={setFieldsHost} />
        </div>
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
          <strong style={{ fontWeight: 600 }}>Database unreachable</strong> — the page shows
          what it last knew. Live discussions, sign-in, and your profile need the Supabase
          project to be running.
        </div>
      )}
      <HeroCarousel container={carouselHost} rooms={heroRooms} />
      <TopicsHome
        container={fieldsHost}
        onCreateLobby={(topic, schedule) => requestCreate({ motion: "", topic, schedule })}
      />
    </>
  );
}
