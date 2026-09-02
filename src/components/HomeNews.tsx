"use client";

/* "In the news" — a short row of headlines to discuss, placed after the
   platform's own content on the home page (portaled into #newsTickerHost
   in the MVP markup). Replaces the hero news slides and the scrolling
   ticker: three surfaces for one feed was two too many.

   No outbound links here — the News tab has those. The one action on the
   home page is to discuss: "Discuss" raises agora:queue-headline, which
   page.tsx owns (queue_for_headline + match polling) and answers with
   agora:hero-queue-state so the button can paint itself. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";

interface Props {
  container: HTMLElement | null;
}

type Source = { name: string; domain: string };
type Story = {
  id: string;
  headline: string;
  url: string | null;
  sources: Source[];
  category?: string | null;
  major?: boolean;
};
type QueueState = { state: "idle" | "busy" | "queued" | "error"; message?: string };

const MAX_STORIES = 4;

export default function HomeNews({ container }: Props) {
  const [stories, setStories] = useState<Story[]>([]);
  const [queue, setQueue] = useState<Record<string, QueueState>>({});

  useEffect(() => {
    let alive = true;
    fetch("/api/news")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        // Sample feeds are invented headlines — render nothing instead.
        const all: Story[] = j.sample ? [] : (j.stories ?? []);
        const majors = all.filter((s) => s.major);
        const rest = all.filter((s) => !s.major);
        setStories([...majors, ...rest].slice(0, MAX_STORIES));
      })
      .catch(() => { /* no feed → render nothing */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onState = (e: Event) => {
      const d = (e as CustomEvent).detail as { headline?: string; state?: QueueState["state"]; message?: string } | undefined;
      if (!d?.headline || !d.state) return;
      setQueue((q) => ({ ...q, [d.headline!]: { state: d.state!, message: d.message } }));
    };
    window.addEventListener("agora:hero-queue-state", onState);
    return () => window.removeEventListener("agora:hero-queue-state", onState);
  }, []);

  if (!container || stories.length === 0) return null;

  const discuss = (s: Story) => {
    if (queue[s.headline]?.state === "busy") return;
    window.dispatchEvent(new CustomEvent("agora:queue-headline", {
      detail: { headline: s.headline, category: s.category ?? "", url: s.url ?? "" },
    }));
  };
  const label = (s: Story) => {
    const q = queue[s.headline];
    if (!q || q.state === "idle") return "Discuss";
    if (q.state === "busy") return "…";
    if (q.state === "queued") return "In queue";
    return q.message ? q.message.slice(0, 40) : "Try again";
  };

  return createPortal(
    <div style={{ fontFamily: "'DM Sans', sans-serif", marginTop: 30 }}>
      <div className="flex items-center gap-3 mb-1">
        <span
          className="text-[11.5px]"
          style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "#9a9aa4", letterSpacing: "0.09em", textTransform: "uppercase" }}
        >
          In the news
        </span>
        <span className="flex-1" style={{ height: 0.5, background: "#26262e" }} />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("agora:tab", { detail: "news" }))}
          className="cursor-pointer text-[11.5px]"
          style={{ background: "transparent", border: "none", color: "#c0c0c8", fontFamily: "inherit", padding: "4px 2px" }}
        >
          All news →
        </button>
      </div>

      <div className="home-news-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", columnGap: 32 }}>
        {stories.map((s) => {
          const q = queue[s.headline];
          const queued = q?.state === "queued";
          const src = s.sources[0];
          return (
            <div
              key={s.id}
              className="flex items-center gap-3.5"
              style={{ padding: "12px 2px", borderBottom: "0.5px solid #26262e" }}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="m-0 text-[13.5px]"
                  style={{
                    color: "#f5f5f0",
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 600,
                    lineHeight: 1.3,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {s.headline}
                </p>
                {src && (
                  <p className="m-0 mt-1 text-[11px] flex items-center gap-1.5" style={{ color: "#8b8b94" }}>
                    {src.domain && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${src.domain}&sz=32`}
                        alt=""
                        width={12}
                        height={12}
                        style={{ borderRadius: 3, opacity: 0.85 }}
                      />
                    )}
                    {src.name}
                    {s.sources.length > 1 && <span>+{s.sources.length - 1}</span>}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => discuss(s)}
                disabled={q?.state === "busy"}
                title={queued ? "Tap to leave the queue" : "Queue a discussion on this story"}
                className="cursor-pointer shrink-0 text-[12px] inline-flex items-center gap-1.5"
                style={{
                  padding: "7px 13px",
                  borderRadius: 999,
                  fontFamily: "inherit",
                  fontWeight: 600,
                  background: queued ? "rgba(255,183,0,0.14)" : "transparent",
                  border: queued ? "0.5px solid rgba(255,183,0,0.5)" : "0.5px solid #3a3a42",
                  color: queued ? "#ffb700" : "#e8e8ee",
                }}
              >
                {queued && <span className="inline-block animate-pulse" style={{ width: 6, height: 6, borderRadius: 999, background: "#ffb700" }} />}
                {!queued && <Icon name="message-circle" size={12} />}
                {label(s)}
              </button>
            </div>
          );
        })}
      </div>
    </div>,
    container
  );
}
