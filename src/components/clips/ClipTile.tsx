"use client";

/* One clip in a grid — the Twitch-style tile: 16:9 thumbnail (the
   room's still when it has one, otherwise the clip's gradient), a
   duration badge, the title, who clipped it and the view count. Links
   to the clip's own page. Layout rules live in globals.css (.clip-grid,
   .clip-tile*); the clip page's "More clips" row is the first user. */

import UserAvatar from "@/components/UserAvatar";
import { Icon } from "@/components/icons";

export type ClipTileData = {
  id: string;
  title: string;
  duration_seconds: number | null;
  view_count: number;
  thumb_gradient: string | null;
  thumbnail_url: string | null;
  uploader: { username: string; display_name: string | null; avatar_url: string | null } | null;
};

const GRADIENTS = [
  "linear-gradient(135deg,#0d1b4b,#2d1b69)",
  "linear-gradient(135deg,#0a2e1a,#1a4d3a)",
  "linear-gradient(135deg,#1a0a00,#3d2200)",
  "linear-gradient(135deg,#0d0a2e,#2a1a5a)",
  "linear-gradient(135deg,#2e0a0a,#5a1a1a)",
  "linear-gradient(135deg,#0a2a2e,#1a4a5a)",
];

/** A stable gradient for clips that saved none. */
export function clipGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

export function formatClipDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatViews(n: number): string {
  const short = n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);
  return `${short} view${n === 1 ? "" : "s"}`;
}

export default function ClipTile({ clip }: { clip: ClipTileData }) {
  const duration = formatClipDuration(clip.duration_seconds);
  const who = clip.uploader ? clip.uploader.display_name?.trim() || clip.uploader.username : null;
  return (
    <a href={`/clips/${clip.id}`} className="clip-tile" aria-label={clip.title || "Clip"}>
      <div className="clip-tile-thumb" style={{ background: clip.thumbnail_url ? undefined : clip.thumb_gradient ?? clipGradient(clip.id) }}>
        {clip.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.thumbnail_url} alt="" loading="lazy" />
        )}
        <span className="clip-tile-play" aria-hidden>
          <span style={{ width: 34, height: 34, borderRadius: "50%", background: "#000", border: "1px solid rgba(255,255,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="play" size={13} strokeWidth={0} style={{ fill: "#fff", marginLeft: 2 }} />
          </span>
        </span>
        {duration && (
          <span style={{ position: "absolute", right: 6, bottom: 6, padding: "2px 6px", borderRadius: 5, background: "#000", color: "#f5f5f0", fontSize: 11, fontWeight: 600, fontFamily: "'DM Mono', monospace", letterSpacing: "0.01em" }}>
            {duration}
          </span>
        )}
      </div>
      <p className="clip-tile-title">{clip.title || "Clip"}</p>
      <p style={{ margin: "5px 0 0", display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "rgba(238,238,245,0.55)", minWidth: 0 }}>
        {clip.uploader && (
          <>
            <UserAvatar size={16} username={clip.uploader.username} avatarUrl={clip.uploader.avatar_url} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</span>
            <span style={{ color: "#3a3a42" }}>·</span>
          </>
        )}
        <span style={{ flexShrink: 0 }}>{formatViews(clip.view_count)}</span>
      </p>
    </a>
  );
}
