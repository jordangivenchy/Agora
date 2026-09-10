"use client";

/* The hero carousel, React (phase 3 of retiring the home shell's
   scripts): the busiest live rooms interleaved with the day's major
   news stories, one wide slide each, with the news ticker underneath.
   It portals into the shell's #carouselHost at the top of the home
   feed. The rooms come from the page's data pass (app/page.tsx, live
   rooms ranked by viewers); the stories are fetched here from /api/news
   once per visit, and the shell's loading screen waits for that fetch
   to settle (agora:hero-settled) so the page never reveals itself with
   the hero still to come.

   The strip loops: a clone of the last slide leads and a clone of the
   first trails, so either direction animates one step past the ends
   and snaps back, transition off, once the animation lands. The track
   itself is moved imperatively (a transform on a ref) because a finger
   drags it live on phones; React owns the rest — the slides, the dots,
   the queue buttons' state, images that failed. Autoplay every 9s
   unless the OS asks for reduced motion. On phones a tap on a news
   slide opens the News page with that story lit (?story=); desktop has
   the side panel's buttons instead. "Queue a discussion" raises
   agora:queue-headline for the page, which answers with
   agora:hero-queue-state. */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { navigateTo } from "@/lib/progress";
import { pathFor } from "@/lib/routes";
import { Icon } from "@/components/icons";
import { roomPath } from "@/lib/urls";
import NewsTicker, { type TickerStory } from "./NewsTicker";

/** A live room as the page's data pass shapes it (the shell's keys). */
export type HeroRoom = {
  roomId: string;
  motion: string;
  debater1: string;
  debater2: string;
  color1: string;
  color2: string;
  gradient: string;
  thumbnailUrl: string | null;
  topicKey: string;
  secondaryTopics: string[];
  format: string;
  language: string;
  community: string | null;
  communityColor: string | null;
  liveSince: string | null;
  speakerCount: number;
  audienceCount: number;
  viewersNum: number;
};

type Source = { name: string; domain: string };
type NewsStory = TickerStory & {
  imageUrl?: string | null;
  summary?: string | null;
  category?: string | null;
  major?: boolean;
};

/* An announcement: a post tagged so in the Agora board (lib/homeData.ts). */
export type HeroPost = {
  id: string;
  title: string;
  excerpt: string;
  imageUrl: string | null;
  createdAt: string;
  author: string;
  authorName: string;
  authorAvatar: string | null;
  board: string;
  boardColor: string | null;
  commentCount: number;
};

type Slide =
  | { kind: "room"; key: string; room: HeroRoom }
  | { kind: "post"; key: string; post: HeroPost; gradient: string }
  | { kind: "news"; key: string; story: NewsStory; gradient: string };

type QueueState = { state: string; message?: string };

/* The shell's topic chips: its keys (the page maps the database's
   `ethics` to `politics-ethics`) with its labels and accents. */
const TOPIC_CHIP: Record<string, { label: string; accent: string }> = {
  "politics-law": { label: "Politics (Law)", accent: "#4a9eff" },
  "politics-ethics": { label: "Politics (Ethics)", accent: "#fd79a8" },
  sports: { label: "Sports", accent: "#fd9644" },
  culture: { label: "Culture", accent: "#e056b8" },
  economics: { label: "Economics", accent: "#00b894" },
  "science-tech": { label: "Science & Tech", accent: "#00cec9" },
  "foreign-policy": { label: "Foreign Policy", accent: "#1976D2" },
  philosophy: { label: "Philosophy", accent: "#fdcb6e" },
};

const NEWS_GRADIENTS = [
  "linear-gradient(120deg,#101426 0%,#1c2340 55%,#25172e 100%)",
  "linear-gradient(120deg,#141020 0%,#2a1a33 55%,#12203a 100%)",
  "linear-gradient(120deg,#0e1a2a 0%,#182a45 55%,#2b1f38 100%)",
];
/* The announcement slides lean warm, a shade of the brand yellow in the dark. */
const POST_GRADIENTS = [
  "linear-gradient(120deg,#1a1300 0%,#2a1d00 50%,#101426 100%)",
  "linear-gradient(120deg,#141020 0%,#2a1a00 55%,#1c2340 100%)",
  "linear-gradient(120deg,#0e1a2a 0%,#241a00 55%,#2b1f38 100%)",
];

const chip = (accent: string) => ({ "--chip": accent } as CSSProperties);
const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
const initial = (name: string) => (name || "?").charAt(0).toUpperCase();

