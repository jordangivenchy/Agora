"use client";

/* In-app story view. Opened from anywhere a headline appears (hero
   carousel, ticker, News tab) via the `agora:story` window event, so
   there is exactly one instance, mounted by the homepage.

   Shows what we legitimately have — photo, headline, outlets, time,
   teaser summary — with Start a discussion as the primary action and
   the outlet's own page as the outbound "full article". Outlets block
   framing and their text isn't ours to republish, so this is the
   whole article experience Agora can honestly offer. */

import { useEffect } from "react";
import useEscapeClose from "@/lib/useEscapeClose";

export interface StorySource { name: string; domain: string }
export interface StoryView {
  id: string;
  headline: string;
  url: string | null;
  publishedAt: string | null;
  sources: StorySource[];
  imageUrl?: string | null;
  summary?: string | null;
  category?: string | null;
}

/** Fire from anywhere: window.dispatchEvent(new CustomEvent("agora:story", { detail: story })). */
export const STORY_EVENT = "agora:story";

export function topicForCategory(category: string | null | undefined): string {
  switch (category) {
    case "politics": return "politics-law";
    case "business": return "economics";
    case "science":
    case "technology": return "science-tech";
    case "sports": return "sports";
    case "entertainment": return "culture";
    default: return "foreign-policy";
  }
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return "";
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

interface Props {
  story: StoryView | null;
  onClose: () => void;
  onStartDebate: (motion: string, topicKey: string) => void;
}

export default function StoryModal({ story, onClose, onStartDebate }: Props) {
  useEscapeClose(!!story, onClose);

  /* Lock page scroll while open. */
  useEffect(() => {
    if (!story) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [story]);

  if (!story) return null;
  const outlet = story.sources[0]?.name;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 1000, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)", fontFamily: "'DM Sans', sans-serif" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={story.headline}
    >
      <div
        className="w-full overflow-hidden flex flex-col"
        style={{
          maxWidth: 760,
          maxHeight: "92vh",
          background: "#0e1018",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 18,
          boxShadow: "0 30px 90px rgba(0,0,0,0.7)",
        }}
      >
        {/* photo */}
        <div style={{ position: "relative", aspectRatio: "16 / 9", background: "linear-gradient(135deg,#0d1b3e,#1e0533)", flexShrink: 0 }}>
          {story.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={story.imageUrl}
              alt=""
              onError={(e) => { e.currentTarget.style.display = "none"; }}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 30%" }}
            />
          )}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(14,16,24,1) 0%, rgba(14,16,24,0.15) 45%, transparent 70%)" }} />
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute cursor-pointer flex items-center justify-center border-none"
            style={{ top: 12, right: 12, width: 34, height: 34, borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 16 }}
          >
            ✕
          </button>
          <div className="absolute left-0 right-0 px-6" style={{ bottom: 14 }}>
            <h2 className="m-0" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 26, lineHeight: 1.2, color: "#fff", textShadow: "0 2px 14px rgba(0,0,0,0.6)" }}>
              {story.headline}
            </h2>
          </div>
        </div>

        {/* body */}
        <div className="px-6 pt-3 pb-5 flex flex-col gap-3 overflow-y-auto">
          <div className="flex items-center gap-2.5 flex-wrap text-[11.5px]" style={{ color: "#8b8b94" }}>
            {story.sources.slice(0, 3).map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5">
                {s.domain && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(s.domain)}&sz=32`} alt="" width={13} height={13} style={{ borderRadius: 3 }} />
                )}
                <span style={{ color: "#c9c9d2", fontWeight: 600 }}>{s.name}</span>
              </span>
            ))}
            {story.publishedAt && <span>· {timeAgo(story.publishedAt)}</span>}
          </div>

          {story.summary ? (
            <p className="m-0" style={{ fontSize: 15.5, lineHeight: 1.6, color: "rgba(238,238,245,0.9)" }}>{story.summary}</p>
          ) : (
            <p className="m-0" style={{ fontSize: 14, color: "#8b8b94" }}>No summary available for this story.</p>
          )}

          <div className="flex items-center gap-2.5 flex-wrap pt-1">
            <button
              onClick={() => { onClose(); onStartDebate(story.headline, topicForCategory(story.category)); }}
              className="cursor-pointer"
              style={{ border: "none", background: "linear-gradient(135deg,#f7e3a0,#d9a238)", color: "#412402", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}
            >
              ✦ Start a discussion
            </button>
            {story.url && (
              <a
                href={story.url}
                target="_blank"
                rel="noopener noreferrer"
                className="no-underline"
                style={{ border: "0.5px solid #3a3a42", color: "#e5e5ec", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600 }}
              >
                Read the full article{outlet ? ` at ${outlet}` : ""} ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
