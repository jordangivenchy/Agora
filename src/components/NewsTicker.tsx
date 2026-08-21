"use client";

/* News ticker — scrolling headline strip under the hero carousel, fed by
   /api/news (GNews/Particle-backed; hidden entirely until a provider key is set).
   Each headline shows the outlets reporting the story (Particle clusters
   articles per story, so the outlet list comes free).

   Portaled into #newsTickerHost inside the MVP homepage markup, same
   pattern as NotificationsBell/TopicsHome. Auto-scrolls via rAF on
   scrollLeft — so it also stays a normal scrollable row the user can
   wheel/drag through; pauses on hover. Content is rendered twice for a
   seamless loop. */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  container: HTMLElement | null;
}

type Source = { name: string; domain: string };
type Story = { id: string; headline: string; url: string | null; sources: Source[] };

export default function NewsTicker({ container }: Props) {
  const [stories, setStories] = useState<Story[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/news")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        // Sample feeds are invented headlines — render nothing instead.
        // Ticker = everything the hero carousel didn't take (non-major).
        const all: (Story & { major?: boolean })[] = j.sample ? [] : (j.stories ?? []);
        const lesser = all.filter((s) => !s.major);
        setStories(lesser.length ? lesser : all);
      })
      .catch(() => { /* no feed → render nothing */ });
    return () => { alive = false; };
  }, []);

  /* Auto-scroll. Half the scrollWidth is one full copy of the list;
     wrapping there is invisible because copy two is identical. Speed
     eases toward its target (0 on hover) so pausing decelerates smoothly
     instead of freezing mid-frame. */
  useEffect(() => {
    if (stories.length === 0) return;
    let raf = 0;
    let speed = 0;
    const step = () => {
      const el = scrollRef.current;
      if (el) {
        // Asymmetric easing: a long ~60px coast into a stop, a quicker
        // ramp back up. (Glide distance ≈ cruise speed / factor.)
        const target = pausedRef.current ? 0 : 0.6;
        speed += (target - speed) * (pausedRef.current ? 0.01 : 0.03);
        el.scrollLeft += speed;
        const half = el.scrollWidth / 2;
        if (el.scrollLeft >= half) el.scrollLeft -= half;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [stories.length]);

  if (!container || stories.length === 0) return null;

  const items = [...stories, ...stories]; // doubled for seamless loop

  return createPortal(
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginTop: 14,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div
        ref={scrollRef}
        onMouseEnter={() => { pausedRef.current = true; }}
        onMouseLeave={() => { pausedRef.current = false; }}
        className="hide-scrollbar"
        style={{
          display: "flex",
          gap: 10,
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        {items.map((s, i) => (
          <button
            key={`${s.id}-${i}`}
            onClick={() => window.dispatchEvent(new CustomEvent("agora:tab", { detail: "news" }))}
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 14px",
              borderRadius: 100,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 12.5, color: "#d5d5dc" }}>{s.headline}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              {s.sources.slice(0, 3).map((src) => (
                <span
                  key={src.name}
                  title={src.name}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  {src.domain && (
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${src.domain}&sz=32`}
                      alt=""
                      width={13}
                      height={13}
                      style={{ borderRadius: 3, opacity: 0.85 }}
                    />
                  )}
                  <span style={{ fontSize: 10.5, color: "#6b6b74" }}>{src.name}</span>
                </span>
              ))}
              {s.sources.length > 3 && (
                <span style={{ fontSize: 10.5, color: "#6b6b74" }}>+{s.sources.length - 3}</span>
              )}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "#f4d47c", whiteSpace: "nowrap" }}>
              Read article →
            </span>
          </button>
        ))}
      </div>
    </div>,
    container
  );
}
