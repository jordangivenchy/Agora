"use client";

/* GIPHY search popover for the community composers. Dormant until
   NEXT_PUBLIC_GIPHY_KEY lands in the env (get one free at
   developers.giphy.com) — the trigger button simply doesn't render
   without it, matching the house dormant-behind-env pattern.

   Picking a GIF hands back its GIPHY CDN URL; posts store it in
   image_url like any other attachment, and <img> loops it natively. */

import { useEffect, useRef, useState } from "react";

const GIPHY_KEY = process.env.NEXT_PUBLIC_GIPHY_KEY;

export const giphyEnabled = !!GIPHY_KEY;

type Gif = { id: string; url: string; preview: string; alt: string };

type GiphyHit = {
  id: string;
  title?: string;
  images?: {
    fixed_width?: { url?: string };
    fixed_width_small?: { url?: string };
  };
};

export default function GifPicker({
  onPick, onClose, placement = "below", align = "left",
}: {
  onPick: (url: string) => void;
  onClose: () => void;
  /** Open below (default) or above the anchoring wrapper. */
  placement?: "below" | "above";
  /** Which edge of the wrapper to hug. */
  align?: "left" | "right";
}) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  /* Trending on open, search once the user types (debounced). */
  useEffect(() => {
    if (!GIPHY_KEY) return;
    let dead = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const q = query.trim();
        const endpoint = q
          ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=12&rating=pg-13`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=12&rating=pg-13`;
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error(`GIPHY ${res.status}`);
        const json = await res.json();
        if (dead) return;
        setGifs(
          ((json.data ?? []) as GiphyHit[])
            .map((g) => ({
              id: g.id,
              url: g.images?.fixed_width?.url ?? "",
              preview: g.images?.fixed_width_small?.url ?? g.images?.fixed_width?.url ?? "",
              alt: g.title ?? "GIF",
            }))
            .filter((g) => g.url)
        );
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : "GIF search failed");
      } finally {
        if (!dead) setLoading(false);
      }
    }, query ? 300 : 0);
    return () => { dead = true; clearTimeout(t); };
  }, [query]);

  /* Click-away closes. */
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  if (!GIPHY_KEY) return null;

  return (
    <div
      ref={boxRef}
      className="absolute z-30 overflow-hidden"
      style={{
        [align === "left" ? "left" : "right"]: 0,
        [placement === "below" ? "top" : "bottom"]: "100%",
        [placement === "below" ? "marginTop" : "marginBottom"]: 6,
        width: 320,
        background: "rgba(14,14,17,0.97)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12,
        boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
      }}
    >
      <div className="p-2.5">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIPHY…"
          className="w-full"
          style={{
            background: "rgba(10,10,12,0.8)", border: "0.5px solid rgba(255,255,255,0.1)",
            borderRadius: 9, color: "#eeeef5", fontSize: 12.5, padding: "7px 11px",
            outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          }}
        />
      </div>
      <div
        className="grid gap-1.5 px-2.5 pb-2.5"
        style={{ gridTemplateColumns: "1fr 1fr 1fr", maxHeight: 240, overflowY: "auto" }}
      >
        {loading && gifs.length === 0 && (
          <p className="m-0 text-[11px] col-span-3 text-center py-4" style={{ color: "rgba(238,238,245,0.32)" }}>
            Loading…
          </p>
        )}
        {error && (
          <p className="m-0 text-[11px] col-span-3 text-center py-4" style={{ color: "#e88" }}>{error}</p>
        )}
        {gifs.map((g) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={g.id}
            src={g.preview}
            alt={g.alt}
            className="cursor-pointer rounded-md"
            style={{ width: "100%", height: 70, objectFit: "cover" }}
            onClick={() => { onPick(g.url); onClose(); }}
          />
        ))}
        {!loading && !error && gifs.length === 0 && (
          <p className="m-0 text-[11px] col-span-3 text-center py-4" style={{ color: "rgba(238,238,245,0.32)" }}>
            No GIFs found.
          </p>
        )}
      </div>
      <p className="m-0 px-2.5 pb-2 text-[9px] text-right" style={{ color: "rgba(238,238,245,0.25)" }}>
        Powered by GIPHY
      </p>
    </div>
  );
}
