"use client";

/* A camera-off person's face, drawn the same in every call layout — the
   stage's panes and thumbs (AgoraStage) and the gallery and multi-speaker
   windows (CallLayouts): their photo, or their initial on the dark disc,
   ringed in their side's debate colour (a quiet ring without a side). */

import { useState } from "react";

export type FaceSide = "pro" | "con" | null;

export default function CameraOffFace({
  name,
  avatarUrl,
  side,
  size,
}: {
  /** Display name — its first letter stands in for a missing photo. */
  name: string;
  avatarUrl: string | null;
  side: FaceSide;
  /** Pixels, for a face outside a window (the "+N" stack, its list);
      in a window the CSS sizes it to the window. */
  size?: number;
}) {
  /* A photo that fails to load (rate-limited storage, dead URL) falls
     back to the initial glyph rather than the browser's broken-image
     icon sitting inside the ring. Keyed on the URL so a later, working
     avatar gets its chance. */
  const [broken, setBroken] = useState<string | null>(null);
  const cls = `ag-pane-avatar ag-pane-avatar--${side ?? "none"}`;
  const style = size ? { width: size } : undefined;
  if (avatarUrl && broken !== avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={cls} style={style} src={avatarUrl} alt="" onError={() => setBroken(avatarUrl)} />
    );
  }
  return (
    <span className={`${cls} ag-pane-initial`} style={style}>
      <span className="ag-pane-glyph">{name.slice(0, 1).toUpperCase()}</span>
    </span>
  );
}
