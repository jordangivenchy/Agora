/* People without a camera, beside the windows. A window is for a picture:
   once anyone has a camera or a screen on, the people without one step
   out of the grid and sit small in a row at its edge — a face, a ring
   when they talk — so the pictures get the room (TikTok's way with a
   guest whose camera is off). With no picture anywhere, there is nothing
   to make room for, and everyone keeps a window as before.

   Someone kept in view by the viewer (their pin) keeps a window, camera
   or not: that is how a face is brought back up to size. */
export function splitQuiet<T extends { key: string }>(
  tiles: T[],
  /** A live picture: a camera that is on, or a shared screen. */
  pictured: (tile: T) => boolean,
  pinnedKey: string | null,
  enabled: boolean,
): { windows: T[]; quiet: T[] } {
  if (!enabled || !tiles.some(pictured)) return { windows: tiles, quiet: [] };
  const windows: T[] = [];
  const quiet: T[] = [];
  for (const t of tiles) (pictured(t) || t.key === pinnedKey ? windows : quiet).push(t);
  return { windows, quiet };
}

/** Of the quiet people, in the order given: who shows as a face, and who
    waits behind "+N". The first `max` show — except that anyone talking
    is always among the faces, taking the place of the last one who
    isn't. */
export function quietFaces<T extends { identity: string }>(quiet: T[], speaking: ReadonlySet<string>, max: number): { shown: T[]; more: T[] } {
  if (quiet.length <= max) return { shown: quiet, more: [] };
  const shown = quiet.slice(0, max);
  const more = quiet.slice(max);
  for (let i = 0; i < more.length; i++) {
    if (!speaking.has(more[i].identity)) continue;
    let at = -1;
    for (let j = shown.length - 1; j >= 0; j--) {
      if (!speaking.has(shown[j].identity)) {
        at = j;
        break;
      }
    }
    if (at < 0) break; // every face is talking already
    const out = shown[at];
    shown[at] = more[i];
    more[i] = out;
  }
  return { shown, more };
}

/** How big a face is, for the box the windows share: small, but never a
    speck in a large picture nor a crowd in a small one. */
export function quietFaceSize(width: number, height: number): number {
  return Math.round(Math.max(40, Math.min(72, Math.min(width, height) * 0.09)));
}
