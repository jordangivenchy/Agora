"use client";

/* The pop-up a notification makes when it lands while you're on the
   site: a card like a row of the bell's list, under the bell on desktop
   and across the top of a phone, that opens what it's about when you
   click it and goes by itself after a few seconds (not while the pointer
   is on the cards — the yellow line along its foot is the time it has
   left).
   Newest on top, three at most. Presentational: the bell owns the rows
   and what opening or accepting does. Portaled to <body>, like the
   panel. */

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import ActorText from "./ActorText";
import { notifDetail, notifHref, notifIcon, notifText, type NotifRow } from "@/lib/notifications";

export type Toast = { n: NotifRow; leaving: boolean };

/* How long a leaving card takes to go (matches notifToastOut in
   globals.css), and how the others close up behind it. */
const LEAVE_MS = 180;
const SETTLE_MS = 240;

interface Props {
  toasts: Toast[];
  /** The bell's rect — on desktop the cards hang under it, as the panel does. */
  anchor: DOMRect | null;
  followedBack: Set<string>;
  onOpen: (n: NotifRow) => void;
  onAccept: (n: NotifRow) => void;
  onClose: (id: string) => void;
  onGone: (id: string) => void;
}

export default function NotificationToasts({ toasts, anchor, followedBack, onOpen, onAccept, onClose, onGone }: Props) {
  const stackRef = useRef<HTMLDivElement>(null);
  const tops = useRef(new Map<string, number>());
  const leavingTimers = useRef(new Map<string, number>());

  /* A card on its way out is taken away once it has faded. */
  useEffect(() => {
    for (const t of toasts) {
      if (!t.leaving || leavingTimers.current.has(t.n.id)) continue;
      const id = t.n.id;
      leavingTimers.current.set(id, window.setTimeout(() => {
        leavingTimers.current.delete(id);
        onGone(id);
      }, LEAVE_MS));
    }
  }, [toasts, onGone]);
  useEffect(() => {
    const timers = leavingTimers.current;
    return () => { timers.forEach((t) => window.clearTimeout(t)); timers.clear(); };
  }, []);

  /* The others glide to their new places when a card comes in above
     them or goes from between them, rather than jumping there. */
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const seen = new Map<string, number>();
    for (const slot of stack.querySelectorAll<HTMLElement>(".notif-toast-slot")) {
      const id = slot.dataset.id!;
      const top = slot.offsetTop;
      seen.set(id, top);
      const was = tops.current.get(id);
      if (was !== undefined && was !== top) {
        slot.animate(
          [{ transform: `translateY(${was - top}px)` }, { transform: "translateY(0)" }],
          { duration: SETTLE_MS, easing: "cubic-bezier(.2,.7,.2,1)" },
        );
      }
    }
    tops.current = seen;
  }, [toasts]);

  if (!toasts.length || typeof document === "undefined") return null;

  /* Desktop: under the bell, right edges aligned (the phone block in
     globals.css lays the stack across the top of the screen instead). */
  const place: CSSProperties = anchor
    ? { top: anchor.bottom + 10, right: Math.max(8, window.innerWidth - anchor.right) }
    : {};

  return createPortal(
    <div ref={stackRef} className="notif-toasts" style={place} role="region" aria-label="New notifications" aria-live="polite">
      {toasts.map(({ n, leaving }) => {
        const href = notifHref(n);
        const detail = notifDetail(n);
        const pendingFollow = n.type === "new_follower" && !!n.actor_id && !followedBack.has(n.actor_id);
        return (
          <div key={n.id} data-id={n.id} className="notif-toast-slot">
            <div
              className={`notif-toast${leaving ? " is-leaving" : ""}`}
              role={href ? "link" : undefined}
              tabIndex={href ? 0 : undefined}
              onClick={() => onOpen(n)}
              onKeyDown={(e) => { if (e.key === "Enter") onOpen(n); }}
              style={{ cursor: href ? "pointer" : "default" }}
            >
              <span className="notif-row-avatar">
                {n.actor_id ? (
                  <UserAvatar username={n.actor_username ?? "?"} avatarUrl={n.actor_avatar_url} size={34} />
                ) : (
                  <span className="notif-row-tile"><Icon name={notifIcon(n.type)} size={15} /></span>
                )}
                {n.actor_id && (
                  <span className="notif-row-kind"><Icon name={notifIcon(n.type)} size={9} /></span>
                )}
              </span>
              <span className="notif-toast-main">
                <span className="notif-toast-text"><ActorText n={n} text={notifText(n)} /></span>
                {detail && <span className="notif-toast-detail">“{detail}”</span>}
                {pendingFollow && (
                  <span className="notif-row-actions">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onAccept(n); }}
                      className="notif-btn notif-btn--primary"
                    >
                      Accept
                    </button>
                  </span>
                )}
              </span>
              <button
                type="button"
                className="notif-toast-close"
                aria-label="Dismiss"
                onClick={(e) => { e.stopPropagation(); onClose(n.id); }}
              >
                <Icon name="x" size={14} />
              </button>
              {/* The time left, run down by CSS (it holds while the
                  pointer or focus is on the cards); a grouped row that
                  grows brings a new time, which starts it again. */}
              <span
                key={n.created_at}
                className="notif-toast-timer"
                aria-hidden="true"
                onAnimationEnd={(e) => { if (e.animationName === "notifToastTimer") onClose(n.id); }}
              />
            </div>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
