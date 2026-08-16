"use client";

/* Live camera tiles for the amphitheater: whoever on stage has their camera
   on gets a small feed docked above the control bar. Purely presentational —
   the tracks come from useAgoraCall. */

import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";
import type { VideoTile } from "./useAgoraCall";
import { useUserMenu } from "../userMenuContext";

function Tile({ tile }: { tile: VideoTile }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { openUserMenu } = useUserMenu();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const el = (tile.track as Track).attach() as HTMLVideoElement;
    el.muted = true; // audio plays through the call layer, not the tiles
    el.playsInline = true;
    host.appendChild(el);
    return () => {
      tile.track.detach(el);
      el.remove();
    };
  }, [tile.track]);

  return (
    <div className="ag-video-tile" title={tile.username}>
      <div ref={hostRef} className="ag-video-host" />
      <span
        className="ag-video-name"
        style={tile.local ? undefined : { cursor: "pointer" }}
        onClick={
          tile.local
            ? undefined
            : (e) => openUserMenu({ x: e.clientX, y: e.clientY }, { userId: tile.identity, username: tile.username })
        }
      >
        {tile.local ? "You" : tile.username}
      </span>
    </div>
  );
}

export default function AgoraVideoDock({ tiles }: { tiles: VideoTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="ag-video-dock">
      {tiles.map((t) => (
        <Tile key={`${t.identity}-${t.local ? "l" : "r"}`} tile={t} />
      ))}
    </div>
  );
}
