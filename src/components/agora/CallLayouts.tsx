"use client";

/* Zoom-style call layouts for the amphitheater — a viewer-side choice,
   nothing on the wire changes. Two flat 2D layouts that overlay the 3D
   scene (which keeps running, dimmed, behind them):

   - Gallery: Discord's grid, the same logic as the phone app
     (callGrid.ts, gallerySlots.ts): 16:9 windows as big as the stage
     allows, a shared screen a 2×2 block, a short last row centred. Past
     nine places the last window is "+N": the pin, you, whoever is
     talking and cameras on hold the windows, trading them in place — a
     hidden speaker comes in after 3s of talk, over someone quiet for 8s,
     so the grid doesn't reshuffle on every volume flicker — and "+N"
     lists the rest to keep one in view.
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
import CameraOffFace, { type FaceSide } from "./CameraOffFace";
import { planGrid, screenPlaces } from "./callGrid";
import { planSlots, type SlotPerson } from "./gallerySlots";

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
  /** For camera-off participants: avatar placeholder instead of video. */
  avatarUrl?: string | null;
  avatarSeed?: string;
  /** The ring on their camera-off face: the stage's side colour, if any. */
  side?: FaceSide;
  /** Host or co-host: the last to give up a gallery window. */
  host?: boolean;
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
  const off = !tile.track && !tile.mock;
  return (
    <div
      className={`ag-lt${small ? " ag-lt--small" : ""}${speaking ? " ag-lt--speaking" : ""}${
        tile.source === "screen" ? " ag-lt--screen" : ""
      }${off ? " ag-lt--off" : ""}`}
      onDoubleClick={handlePin}
      title={tile.source === "screen" ? `${tile.username} — screen` : tile.username}
    >
      {!off ? (
        <TileVideo
          track={tile.track}
          mock={tile.mock}
          screen={tile.source === "screen"}
          mirror={tile.local}
        />
      ) : (
        /* Camera off: the stage's own pane — the scene through the glass,
           the same face in the middle (CameraOffFace). */
        <span className="ag-lt-video ag-lt-video--off">
          <CameraOffFace name={tile.username} avatarUrl={tile.avatarUrl ?? null} side={tile.side ?? null} />
        </span>
      )}
      <span className="ag-lt-tag">
        {tile.source === "screen" && (
          <span className="ag-lt-tag-ico"><Icon name="monitor" size={12} /></span>
        )}
        <span className="ag-lt-tag-name">{tile.username}</span>
        {tile.source !== "screen" && tile.micMuted && (
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

/* Three rows of three; windows the shape of a screen. */
const PLACES = 9;
const GAP = 12;
const RATIO = 16 / 9;

export function CallGallery({
  tiles,
  speaking,
  pinnedKey = null,
  onPin,
  onKeepInView,
}: {
  tiles: LayoutTile[];
  speaking: ReadonlySet<string>;
  /** The viewer's pin: always in view. */
  pinnedKey?: string | null;
  /** A window's pin control — the page answers by switching to multi, featured. */
  onPin?: (key: string) => void;
  /** Keep someone in view here (picked from "+N"), or let go (null). */
  onKeepInView?: (key: string | null) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((b) => (Math.round(b.w) === Math.round(width) && Math.round(b.h) === Math.round(height) ? b : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { shown, hidden } = useGallerySlots(tiles, speaking, pinnedKey);
  const [menuOpen, setMenuOpen] = useState(false);
  /* Nobody left behind "+N": the list has nothing to show. */
  if (menuOpen && !hidden.length) setMenuOpen(false);

  const kinds = [...shown.map((t) => t.source), ...(hidden.length ? (["camera"] as const) : [])];
  const plan = planGrid(kinds, box.w, box.h, GAP, RATIO);
  const moreCell = hidden.length ? plan.cells.find((c) => c.index === shown.length) ?? null : null;

  return (
    <div className="ag-lgal" ref={boxRef}>
      {tiles.length === 0 ? (
        <EmptyState />
      ) : (
        plan.cells.map((cell) => {
          const style = { left: cell.x, top: cell.y, width: cell.w, height: cell.h };
          const t = shown[cell.index];
          if (!t) {
            return (
              <div key="more" className="ag-lgal-cell" style={style}>
                <MoreTile people={hidden} speaking={speaking} height={cell.h} open={menuOpen} onToggle={() => setMenuOpen((o) => !o)} />
              </div>
            );
          }
          const pinned = t.key === pinnedKey;
          return (
            <div key={t.key} className="ag-lgal-cell" style={style}>
              <CallTile
                tile={t}
                speaking={t.source === "camera" && speaking.has(t.identity)}
                pinned={pinned}
                onPin={
                  onPin || onKeepInView
                    ? (key) => {
                        /* The pinned window's control lets go here; any other features it in multi. */
                        if (key === null) onKeepInView?.(null);
                        else if (onPin) onPin(key);
                        else onKeepInView?.(key);
                      }
                    : undefined
                }
              />
            </div>
          );
        })
      )}
      {menuOpen && moreCell && (
        <MoreMenu
          people={hidden}
          speaking={speaking}
          anchor={moreCell}
          box={box}
          onPick={(key) => {
            setMenuOpen(false);
            onKeepInView?.(key);
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

/* The gallery's windows (gallerySlots.ts): who is in view, kept in their
   spots from one moment to the next. A clock runs while someone waits
   behind "+N"; who is talking, and since when, is kept by that clock; the
   plan is re-made each render and remembered when it changes. */
function useGallerySlots(tiles: LayoutTile[], speaking: ReadonlySet<string>, pinned: string | null): { shown: LayoutTile[]; hidden: LayoutTile[] } {
  const joinIndex = useJoinOrder(tiles);
  const screens = tiles.filter((t) => t.source === "screen").sort((a, b) => joinIndex(a.key) - joinIndex(b.key));
  const people = tiles.filter((t) => t.source === "camera");
  const places = Math.max(1, PLACES - screenPlaces(screens.length, RATIO));
  const crowded = people.length > places;

  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!crowded) return;
    const tick = () => setClock(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [crowded]);

  const [talk, setTalk] = useState<{ speaking: ReadonlySet<string>; clock: number; since: Record<string, number>; last: Record<string, number> }>(
    () => ({ speaking, clock, since: {}, last: {} })
  );
  if (talk.speaking !== speaking || talk.clock !== clock) {
    const since: Record<string, number> = {};
    const last = { ...talk.last };
    for (const t of people) {
      if (!speaking.has(t.identity)) continue;
      since[t.key] = talk.since[t.key] ?? clock;
      last[t.key] = clock;
    }
    setTalk({ speaking, clock, since, last });
  }

  const [kept, setKept] = useState<string[]>([]);
  const info: SlotPerson[] = people.map((t) => ({
    key: t.key,
    speakingSince: talk.since[t.key] ?? null,
    lastSpoke: talk.last[t.key] ?? 0,
    cameraOn: !!t.track || !!t.mock,
    local: t.local,
    host: !!t.host,
    join: joinIndex(t.key),
  }));
  const plan = planSlots(kept, info, places, pinned, clock);
  if (plan.shown.join("|") !== kept.join("|")) setKept(plan.shown);
  const byKey = new Map(people.map((t) => [t.key, t] as const));
  return { shown: [...screens, ...plan.shown.map((k) => byKey.get(k)!)], hidden: plan.hidden.map((k) => byKey.get(k)!) };
}

/* The last window past nine: the first faces behind it, how many, and the gold ring when one of them is talking. */
function MoreTile({ people, speaking, height, open, onToggle }: { people: LayoutTile[]; speaking: ReadonlySet<string>; height: number; open: boolean; onToggle: () => void }) {
  const talking = people.some((t) => speaking.has(t.identity));
  const face = Math.round(Math.max(24, Math.min(56, height * 0.26)));
  return (
    <button
      type="button"
      className={`ag-lt ag-lt--more${talking ? " ag-lt--speaking" : ""}`}
      onClick={onToggle}
      aria-haspopup="menu"
      aria-expanded={open}
      title={`${people.length} more on stage`}
    >
      <span className="ag-lt-more-faces">
        {people.slice(0, 3).map((t, i) => (
          <span key={t.key} className={`ag-lt-more-face${speaking.has(t.identity) ? " is-speaking" : ""}`} style={{ zIndex: 3 - i, marginLeft: i ? -Math.round(face * 0.3) : 0 }}>
            <CameraOffFace name={t.username} avatarUrl={t.avatarUrl ?? null} side={t.side ?? null} size={face} />
          </span>
        ))}
      </span>
      <span className="ag-lt-more-count" style={{ fontSize: Math.round(Math.max(14, Math.min(24, height * 0.12))) }}>+{people.length}</span>
    </button>
  );
}

/* Everyone behind "+N", from the "+N" window: pick one to keep in view. */
function MoreMenu({
  people,
  speaking,
  anchor,
  box,
  onPick,
  onClose,
}: {
  people: LayoutTile[];
  speaking: ReadonlySet<string>;
  anchor: { x: number; y: number; w: number; h: number };
  box: { w: number; h: number };
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".ag-lt--more")) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const width = Math.min(260, box.w);
  const left = Math.max(0, Math.min(anchor.x + anchor.w - width, box.w - width));
  /* Opens toward the roomier side of the window. */
  const above = anchor.y + anchor.h / 2 > box.h / 2;
  const style = above ? { left, width, bottom: box.h - anchor.y + 8 } : { left, width, top: anchor.y + anchor.h + 8 };
  return (
    <div ref={ref} className="ag-lgal-menu" role="menu" style={style}>
      <div className="ag-lgal-menu-title">{people.length} more on stage · pick one to keep in view</div>
      {people.map((t) => {
        const talking = speaking.has(t.identity);
        return (
          <button key={t.key} type="button" role="menuitem" className="ag-lgal-menu-item" onClick={() => onPick(t.key)}>
            <CameraOffFace name={t.username} avatarUrl={t.avatarUrl ?? null} side={t.side ?? null} size={26} />
            <span className="ag-lgal-menu-name">{t.local ? "You" : t.username}</span>
            {(talking || t.track || t.mock) && (
              <span className={`ag-lgal-menu-state${talking ? " is-speaking" : ""}`} aria-label={talking ? "Talking" : "Camera on"}>
                <Icon name={talking ? "mic" : "video"} size={14} />
              </span>
            )}
          </button>
        );
      })}
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

  /* A PINNED screen share takes the stage alone, near-fullscreen —
     everyone's cameras drop to the filmstrip. (An unpinned share still
     cohabits the featured row with the speakers.) */
  const soloScreen = pinnedTile && pinnedTile.source === "screen" ? pinnedTile : null;

  const featuredTiles: LayoutTile[] = [];
  if (soloScreen) {
    featuredTiles.push(soloScreen);
  } else {
    if (screens[0]) featuredTiles.push(screens[0]);
    if (pinnedTile && !featuredTiles.some((t) => t.key === pinnedTile.key)) featuredTiles.push(pinnedTile);
    for (const id of featured) {
      if (featuredTiles.length >= FEATURED_MAX) break;
      const cam = cameras.find((c) => c.identity === id);
      if (cam && !featuredTiles.some((t) => t.key === cam.key)) featuredTiles.push(cam);
    }
  }
  const featuredKeys = new Set(featuredTiles.map((t) => t.key));
  const strip = tiles
    .filter((t) => !featuredKeys.has(t.key))
    .sort((a, b) => joinIndex(a.key) - joinIndex(b.key));

  return (
    <div className={`ag-lmulti${soloScreen ? " ag-lmulti--screen-solo" : ""}`}>
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
