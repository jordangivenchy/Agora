"use client";

/* Small round avatar shown next to every username: the profile photo when
   one exists, otherwise an initial on a deterministic per-user color (same
   hash as the agora chat colors, so a user looks the same everywhere).
   Failed photo loads (e.g. Google's lh3 rate-limiting bursts with 429s)
   fall back to the initial glyph instead of a broken-image icon. */

import { useState } from "react";

/* Google OAuth avatars default to a 96px thumbnail (=s96-c) — ask Google
   for a size that matches what we actually render (2x for retina). */
function bestResolution(url: string, px: number): string {
  const m = url.match(/^(https:\/\/lh3\.googleusercontent\.com\/.+=s)\d+(-c)$/);
  if (m) return `${m[1]}${Math.max(256, Math.ceil(px * 2))}${m[2]}`;
  return url;
}

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}deg 45% 42%)`;
}

export default function UserAvatar({
  username,
  avatarUrl,
  seed,
  size = 20,
  radius = "50%",
}: {
  username?: string | null;
  avatarUrl?: string | null;
  /** Color-hash seed — pass the user id when available so renames keep the color. */
  seed?: string;
  size?: number;
  /** Corner radius — default full circle; pass e.g. 0 or 12 for tiles. */
  radius?: number | string;
}) {
  const [failed, setFailed] = useState(false);
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    verticalAlign: "middle",
    overflow: "hidden",
  };
  if (avatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={bestResolution(avatarUrl, size)}
        alt=""
        onError={() => setFailed(true)}
        style={{ ...base, objectFit: "cover" }}
      />
    );
  }
  return (
    <span
      style={{
        ...base,
        background: username ? colorFor(seed || username) : "rgba(255,255,255,0.08)",
        color: "white",
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: 700,
        fontSize: Math.max(8, Math.round(size * 0.42)),
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      {username ? username[0].toUpperCase() : "?"}
    </span>
  );
}
