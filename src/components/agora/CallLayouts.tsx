"use client";

/* Zoom-style call layouts for the amphitheater — a viewer-side choice,
   nothing on the wire changes. Two flat 2D layouts that overlay the 3D
   scene (which keeps running, dimmed, behind them):

   - Gallery: an equal-tile grid of every live picture in the room,
     paginated at 9 per page. Active speakers are pulled to page one, but
     lazily — a tile only migrates after its owner has been speaking off
     the current page for 3s, so the grid doesn't reshuffle on every
     volume flicker.
   - Multi-speaker: up to three featured tiles (a live screen share
     always takes the first slot; a viewer pin takes the next) over a
     horizontal filmstrip of everyone else. Featured slots follow recent
     speakers with hysteresis: a new speaker enters immediately, an old
     one leaves only after 8s of silence AND someone else needing the
     slot — so two people trading sentences don't make the big tiles
     thrash.

   Video elements are cached per track (WeakMap) and *moved* between
   layouts rather than recreated, so switching gallery ↔ multi ↔ stage
   never restarts a <video>. The mock plumbing (colored fill instead of a
   track) exists only for the dev scratch page. */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "livekit-client";
import { Icon } from "@/components/icons";

export interface LayoutTile {
  /** Stable key — identity:local:source, same recipe as tileKey(). */
  key: string;
  identity: string;
  username: string;
  handle?: string;
  local: boolean;
  source: "camera" | "screen";
  track?: Track | null;
  micMuted?: boolean;
  /** Scratch-page stand-in: a CSS color painted where video would go. */
  mock?: string;
}

/* ── Track → <video> element cache ─────────────────────────────────────
   attach() creates a fresh element every call; recreating one mid-switch
   means a black flash while the decoder respins. One element per track,
   reparented into whichever tile currently shows it. */
const videoElCache = new WeakMap<Track, HTMLVideoElement>();

function acquireVideoEl(track: Track): HTMLVideoElement {
  let el = videoElCache.get(track);
  if (!el || !el.isConnected) {
    /* `!isConnected` also covers the case where the call layer detached
       every element on unsubscribe — that invalidates the cache entry. */
    if (el) track.detach(el);
    el = track.attach() as HTMLVideoElement;
    el.muted = true; // audio is the call layer's job, not the picture's
    el.playsInline = true;
    videoElCache.set(track, el);
  }
  return el;
}

/** One video surface. Accepts a real LiveKit track or a mock color (dev
    scratch page only). Memoized so parent re-renders (speaking sets
    change constantly) never touch the DOM under a live picture. */
export const TileVideo = memo(function TileVideo({
  track,
  mirror,
  screen,
  mock,
}: {
  track?: Track | null;
  /** Mirror the picture (the local camera, never a screen). */
  mirror?: boolean;
  screen?: boolean;
  mock?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !track) return;
    const el = acquireVideoEl(track);
    el.style.objectFit = screen ? "contain" : "cover";
    el.style.transform = mirror && !screen ? "scaleX(-1)" : "";
    host.appendChild(el);
    return () => {
      /* Remove from this host but keep the track attached — the element
         survives in the cache so the next layout resumes instantly. */
      if (el.parentNode === host) host.removeChild(el);
    };
  }, [track, screen, mirror]);

  if (!track && mock) {
    return <div className="ag-lt-video ag-lt-mock" style={{ background: mock }} />;
  }
  return <div ref={hostRef} className="ag-lt-video" />;
});

/* ── One tile: picture + chrome (name tag, mute badge, speaking ring,
      pin affordance). Shared by grid, featured row, and filmstrip. ── */
const CallTile = memo(function CallTile({
  tile,
  speaking,
  small,
  pinned,
  onPin,
}: {
  tile: LayoutTile;
  speaking: boolean;
  small?: boolean;
  pinned?: boolean;
  onPin?: (key: string | null) => void;
}) {
  const handlePin = onPin
    ? () => onPin(pinned ? null : tile.key)
    : undefined;
  return (
    <div
      className={`ag-lt${small ? " ag-lt--small" : ""}${speaking ? " ag-lt--speaking" : ""}${
        tile.source === "screen" ? " ag-lt--screen" : ""
      }`}
      onDoubleClick={handlePin}
      title={tile.source === "screen" ? `${tile.username} — screen` : tile.username}
    >
      <TileVideo
        track={tile.track}
        mock={tile.mock}
        screen={tile.source === "screen"}
        mirror={tile.local}
      />
      <span className="ag-lt-tag">
        {tile.source === "screen" && (
          <span className="ag-lt-tag-ico"><Icon name="monitor" size={12} /></span>
        )}
        <span className="ag-lt-tag-name">{tile.username}</span>
        {tile.source === "camera" && tile.micMuted && (
          <span className="ag-lt-muted" title="Muted"><Icon name="mic-off" size={12} /></span>
        )}
      </span>
      {handlePin && (
        <button
          className={`ag-lt-pin${pinned ? " is-pinned" : ""}`}
          title={pinned ? "Unpin" : "Pin to the featured view"}
          aria-label={pinned ? `Unpin ${tile.username}` : `Pin ${tile.username}`}
          onClick={(e) => {
            e.stopPropagation();
            handlePin();
          }}
        >
          <Icon name={pinned ? "pin-off" : "pin"} size={13} />
        </button>
      )}
    </div>
  );
});

