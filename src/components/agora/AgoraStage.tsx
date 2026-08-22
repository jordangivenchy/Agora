"use client";

/* The stage, in DOM — every live picture in the room lives here now.

   This replaces the WebGL holo panels entirely. Those panels fought the
   liquid-glass language to the end: the renderer runs with MSAA off above
   1.5 dpr, the rim had to be rebuilt as an SDF shader, video was
   perspective-projected onto angled glass, and the Discord-style identity
   tag (glyph · username · state pill) was never going to happen in
   CanvasTexture typography. The DOM does all of it natively, with the
   exact construction the control bar and the cast surface already wear.
   The 3D scene keeps the environment — bowl, sky, stage, queue, crowd —
   and this layer floats over it where the panels used to stand.

   Two layouts, one component:
   - Duo: nobody sharing, nothing pinned — the two debater boxes side by
     side (the old panels' slots, pro frame-left, con frame-right).
     Camera off shows the profile card; an unclaimed side the open seat.
   - Focus: a screen is live, or the viewer pinned something. The focused
     picture takes a monitor-shaped 16:9 surface on the left; everyone
     else stacks in a column beside it — the streamer's own camera first,
     then the debaters, capped at two with a "view all" toggle beyond
     that. Two or fewer and they stretch to fill the column instead.

   Pinning is local: any seat in the house can click a sidebar box to make
   it the main picture, and click the main picture to let go. It changes
   nothing on the wire — who you are decides what you can publish, never
   what you're allowed to look at. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoTile } from "./useAgoraCall";
import { tileKey } from "./useAgoraCall";
import { useUserMenu } from "../userMenuContext";

export interface StagePane {
  id: string;
  /** Display name — what the tag shows. */
  username: string;
  /** Raw @handle for the user context menu (falls back to username). */
  handle?: string;
  avatarUrl: string | null;
  /** This pane is the signed-in viewer — suppresses the profile menu. */
  local: boolean;
  /** The pane holder's live camera, when it's on. */
  tile: VideoTile | null;
}

export interface StagePanes {
  pro: StagePane | null;
  con: StagePane | null;
}

interface Props {
  tiles: VideoTile[];
  panes: StagePanes;
  view: "audience" | "speaker";
  /** Identities currently speaking — drives the lift-and-light cue. */
  speaking?: ReadonlySet<string>;

  anchored?: boolean;
}

/** One entry in the sidebar: a live tile, or a camera-off participant. */
interface SideItem {
  key: string;
  id: string;
  username: string;
  handle?: string;
  local: boolean;
  tile: VideoTile | null;
  /** Camera-off pane rendered as a profile card. */
  pane: StagePane | null;
  side: "pro" | "con" | null;
  isScreen: boolean;
}

function ScreenGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/** One attached <video>. Screens letterbox, cameras fill — a cropped
    screen share loses exactly the edges of the window that matter. */
function Surface({ tile }: { tile: VideoTile }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const el = tile.track.attach() as HTMLVideoElement;
    el.muted = true; // audio is the call layer's job, not the picture's
    el.playsInline = true;
    el.style.objectFit = tile.source === "screen" ? "contain" : "cover";
    host.appendChild(el);
    return () => {
      tile.track.detach(el);
      el.remove();
    };
  }, [tile.track, tile.source]);

  return <div ref={hostRef} className="ag-cast-surface" />;
}

/** Camera-off body: the holder's profile card, or the open seat. The ring
    colour is the side's debate colour — the one piece of the old panels
    worth keeping. */
