/* Small round avatar shown next to every username: the profile photo when
   one exists, otherwise an initial on a deterministic per-user color (same
   hash as the agora chat colors, so a user looks the same everywhere). */

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
}: {
  username?: string | null;
  avatarUrl?: string | null;
  /** Color-hash seed — pass the user id when available so renames keep the color. */
  seed?: string;
  size?: number;
}) {
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    verticalAlign: "middle",
    overflow: "hidden",
  };
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt="" style={{ ...base, objectFit: "cover" }} />
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