/* " now", " for 12m", " for 2h 5m" — after the panel's "Live". */
function liveFor(iso: string | null): string {
  if (!iso) return " now";
  const ms = Date.now() - Date.parse(iso);
  if (!(ms > 0)) return " now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return " now";
  if (m < 60) return ` for ${m}m`;
  const h = Math.floor(m / 60);
  return ` for ${h}h ${m % 60}m`;
}

/* "3m", "5h", "2d" — when a post went up. */
function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!(ms > 0)) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/* A full page load with the loading screen up first (the adapter's
   go(): the sky paints, then the navigation starts). */
function leaveTo(url: string) {
  window.__agoraLeave?.();
  requestAnimationFrame(() => { window.location.href = url; });
}

export default function HeroCarousel({ container, rooms, posts = [] }: {
  container: HTMLElement | null;
  rooms: HeroRoom[];
  /** The announcements (lib/homeData.ts fetchAnnouncements), as slides between the rooms and the stories. */
  posts?: HeroPost[];
}) {
  const router = useRouter();
  const [news, setNews] = useState<NewsStory[]>([]);
  const [ticker, setTicker] = useState<TickerStory[]>([]);
  const [queue, setQueue] = useState<Record<string, QueueState>>({});
  const [broken, setBroken] = useState<Record<string, true>>({});
  const [phone, setPhone] = useState(false);
  const [cur, setCur] = useState(0);
  const [, setTick] = useState(0);

  /* The stories, once. Sample feeds are invented headlines — never in
     the hero. The major ones (ranked server-side) take the slides and
     the ticker gets the rest. Settled either way, so the shell's
     loading screen can come down. */
  useEffect(() => {
    let alive = true;
    fetch("/api/news")
      .then((r) => r.json())
      .then((j) => {
        if (!alive || j.sample) return;
        const all: NewsStory[] = j.stories ?? [];
        const majors = all.filter((s) => s.major);
        setNews((majors.length ? majors : all).slice(0, 3));
        const lesser = all.filter((s) => !s.major);
        setTicker(lesser.length ? lesser : all);
      })
      .catch(() => { /* no feed: the strip stays rooms-only */ })
      .finally(() => { window.dispatchEvent(new Event("agora:hero-settled")); });
    return () => { alive = false; };
  }, []);

  /* The rooms' "Live for …" kickers keep time between data passes. */
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  /* The page answers a queue request with the button's state. */
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { headline?: string; state?: string; message?: string } | undefined;
      if (!d?.headline) return;
      const headline = d.headline;
      setQueue((q) => ({ ...q, [headline]: { state: d.state ?? "idle", message: d.message } }));
    };
    window.addEventListener("agora:hero-queue-state", on);
    return () => window.removeEventListener("agora:hero-queue-state", on);
  }, []);

  /* Rooms, announcements and stories take turns: room, post, story… */
  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    const n = Math.max(rooms.length, posts.length, news.length);
    for (let i = 0; i < n; i++) {
      if (rooms[i]) out.push({ kind: "room", key: `r:${rooms[i].roomId}`, room: rooms[i] });
      if (posts[i]) out.push({ kind: "post", key: `p:${posts[i].id}`, post: posts[i], gradient: POST_GRADIENTS[i % POST_GRADIENTS.length] });
      if (news[i]) out.push({ kind: "news", key: `n:${news[i].id}`, story: news[i], gradient: NEWS_GRADIENTS[i % NEWS_GRADIENTS.length] });
    }
    return out;
  }, [rooms, posts, news]);
  const N = slides.length;
  const nRef = useRef(N);
  useLayoutEffect(() => { nRef.current = N; }, [N]);

  /* ── The track ── */
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const curRef = useRef(0);
  const snapPending = useRef(false);
  const snapTimer = useRef(0);
  const autoTimer = useRef(0);
  const swipedAt = useRef(0);

  /* units: slide widths from the strip's start (the lead clone is 0). */
  const place = useCallback((units: number, animate: boolean) => {
    const tr = trackRef.current;
    if (!tr) return;
    if (!animate) tr.style.transition = "none";
    tr.style.transform = `translateX(-${units * 100}%)`;
    if (!animate) { void tr.offsetWidth; tr.style.transition = ""; }
  }, []);

  /* Parked on a clone: over to the real slide it duplicates, unseen. */
  const snap = useCallback(() => {
    window.clearTimeout(snapTimer.current);
    place(curRef.current + 1, false);
    snapPending.current = false;
  }, [place]);

  const goTo = useCallback((index: number) => {
    const n = nRef.current;
    if (!trackRef.current || !n) return;
    if (n === 1) { curRef.current = 0; setCur(0); return; }
    // Still parked on a clone from the previous wrap? Home first, so
    // this step animates one slide, not back across the whole strip.
    if (snapPending.current) snap();
    // One step past either end is a clone; further than that is clamped.
    if (index > n) index = n;
    if (index < -1) index = -1;
    place(index + 1, true);
    curRef.current = (index + n) % n;
    setCur(curRef.current);
    if (index === n || index === -1) {
      snapPending.current = true;
      snapTimer.current = window.setTimeout(snap, 520); // just past the 0.5s transition
    }
  }, [place, snap]);

  const stopAuto = useCallback(() => { window.clearInterval(autoTimer.current); autoTimer.current = 0; }, []);
  const startAuto = useCallback(() => {
    stopAuto();
    if (nRef.current < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // the reader moves the strip
    autoTimer.current = window.setInterval(() => goTo(curRef.current + 1), 9000); // long enough to read a summary
  }, [goTo, stopAuto]);
  useEffect(() => { startAuto(); return stopAuto; }, [N, startAuto, stopAuto]);

  /* A new set of slides, or the strip's first appearance (the host
     arrives after the slides do, when they came with the page): land on
     the current one without animating, offset one for the lead clone. */
  useLayoutEffect(() => {
    window.clearTimeout(snapTimer.current);
    snapPending.current = false;
    curRef.current = Math.min(curRef.current, Math.max(0, N - 1));
    setCur(curRef.current);
    place(N > 1 ? curRef.current + 1 : 0, false);
  }, [slides, N, place, container]);

  /* Long outlet names ("The Washington Post") shrink the "Read at"
     label until it fits its pill on one line, instead of an ellipsis. */
  useLayoutEffect(() => {
    const tr = trackRef.current;
    if (!tr) return;
    tr.querySelectorAll<HTMLElement>(".carousel-news-btn").forEach((btn) => {
      btn.style.fontSize = "";
      let size = 13;
      while (size > 10 && btn.scrollWidth > btn.clientWidth) {
        size -= 0.5;
        btn.style.fontSize = `${size}px`;
      }
    });
  }, [slides]);

  /* ── Phones: the strip follows the finger (the arrows are hidden
     there, mvp-home.css). A touch that turns out to be sideways drags
     the track live; letting go past a quarter of the width, or with a
     flick, steps a slide, otherwise it settles back — through the same
     goTo the arrows use. The moment is noted so a news slide's
     tap-to-open ignores the tap that ends a drag. touch-action: pan-y
     on the stage leaves vertical scrolling to the browser. ── */
  const drag = useRef({ x0: 0, y0: 0, dx: 0, vx: 0, lastX: 0, lastT: 0, basePx: 0, intent: null as null | "x" | "y", active: false });
  const settle = useCallback(() => {
    const d = drag.current;
    d.active = false;
    const tr = trackRef.current, stage = stageRef.current;
    if (!tr || !stage) return;
    tr.style.transition = "";
    if (d.intent !== "x") { startAuto(); return; }
    if (Math.abs(d.dx) > 8) swipedAt.current = Date.now();
    const w = stage.clientWidth || 1;
    const flick = Math.abs(d.vx) > 0.5 && Math.abs(d.dx) > 24 && Math.sign(d.vx) === Math.sign(d.dx); // px per ms
    if (Math.abs(d.dx) > w * 0.25 || flick) goTo(curRef.current + (d.dx < 0 ? 1 : -1));
    else goTo(curRef.current); // eases back to where it was
    startAuto();
  }, [goTo, startAuto]);
  const onTouchStart = (e: ReactTouchEvent) => {
    const d = drag.current;
    if (d.active) settle(); // a second finger landed mid-drag
    const stage = stageRef.current;
    if (!trackRef.current || !stage || e.touches.length !== 1 || nRef.current < 2) return;
    if (snapPending.current) snap();
    const t = e.touches[0];
    d.x0 = d.lastX = t.clientX; d.y0 = t.clientY; d.lastT = Date.now();
    d.dx = 0; d.vx = 0;
    d.basePx = -(curRef.current + 1) * stage.clientWidth;
    d.intent = null; d.active = true;
    stopAuto();
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    const d = drag.current;
    if (!d.active) return;
    const tr = trackRef.current, stage = stageRef.current;
    if (!tr || !stage) return;
    const t = e.touches[0];
    const x = t.clientX, y = t.clientY, now = Date.now();
    const mx = x - d.x0, my = y - d.y0;
    if (d.intent === null) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      d.intent = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      if (d.intent === "x") tr.style.transition = "none";
    }
    if (d.intent !== "x") return;
    const w = stage.clientWidth || 1;
    d.dx = Math.max(-w, Math.min(w, mx)); // the clones cover one width either side
    const dt = now - d.lastT;
    if (dt > 0) d.vx = d.vx * 0.6 + ((x - d.lastX) / dt) * 0.4; // recent motion, lightly smoothed
    d.lastX = x; d.lastT = now;
    tr.style.transform = `translateX(${d.basePx + d.dx}px)`;
  };
  const onTouchEnd = () => { if (drag.current.active) settle(); };

  const markBroken = (key: string) => setBroken((b) => (b[key] ? b : { ...b, [key]: true }));

  /* Phones: a tap anywhere on a news slide, off its controls, opens the
     News page with that story scrolled to and lit (NewsPage reads ?story=). */
  const tapOpen = (id: string) => (e: ReactMouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("button, a")) return;
    if (Date.now() - swipedAt.current < 500) return; // the tap that ended a swipe
    leaveTo(id ? `/news?story=${encodeURIComponent(id)}` : "/news");
  };
  /* A post opens in place — the boards page lives under the chrome. */
  const openPost = (id: string) => navigateTo(router, pathFor.post(id));
  const tapPost = (id: string) => (e: ReactMouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("button, a")) return;
    if (Date.now() - swipedAt.current < 500) return;
    openPost(id);
  };

  if (!container) return null;

  const strip: { slide: Slide; i: number; clone?: string }[] = N > 1
    ? [
        { slide: slides[N - 1], i: N - 1, clone: "lead" },
        ...slides.map((slide, i) => ({ slide, i })),
        { slide: slides[0], i: 0, clone: "trail" },
      ]
    : slides.map((slide, i) => ({ slide, i }));

  const renderSlide = ({ slide, i, clone }: { slide: Slide; i: number; clone?: string }) => {
    const key = `${clone ?? "s"}:${slide.key}`;
    if (slide.kind === "room") {
      const c = slide.room;
      return (
        <RoomSlide
          key={key}
          room={c}
          i={i}
          total={N}
          thumb={c.thumbnailUrl && !broken[`thumb:${c.roomId}`] ? c.thumbnailUrl : null}
          onThumbBroken={() => markBroken(`thumb:${c.roomId}`)}
          onWatch={() => leaveTo(roomPath({ id: c.roomId, motion: c.motion }))}
        />
      );
    }
    if (slide.kind === "post") {
      const p = slide.post;
      return (
        <PostSlide
          key={key}
          post={p}
          gradient={slide.gradient}
          i={i}
          total={N}
          phone={phone}
          image={p.imageUrl && !broken[`post:${p.id}`] ? p.imageUrl : null}
          onImageBroken={() => markBroken(`post:${p.id}`)}
          onOpen={() => openPost(p.id)}
          onTap={tapPost(p.id)}
        />
      );
    }
    const s = slide.story;
    return (
      <NewsSlide
        key={key}
        story={s}
        gradient={slide.gradient}
        i={i}
        total={N}
        phone={phone}
        queue={queue[s.headline]}
        image={s.imageUrl && !broken[`img:${s.id}`] ? s.imageUrl : null}
        onImageBroken={() => markBroken(`img:${s.id}`)}
        onTap={tapOpen(s.id)}
      />
    );
  };

  return createPortal(
    <section className="carousel-section" style={N ? undefined : { display: "none" }}>
      <div
        className="carousel-stage"
        id="carouselStage"
        ref={stageRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div className="carousel-track" id="carouselTrack" ref={trackRef}>
          {strip.map(renderSlide)}
        </div>
        <button type="button" className="carousel-arrow left" id="arrowLeft" aria-label="Previous" onClick={() => { goTo(curRef.current - 1); startAuto(); }}>
          <Icon name="chevron-left" size={26} strokeWidth={1.5} />
        </button>
        <button type="button" className="carousel-arrow right" id="arrowRight" aria-label="Next" onClick={() => { goTo(curRef.current + 1); startAuto(); }}>
          <Icon name="chevron-right" size={26} strokeWidth={1.5} />
        </button>
      </div>
      <div className="carousel-dots" id="carouselDots">
        {slides.map((s, i) => (
          <div
            key={s.key}
            className={`carousel-dot${i === cur ? " active" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => { goTo(i); startAuto(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goTo(i); startAuto(); } }}
          />
        ))}
      </div>
      <NewsTicker stories={ticker} />
    </section>,
    container,
  );
}

/* A live room: its thumbnail (else its gradient) under the motion, and
   the side panel with the matchup and the room's facts. A thumbnail
   that fails to load gives the slide back to the gradient. */
function RoomSlide({ room: c, i, total, thumb, onThumbBroken, onWatch }: {
  room: HeroRoom;
  i: number;
  total: number;
  thumb: string | null;
  onThumbBroken: () => void;
  onWatch: () => void;
}) {
  const topic = TOPIC_CHIP[c.topicKey];
  return (
    <div className={`carousel-item${thumb ? " has-thumb" : ""}`} role="group" aria-label={`Slide ${i + 1} of ${total}`}>
      <div className="carousel-bg" style={{ background: c.gradient }}>
        {thumb && <img className="carousel-room-backdrop" src={thumb} alt="" aria-hidden="true" onError={onThumbBroken} />}
      </div>
      <div className="carousel-bg-grid" />
      {thumb && <img className="carousel-room-thumb" src={thumb} alt="" onError={onThumbBroken} />}
      <div className="carousel-live-badge"><div className="carousel-live-dot" /> Live</div>
      <div className="carousel-lower-third">
        <div className="carousel-motion">{`"${c.motion}"`}</div>
      </div>
      <div className="carousel-panel carousel-room-panel">
        <div className="room-panel-kicker"><span className="room-panel-livedot" />Live{liveFor(c.liveSince)}</div>
        <div className="room-panel-watching">
          {c.speakerCount || 0} speaker{c.speakerCount === 1 ? "" : "s"} · {c.audienceCount || 0} in the audience
        </div>
        <div className="room-panel-facts">
          <span className="room-panel-chip" style={chip(topic?.accent ?? "#4a9eff")}>{topic?.label ?? "Discussion"}</span>
          {c.secondaryTopics.slice(0, 2).map((k) => TOPIC_CHIP[k] ? (
            <span key={k} className="room-panel-chip" style={chip(TOPIC_CHIP[k].accent)}>{TOPIC_CHIP[k].label}</span>
          ) : null)}
          <span className="room-panel-chip">{c.format || "Open"}</span>
          {c.language && <span className="room-panel-chip">{c.language}</span>}
        </div>
        <div className="room-panel-label">Speakers</div>
        <div className="room-panel-speakers">
          <div className="room-panel-speaker">
            <div className="panel-avatar small" style={{ background: c.color1 }}>{initial(c.debater1)}</div>
            <div className="room-panel-speaker-name">{c.debater1}</div>
          </div>
          {c.debater2 && c.debater2 !== "Open seat" && (
            <div className="room-panel-speaker">
              <div className="panel-avatar small" style={{ background: c.color2 || "#4a9eff" }}>{initial(c.debater2)}</div>
              <div className="room-panel-speaker-name">{c.debater2}</div>
            </div>
          )}
        </div>
        {c.community && (
          <div className="room-panel-host">
            hosted by <span className="room-panel-community" style={chip(c.communityColor || "#4a9eff")}>{c.community}</span>
          </div>
        )}
        <button type="button" className="carousel-watch-btn room-panel-watch" onClick={(e) => { e.stopPropagation(); onWatch(); }}>
          <Icon name="play" size={11} style={{ fill: "currentColor" }} /> Watch Live
        </button>
      </div>
    </div>
  );
}

/* An announcement, in the news slide's frame: the title over the
   post's image (else a warm gradient) with an "Announcement" badge, the
   board, the author and the comment count as chips; the right column
   has the author, an excerpt and "Read the post". */
function PostSlide({ post: p, gradient, i, total, phone, image, onImageBroken, onOpen, onTap }: {
  post: HeroPost;
  gradient: string;
  i: number;
  total: number;
  phone: boolean;
  image: string | null;
  onImageBroken: () => void;
  onOpen: () => void;
  onTap: (e: ReactMouseEvent) => void;
}) {
  return (
    <div
      className="carousel-item news post"
      role="group"
      aria-label={`Slide ${i + 1} of ${total}`}
      style={phone ? { cursor: "pointer" } : undefined}
      onClick={phone ? onTap : undefined}
    >
      <div className="carousel-bg" style={{ background: gradient }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img className="carousel-news-img" src={image} alt="" loading="eager" decoding="async" onError={onImageBroken} />}
      </div>
      <div className="carousel-news-shade" />
      <div className="carousel-post-badge">Announcement</div>
      <div className="carousel-lower-third">
        <div className="carousel-motion">{p.title}</div>
        {/* Phones have no right column: a couple of lines of the post under the title. */}
        {p.excerpt && <div className="carousel-post-excerpt">{p.excerpt}</div>}
        <div className="carousel-news-chips">
          <span className="carousel-news-chip carousel-post-board" style={chip(p.boardColor || "#4a9eff")}>{p.board}</span>
          <span className="carousel-news-chip">@{p.author}</span>
          <span className="carousel-news-chip">{p.commentCount} comment{p.commentCount === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="carousel-panel carousel-news-card">
        <div className="carousel-post-author">
          {p.authorAvatar
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className="carousel-post-avatar" src={p.authorAvatar} alt="" />
            : <div className="panel-avatar small carousel-post-avatar" style={{ background: "#ffb700", color: "#1a0e00" }}>{initial(p.authorName)}</div>}
          <div className="carousel-post-who">
            <div className="carousel-post-name">{p.authorName}</div>
            <div className="carousel-post-when">@{p.author} · {ago(p.createdAt)}</div>
          </div>
        </div>
        {p.excerpt && <p className="carousel-news-summary">{p.excerpt}</p>}
        <button type="button" className="carousel-watch-btn carousel-queue-btn" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          Read the post
        </button>
      </div>
    </div>
  );
}

/* A news story: headline over its image and the outlets reporting it;
   the side panel lists the coverage, the summary, "Read at" and the
   queue button. */
function NewsSlide({ story: c, gradient, i, total, phone, queue, image, onImageBroken, onTap }: {
  story: NewsStory;
  gradient: string;
  i: number;
  total: number;
  phone: boolean;
  queue: QueueState | undefined;
  image: string | null;
  onImageBroken: () => void;
  onTap: (e: ReactMouseEvent) => void;
}) {
  const sources: Source[] = c.sources ?? [];
  const hasUrl = !!(c.url && /^https:\/\//.test(c.url));
  const state = queue?.state;
  const queueLabel =
    state === "busy" ? "…"
    : state === "queued" ? "In queue — tap to leave"
    : state === "error" ? (queue?.message || "Couldn’t queue — try again")
    : "Queue a discussion";
  return (
    <div
      className="carousel-item news"
      role="group"
      aria-label={`Slide ${i + 1} of ${total}`}
      data-story={c.id || ""}
      style={phone ? { cursor: "pointer" } : undefined}
      onClick={phone ? onTap : undefined}
    >
      <div className="carousel-bg" style={{ background: gradient }}>
        {image && <img className="carousel-news-img" src={image} alt="" loading="eager" decoding="async" onError={onImageBroken} />}
      </div>
      <div className="carousel-news-shade" />
      <div className="carousel-lower-third">
        <div className="carousel-motion">{c.headline}</div>
        <div className="carousel-news-chips">
          {sources.slice(0, 4).map((s) => (
            <span key={s.name} className="carousel-news-chip">
              {s.domain && <img src={favicon(s.domain)} alt="" width={13} height={13} />}
              {" "}{s.name}
            </span>
          ))}
        </div>
      </div>
      <div className="carousel-panel carousel-news-card">
        <div className="carousel-news-byline">
          <span className="panel-name">Reported by</span>
          <div className="panel-outlets">
            {sources.slice(0, 5).map((s) => (
              <div key={s.name} className="panel-outlet-row">
                {s.domain && <img src={favicon(s.domain)} alt="" width={14} height={14} />}
                {" "}<span>{s.name}</span>
              </div>
            ))}
          </div>
        </div>
        {c.summary && <p className="carousel-news-summary">{c.summary}</p>}
        {hasUrl && (
          <button
            type="button"
            className="carousel-watch-btn carousel-news-btn"
            onClick={(e) => { e.stopPropagation(); window.open(c.url!, "_blank", "noopener,noreferrer"); }}
          >
            Read at {sources[0]?.name || "source"} ↗
          </button>
        )}
        <button
          type="button"
          className={`carousel-watch-btn carousel-queue-btn${state === "queued" ? " queued" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            if (state === "busy") return;
            window.dispatchEvent(new CustomEvent("agora:queue-headline", {
              detail: { headline: c.headline, category: c.category || "", url: c.url || "" },
            }));
          }}
        >
          {queueLabel}
        </button>
      </div>
    </div>
  );
}