function EmptyState() {
  return (
    <div className="ag-lt-empty">
      <Icon name="video-off" size={28} />
      <span>No cameras are live</span>
    </div>
  );
}

/* Shared: remember arrival order so sorts are stable across renders. */
function useJoinOrder(tiles: LayoutTile[]) {
  const orderRef = useRef<Map<string, number>>(new Map());
  const seqRef = useRef(0);
  for (const t of tiles) {
    if (!orderRef.current.has(t.key)) orderRef.current.set(t.key, seqRef.current++);
  }
  return useCallback((k: string) => orderRef.current.get(k) ?? Number.MAX_SAFE_INTEGER, []);
}

/* ── Gallery ─────────────────────────────────────────────────────────── */

const PAGE_SIZE = 9;
const PROMOTE_AFTER_MS = 3000;

export function CallGallery({
  tiles,
  speaking,
  onPin,
}: {
  tiles: LayoutTile[];
  speaking: ReadonlySet<string>;
  /** Pin a tile — the page responds by switching to multi, featured. */
  onPin?: (key: string) => void;
}) {
  const joinIndex = useJoinOrder(tiles);
  const [page, setPage] = useState(0);
  /* Keys promoted to the front of the ordering (most recent first). Only
     ever mutated by the 3s promotion timer, so the grid holds still. */
  const [promoted, setPromoted] = useState<string[]>([]);
  const offPageSinceRef = useRef<Map<string, number>>(new Map());

  const ordered = useMemo(() => {
    const rank = (t: LayoutTile) => {
      if (t.source === "screen") return -1_000_000 + joinIndex(t.key);
      const p = promoted.indexOf(t.key);
      if (p >= 0) return -1000 + p;
      return joinIndex(t.key);
    };
    return [...tiles].sort((a, b) => rank(a) - rank(b));
  }, [tiles, promoted, joinIndex]);

  const pageCount = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const pageTiles = ordered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  /* Promotion timer: a speaker parked off the *current* page for longer
     than 3s gets pulled to the front (which lands them on page 1). One
     interval, not per-speaker timeouts — cheap and drift-proof. */
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;
  const pageRef = useRef(safePage);
  pageRef.current = safePage;

  useEffect(() => {
    if (tiles.length <= PAGE_SIZE) {
      offPageSinceRef.current.clear();
      return; // one page — nothing to promote, nothing ever jumps
    }
    const t = setInterval(() => {
      const now = Date.now();
      const cur = orderedRef.current;
      const start = pageRef.current * PAGE_SIZE;
      const visible = new Set(cur.slice(start, start + PAGE_SIZE).map((x) => x.key));
      const since = offPageSinceRef.current;
      const due: string[] = [];
      for (const tile of cur) {
        const isSpeaking = tile.source === "camera" && speakingRef.current.has(tile.identity);
        if (!isSpeaking || visible.has(tile.key)) {
          since.delete(tile.key);
          continue;
        }
        const t0 = since.get(tile.key);
        if (t0 === undefined) since.set(tile.key, now);
        else if (now - t0 >= PROMOTE_AFTER_MS) due.push(tile.key);
      }
      if (due.length > 0) {
        due.forEach((k) => since.delete(k));
        setPromoted((prev) => [...due, ...prev.filter((k) => !due.includes(k))].slice(0, PAGE_SIZE));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [tiles.length]);

  if (tiles.length === 0) return <EmptyState />;

  const n = pageTiles.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);

  return (
    <div className="ag-lgal">
      <div
        className="ag-lgal-grid"
        style={{ "--cols": cols, "--rows": rows } as React.CSSProperties}
      >
        {pageTiles.map((t) => (
          <CallTile
            key={t.key}
            tile={t}
            speaking={t.source === "camera" && speaking.has(t.identity)}
            onPin={onPin ? () => onPin(t.key) : undefined}
          />
        ))}
      </div>
      {pageCount > 1 && (
        <div className="ag-lgal-pager">
          <button
            className="ag-lgal-arrow"
            aria-label="Previous page"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <Icon name="chevron-left" size={15} />
          </button>
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              className={`ag-lgal-dot${i === safePage ? " is-active" : ""}`}
              aria-label={`Page ${i + 1}`}
              onClick={() => setPage(i)}
            />
          ))}
          <button
            className="ag-lgal-arrow"
            aria-label="Next page"
            disabled={safePage === pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            <Icon name="chevron-right" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Multi-speaker ───────────────────────────────────────────────────── */

const SILENCE_EVICT_MS = 8000;
const FEATURED_MAX = 3;

export function CallMultiSpeaker({
  tiles,
  speaking,
  pinnedKey,
  onPin,
}: {
  tiles: LayoutTile[];
  speaking: ReadonlySet<string>;
  pinnedKey?: string | null;
  onPin?: (key: string | null) => void;
}) {
  const joinIndex = useJoinOrder(tiles);
  /* Featured camera identities, most-recently-promoted last. State so a
     change re-renders; refs carry the timing book-keeping. */
  const [featured, setFeatured] = useState<string[]>([]);
  const lastSpokeRef = useRef<Map<string, number>>(new Map());

  const screens = useMemo(
    () => tiles.filter((t) => t.source === "screen").sort((a, b) => joinIndex(a.key) - joinIndex(b.key)),
    [tiles, joinIndex]
  );
  const cameras = useMemo(
    () => tiles.filter((t) => t.source === "camera").sort((a, b) => joinIndex(a.key) - joinIndex(b.key)),
    [tiles, joinIndex]
  );
  const pinnedTile = pinnedKey ? tiles.find((t) => t.key === pinnedKey) ?? null : null;

  /* Slots not taken by the share or the pin belong to recent speakers. */
  const reserved =
    (screens.length > 0 ? 1 : 0) +
    (pinnedTile && pinnedTile.source !== "screen" ? 1 : 0);
  const speakerSlots = Math.max(0, FEATURED_MAX - reserved);

  useEffect(() => {
    const now = Date.now();
    for (const id of speaking) lastSpokeRef.current.set(id, now);

    setFeatured((prev) => {
      const alive = new Set(cameras.map((c) => c.identity));
      const pinnedId = pinnedTile && pinnedTile.source === "camera" ? pinnedTile.identity : null;
      /* Drop the departed and the pinned (the pin has its own slot). */
      let next = prev.filter((id) => alive.has(id) && id !== pinnedId);
      /* A new speaker enters immediately… */
      for (const cam of cameras) {
        if (next.length >= speakerSlots) break;
        if (speaking.has(cam.identity) && !next.includes(cam.identity) && cam.identity !== pinnedId) {
          next = [...next, cam.identity];
        }
      }
      /* …and over capacity, only someone silent for 8s+ gives up a seat
         (and only because the newcomer needs it — that's the AND). */
      for (const cam of cameras) {
        if (cam.identity === pinnedId) continue;
        if (!speaking.has(cam.identity) || next.includes(cam.identity)) continue;
        if (next.length < speakerSlots) {
          next = [...next, cam.identity];
          continue;
        }
        let evict = -1;
        let oldest = Infinity;
        next.forEach((id, i) => {
          if (speaking.has(id)) return;
          const last = lastSpokeRef.current.get(id) ?? 0;
          if (now - last >= SILENCE_EVICT_MS && last < oldest) {
            oldest = last;
            evict = i;
          }
        });
        if (evict >= 0) {
          next = [...next.slice(0, evict), ...next.slice(evict + 1), cam.identity];
        }
      }
      /* Seed / backfill: quiet rooms still deserve big pictures. */
      if (next.length < speakerSlots) {
        for (const cam of cameras) {
          if (next.length >= speakerSlots) break;
          if (!next.includes(cam.identity) && cam.identity !== pinnedId) next = [...next, cam.identity];
        }
      }
      if (next.length > speakerSlots) next = next.slice(0, speakerSlots);
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
  }, [speaking, cameras, speakerSlots, pinnedTile]);

  if (tiles.length === 0) return <EmptyState />;

  const featuredTiles: LayoutTile[] = [];
  if (screens[0]) featuredTiles.push(screens[0]);
  if (pinnedTile && !featuredTiles.some((t) => t.key === pinnedTile.key)) featuredTiles.push(pinnedTile);
  for (const id of featured) {
    if (featuredTiles.length >= FEATURED_MAX) break;
    const cam = cameras.find((c) => c.identity === id);
    if (cam && !featuredTiles.some((t) => t.key === cam.key)) featuredTiles.push(cam);
  }
  const featuredKeys = new Set(featuredTiles.map((t) => t.key));
  const strip = tiles
    .filter((t) => !featuredKeys.has(t.key))
    .sort((a, b) => joinIndex(a.key) - joinIndex(b.key));

  return (
    <div className="ag-lmulti">
      <div className="ag-lmulti-featured" data-n={featuredTiles.length}>
        {featuredTiles.map((t) => (
          <CallTile
            key={t.key}
            tile={t}
            speaking={t.source === "camera" && speaking.has(t.identity)}
            pinned={t.key === pinnedKey}
            onPin={onPin}
          />
        ))}
      </div>
      {strip.length > 0 && (
        <div className="ag-lmulti-strip">
          {strip.map((t) => (
            <CallTile
              key={t.key}
              tile={t}
              small
              speaking={t.source === "camera" && speaking.has(t.identity)}
              pinned={false}
              onPin={onPin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