function PaneFill({ pane, side }: { pane: StagePane | null; side: "pro" | "con" | null }) {
  /* A photo that fails to load (rate-limited storage, dead URL) falls
     back to the initial glyph rather than the browser's broken-image
     icon sitting inside the ring. Keyed on the URL so a later, working
     avatar gets its chance. */
  const [broken, setBroken] = useState<string | null>(null);
  const showImg = !!pane?.avatarUrl && broken !== pane.avatarUrl;
  const sideClass = side ? ` ag-pane-avatar--${side}` : "";

  if (!pane) {
    return (
      <div className="ag-pane-fill">
        <div className="ag-pane-empty" aria-label="Open seat">?</div>
      </div>
    );
  }
  return (
    <div className="ag-pane-fill">
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={`ag-pane-avatar${sideClass}`}
          src={pane.avatarUrl!}
          alt=""
          onError={() => setBroken(pane.avatarUrl)}
        />
      ) : (
        <div className={`ag-pane-avatar${sideClass} ag-pane-initial`}>
          {pane.username.slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  );
}

/** The identity tag — glyph · username · pill, Discord-fashion. Always
    the username: "You" told you nothing the rest of the room could see,
    and the room should read the same from every seat. */
function Tag({
  name,
  screen,
  small,
  onName,
}: {
  name: string;
  screen?: boolean;
  small?: boolean;
  onName?: (e: React.MouseEvent) => void;
}) {
  return (
    <span className={small ? "ag-cast-thumb-tag" : "ag-cast-tag"}>
      {screen && (
        <span className="ag-cast-tag-ico"><ScreenGlyph /></span>
      )}
      <span
        className="ag-cast-tag-name"
        onClick={onName}
        style={onName ? { cursor: "pointer" } : undefined}
      >
        {name}
      </span>
      {screen && <span className="ag-cast-tag-pill">SCREEN</span>}
    </span>
  );
}

export default function AgoraStage({ tiles, panes, view, speaking, anchored }: Props) {
  const { openUserMenu } = useUserMenu();
  /* The viewer's pin — a preference, not a subscription. Held as a tile
     key and resolved against the live list every render, so a feed that
     ends simply stops matching and the stage falls back to the default. */
  const [pinKey, setPinKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const screens = useMemo(() => tiles.filter((t) => t.source === "screen"), [tiles]);

  const nameMenu = useCallback(
    (id: string, username: string, local: boolean) =>
      local
        ? undefined
        : (e: React.MouseEvent) => {
            e.stopPropagation();
            openUserMenu({ x: e.clientX, y: e.clientY }, { userId: id, username });
          },
    [openUserMenu]
  );

  const pinned = useMemo(
    () => (pinKey ? tiles.find((t) => tileKey(t) === pinKey) ?? null : null),
    [tiles, pinKey]
  );
  const main = pinned ?? screens[0] ?? null;

  const isSpeaking = useCallback(
    (id: string | undefined) => !!id && !!speaking?.has(id),
    [speaking]
  );

  /* Mirrors the old panels' visibility rule exactly: up for the speaker
     vantage, or whenever any live picture exists in any view. */
  const anyLive = screens.length > 0 || !!panes.pro?.tile || !!panes.con?.tile;
  if (!anyLive && view !== "speaker") return null;

  const sides: ["pro", "con"] = ["pro", "con"];

  /* ── Focus layout: monitor-shaped main + the room beside it ── */
  if (main) {
    const mainOwnerPane = sides
      .map((s) => panes[s])
      .find((p) => p && p.id === main.identity);
    const mainName = mainOwnerPane?.username ?? main.username;

    const items: SideItem[] = [];
    /* The streamer's own face rides at the top of the column while their
       screen is up — the sketch's "person who is streaming" slot. */
    if (main.source === "screen") {
      const sharerCam = tiles.find(
        (t) => t.source === "camera" && t.identity === main.identity
      );
      const sharerPane = sides.map((s) => panes[s]).find((p) => p?.id === main.identity);
      if (sharerCam) {
        items.push({
          key: tileKey(sharerCam),
          id: sharerCam.identity,
          username: mainName,
          handle: sharerPane?.handle,
          local: sharerCam.local,
          tile: sharerCam,
          pane: null,
          side: sharerPane ? (panes.pro?.id === sharerPane.id ? "pro" : "con") : null,
          isScreen: false,
        });
      } else if (sharerPane) {
        items.push({
          key: `pane:${sharerPane.id}`,
          id: sharerPane.id,
          username: sharerPane.username,
          handle: sharerPane.handle,
          local: sharerPane.local,
          tile: null,
          pane: sharerPane,
          side: panes.pro?.id === sharerPane.id ? "pro" : "con",
          isScreen: false,
        });
      }
    }
    for (const side of sides) {
      const pane = panes[side];
      if (!pane) continue;
      if (items.some((i) => i.id === pane.id)) continue; // already up as sharer
      if (pane.tile && tileKey(pane.tile) === tileKey(main)) continue; // is the main
      items.push({
        key: pane.tile ? tileKey(pane.tile) : `pane:${pane.id}`,
        id: pane.id,
        username: pane.username,
        handle: pane.handle,
        local: pane.local,
        tile: pane.tile,
        pane: pane.tile ? null : pane,
        side,
        isScreen: false,
      });
    }
    /* Everyone else with a live picture — other cameras (co-hosts,
       promoted speakers) and any additional shares. This is what the
       view-all button exists for. */
    for (const t of tiles) {
      if (tileKey(t) === tileKey(main)) continue;
      if (items.some((i) => i.tile && tileKey(i.tile) === tileKey(t))) continue;
      if (t.source === "camera" && items.some((i) => i.id === t.identity)) continue;
      items.push({
        key: tileKey(t),
        id: t.identity,
        username: t.username,
        local: t.local,
        tile: t,
        pane: null,
        side: null,
        isScreen: t.source === "screen",
      });
    }

    const overflow = items.length > 2 && !showAll;
    const visible = overflow ? items.slice(0, 2) : items;
    const stretch = items.length <= 2 && !showAll;

    return (
      <div
        className={`ag-cast ag-cast--focus${anchored ? " ag-cast--anchored" : ""}`}
        role="region"
        aria-label="Stage"
      >
        <div
          className={`ag-cast-main${pinned ? " ag-cast-main--pinned" : ""}`}
          onClick={pinned ? () => setPinKey(null) : undefined}
          title={pinned ? "Unpin" : undefined}
        >
          <Surface tile={main} />
          <Tag
            name={mainName}
            screen={main.source === "screen"}
            onName={nameMenu(main.identity, mainOwnerPane?.handle ?? mainName, main.local)}
          />
        </div>

        <div
          className={`ag-cast-side${stretch ? " ag-cast-side--stretch" : ""}${showAll ? " ag-cast-side--all" : ""}`}
        >
          {visible.map((item) => {
            const pinnable = !!item.tile;
            return (
              <button
                key={item.key}
                className={`ag-cast-thumb${item.tile ? " ag-cast-thumb--live" : ""}${isSpeaking(item.id) ? " ag-cast-thumb--speaking" : ""}`}
                disabled={!pinnable}
                onClick={pinnable ? () => setPinKey(item.key) : undefined}
                aria-label={
                  pinnable
                    ? `Pin ${item.username}${item.isScreen ? "'s screen" : ""}`
                    : `${item.username} — camera off`
                }
              >
                {item.tile ? <Surface tile={item.tile} /> : <PaneFill pane={item.pane} side={item.side} />}
                <Tag
                  name={item.username}
                  screen={item.isScreen}
                  small
                  onName={nameMenu(item.id, item.handle ?? item.username, item.local)}
                />
              </button>
            );
          })}
          {overflow && (
            <button className="ag-cast-more" onClick={() => setShowAll(true)}>
              View all ({items.length})
            </button>
          )}
          {showAll && items.length > 2 && (
            <button className="ag-cast-more" onClick={() => setShowAll(false)}>
              Show less
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── Duo layout: the two debaters, where the panels stood ── */
  return (
    <div
      className={`ag-cast${anchored ? " ag-cast--anchored" : ""}`}
      role="region"
      aria-label="Stage"
    >
      <div className="ag-cast-duo">
        {sides.map((side) => {
          const pane = panes[side];
          /* A live duo pane is pinnable too — click it and it takes the
             big surface, which is how the focus layout is reached with
             no share running. */
          const pinnable = !!pane?.tile;
          return (
            <div
              key={side}
              className={`ag-cast-pane ag-cast-pane--${side}${
                pane?.tile ? " ag-cast-pane--live" : ""
              }${pane && isSpeaking(pane.id) ? " ag-cast-pane--speaking" : ""}${
                pinnable ? " ag-cast-pane--pinnable" : ""
              }`}
              role={pinnable ? "button" : undefined}
              tabIndex={pinnable ? 0 : undefined}
              aria-label={pinnable ? `Pin ${pane!.username}` : undefined}
              onClick={pinnable ? () => setPinKey(tileKey(pane!.tile!)) : undefined}
              onKeyDown={
                pinnable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") setPinKey(tileKey(pane!.tile!));
                    }
                  : undefined
              }
            >
              {pane?.tile ? <Surface tile={pane.tile} /> : <PaneFill pane={pane} side={side} />}
              {pane && (
                <Tag
                  name={pane.username}
                  onName={nameMenu(pane.id, pane.handle ?? pane.username, pane.local)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
