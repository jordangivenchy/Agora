"use client";

/* The per-message menu (iMessage-style): quick reactions on top, actions
   beneath, floating beside the bubble it belongs to — below it when there
   is room, above it otherwise. Opened by a left click (desktop) or a
   press-and-hold (phones); the scrim behind it closes it. Positioned in
   the thread root's coordinate space (the root is position: relative). */

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";

interface Props {
  /** The bubble's rect and the thread root's rect, both viewport-relative. */
  anchor: DOMRect;
  root: DOMRect;
  /** Own message: the menu hugs the bubble's right edge. */
  mine: boolean;
  reactions: string[];
  /** Emoji the viewer already reacted with (shown pressed). */
  myReactions: Set<string>;
  canUnsend: boolean;
  hasText: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onUnsend: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const GAP = 6;
const EDGE = 8;

export default function DmMessageMenu({
  anchor, root, mine, reactions, myReactions, canUnsend, hasText,
  onReact, onReply, onCopy, onUnsend, onDelete, onClose,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  /* First paint below the bubble; flip above if that runs off the root. */
  const [place, setPlace] = useState<{ top: number; above: boolean }>({
    top: anchor.bottom - root.top + GAP,
    above: false,
  });
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0;
    const below = anchor.bottom - root.top + GAP;
    if (below + h <= root.height - EDGE) { setPlace({ top: below, above: false }); return; }
    const above = anchor.top - root.top - GAP - h;
    setPlace({ top: Math.max(EDGE, above), above: true });
  }, [anchor, root]);

  const side: CSSProperties = mine
    ? { right: Math.max(EDGE, root.right - anchor.right) }
    : { left: Math.max(EDGE, anchor.left - root.left) };

  return (
    <>
      <div className="dm-menu-scrim" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} aria-hidden="true" />
      <div
        ref={cardRef}
        role="menu"
        aria-label="Message actions"
        className={`dm-menu${mine ? " is-mine" : ""}${place.above ? " is-above" : ""}`}
        style={{ top: place.top, ...side }}
      >
        <div className="dm-menu-reactions" role="group" aria-label="React">
          {reactions.map((e) => (
            <button
              key={e}
              type="button"
              role="menuitem"
              onClick={() => onReact(e)}
              aria-label={`React ${e}`}
              className={`dm-menu-react${myReactions.has(e) ? " is-on" : ""}`}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="dm-menu-rows">
          <button type="button" role="menuitem" className="dm-menu-row" onClick={onReply}>
            <Icon name="text-quote" size={15} /> Reply
          </button>
          {hasText && (
            <button type="button" role="menuitem" className="dm-menu-row" onClick={onCopy}>
              <Icon name="copy" size={15} /> Copy text
            </button>
          )}
          {canUnsend && (
            <button type="button" role="menuitem" className="dm-menu-row dm-menu-row--danger" onClick={onUnsend}>
              <Icon name="circle-x" size={15} /> Unsend for everyone
            </button>
          )}
          <button type="button" role="menuitem" className="dm-menu-row dm-menu-row--danger" onClick={onDelete}>
            <Icon name="trash" size={15} /> Delete for you
          </button>
        </div>
      </div>
    </>
  );
}
