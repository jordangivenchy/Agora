"use client";

/* The notifications popover — the bell's dropdown on desktop, a sheet
   under the top bar on phones (the same treatment as search: starfield
   through, page hidden beneath it, rise-in). Presentational: the bell
   owns the data and RPCs and passes everything in. Portaled to <body>
   so the navbar can never clip or stack it. */

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import {
  actorLabel, notifDetail, notifHref, notifIcon, notifText, timeAgo, type NotifRow,
} from "@/lib/notifications";

export type PushState = "unsupported" | "off" | "on" | "busy";

interface Props {
  open: boolean;
  /** The bell's rect — the desktop popover hangs off its bottom-right. */
  anchor: DOMRect | null;
  items: NotifRow[];
  unread: number;
  followedBack: Set<string>;
  dismissed: Set<string>;
  pushState: PushState;
  onClose: () => void;
  onMarkAllRead: () => void;
  onOpen: (n: NotifRow) => void;
  onAccept: (n: NotifRow) => void;
  onDismiss: (n: NotifRow) => void;
  onTogglePush: () => void;
}

const ANIM_MS = 220;

const sectionLabel: CSSProperties = {
  margin: "14px 16px 6px",
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "rgba(238,238,245,0.42)",
};

export default function NotificationsPanel({
  open, anchor, items, unread, followedBack, dismissed, pushState,
  onClose, onMarkAllRead, onOpen, onAccept, onDismiss, onTogglePush,
}: Props) {
  /* Mount/unmount around the enter/leave transition (same shape as the
     search panel). */
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), ANIM_MS + 20);
    return () => clearTimeout(t);
  }, [open]);

  /* Phones: the page under the sheet is hidden while it is up (the rule
     lives in globals.css's phone block, so desktop is unaffected). */
  useEffect(() => {
    document.documentElement.classList.toggle("notif-sheet-open", shown);
    return () => document.documentElement.classList.remove("notif-sheet-open");
  }, [shown]);

  if (!mounted || typeof document === "undefined") return null;

  const visible = items.filter((n) => !dismissed.has(n.id));
  const fresh = visible.filter((n) => !n.read_at);
  const earlier = visible.filter((n) => !!n.read_at);

  /* Desktop placement: under the bell, right edges aligned. The phone
     block overrides all of this into a full-width sheet. */
  const place: CSSProperties = anchor
    ? { top: anchor.bottom + 10, right: Math.max(8, window.innerWidth - anchor.right) }
    : { top: 70, right: 16 };

  const row = (n: NotifRow) => {
    const href = notifHref(n);
    const detail = notifDetail(n);
    const unreadRow = !n.read_at;
    const pendingFollow = n.type === "new_follower" && !!n.actor_id && !followedBack.has(n.actor_id);
    return (
      <div
        key={n.id}
        role={href ? "link" : undefined}
        tabIndex={href ? 0 : undefined}
        onClick={() => onOpen(n)}
        onKeyDown={(e) => { if (e.key === "Enter") onOpen(n); }}
        className={`notif-row${unreadRow ? " is-unread" : ""}`}
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
        <span className="notif-row-main">
          <span className="notif-row-text">
            {n.type === "new_follower" && n.actor_id && followedBack.has(n.actor_id)
              ? `${actorLabel(n)} started following you`
              : notifText(n)}
          </span>
          {detail && <span className="notif-row-detail">“{detail}”</span>}
          {pendingFollow && (
            <span className="notif-row-actions">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAccept(n); }}
                className="notif-btn notif-btn--primary"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDismiss(n); }}
                className="notif-btn"
              >
                Dismiss
              </button>
            </span>
          )}
        </span>
        <span className="notif-row-meta">
          <span>{timeAgo(n.created_at)}</span>
          {unreadRow && <span className="notif-row-dot" />}
        </span>
      </div>
    );
  };

  return createPortal(
    <>
      <div className={`notif-scrim${shown ? " is-open" : ""}`} onMouseDown={onClose} aria-hidden="true" />
      <div
        className={`notif-panel${shown ? " is-open" : ""}`}
        role="dialog"
        aria-label="Notifications"
        style={place}
      >
        <div className="notif-head">
          <p className="notif-title">
            Notifications
            {unread > 0 && <span className="notif-title-badge">{unread} new</span>}
          </p>
          <span className="notif-head-actions">
            <button
              type="button"
              onClick={onMarkAllRead}
              disabled={unread === 0}
              className="notif-btn notif-btn--quiet"
              title="Mark all as read"
            >
              <Icon name="check-check" size={13} /> Mark all read
            </button>
            <button type="button" onClick={onClose} className="notif-close" aria-label="Close notifications">
              <Icon name="x" size={16} />
            </button>
          </span>
        </div>

        <div className="notif-panel-body">
          {visible.length === 0 && (
            <div className="notif-empty">
              <span className="notif-empty-glyph"><Icon name="bell" size={22} /></span>
              <p className="notif-empty-title">You&rsquo;re all caught up</p>
              <p className="notif-empty-sub">Follow speakers, join communities and set reminders to hear when things happen.</p>
            </div>
          )}
          {fresh.length > 0 && (
            <section>
              <p style={sectionLabel}>New</p>
              {fresh.map(row)}
            </section>
          )}
          {earlier.length > 0 && (
            <section>
              {fresh.length > 0 && <p style={sectionLabel}>Earlier</p>}
              {earlier.map(row)}
            </section>
          )}
        </div>

        <div className="notif-foot">
          <a href="/notifications" className="notif-foot-link">See all notifications →</a>
          {pushState !== "unsupported" && (
            <button
              type="button"
              onClick={onTogglePush}
              disabled={pushState === "busy"}
              className="notif-push"
              title={pushState === "on" ? "Reminders reach this device even with the tab closed" : "Get discussion reminders on this device"}
            >
              <span className="notif-push-label">
                <Icon name="bell" size={13} /> Push reminders on this device
              </span>
              <span className={`notif-switch${pushState === "on" ? " is-on" : ""}`} aria-hidden="true">
                <span className="notif-switch-knob" />
              </span>
            </button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
