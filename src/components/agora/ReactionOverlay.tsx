"use client";

/* Floating emoji reactions over the amphitheater. Each reaction drifts up
   from the lower third and fades — position is seeded from its id so the
   stream scatters instead of stacking. */

import type { Reaction } from "./useAgoraCall";

export default function ReactionOverlay({ reactions }: { reactions: Reaction[] }) {
  return (
    <div className="ag-reactions" aria-hidden>
      {reactions.map((r) => (
        <span
          key={r.id}
          className="ag-reaction"
          style={{ left: `${12 + ((r.id * 37) % 76)}%` }}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
