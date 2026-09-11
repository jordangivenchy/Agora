"use client";

/* News ticker — the scrolling headline strip under the hero carousel.
   The stories come from the carousel (HeroCarousel.tsx fetches
   /api/news once and passes on what the hero didn't take); nothing
   renders until there are some. Each headline shows the outlets
   reporting the story.

   Auto-scrolls via rAF on scrollLeft — so it also stays a normal
   scrollable row the user can wheel/drag through; pauses on hover.
   Content is rendered twice for a seamless loop. */

import { useEffect, useRef } from "react";
import { outletIcon } from "@/lib/outlets";

export type TickerStory = {
  id: string;
  headline: string;
  url: string | null;
  sources: { name: string; domain: string }[];
};

export default function NewsTicker({ stories }: { stories: TickerStory[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  /* Auto-scroll. Half the scrollWidth is one full copy of the list;
     wrapping there is invisible because copy two is identical. Speed
     eases toward its target (0 on hover) so pausing decelerates smoothly
     instead of freezing mid-frame. */
  useEffect(() => {
    if (stories.length === 0) return;
    // Reduced motion: the strip holds still; a finger or wheel still moves it.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let speed = 0;
    /* Position is accumulated as a float and written as whole pixels:
       iOS Safari rounds scrollLeft, so `scrollLeft += 0.6` was silently
       dropped every frame and the strip never moved on phones. */
    let pos = scrollRef.current?.scrollLeft ?? 0;
    const step = () => {
      const el = scrollRef.current;
      if (el) {
        // Asymmetric easing: a long ~60px coast into a stop, a quicker
        // ramp back up. (Glide distance ≈ cruise speed / factor.)
        const target = pausedRef.current ? 0 : 0.6;
        speed += (target - speed) * (pausedRef.current ? 0.01 : 0.03);
        // A finger or wheel moved it: pick up from where the user left it.
        if (Math.abs(el.scrollLeft - Math.round(pos)) > 2) pos = el.scrollLeft;
        pos += speed;
        const half = el.scrollWidth / 2;
        if (half > 0 && pos >= half) pos -= half;
        el.scrollLeft = Math.round(pos);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [stories.length]);

  if (stories.length === 0) return null;

  const items = [...stories, ...stories]; // doubled for seamless loop

  return (
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
            onClick={() =>
              s.url
                ? window.open(s.url, "_blank", "noopener,noreferrer")
                : window.dispatchEvent(new CustomEvent("agora:tab", { detail: "news" }))
            }
            title={s.url ? "Read at the source" : "Open the News tab"}
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
                      src={outletIcon(src.domain)}
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
              Read at {s.sources[0]?.name ?? "source"} ↗
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
