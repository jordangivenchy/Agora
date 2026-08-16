"use client";

/* Notification bell — the delivery surface for the notifications backend
   (20260814 + 20260819 migrations: new_follower, room_live,
   room_starting_soon; realtime-published, RLS-scoped to the owner).

   Used two ways:
   - <NotificationsBell />                   → inline (React Navbar)
   - <NotificationsBell container={el} />    → portal (MVP homepage navbar)

   Delivery: the dropdown lists the latest 30 with an unread badge;
   opening it marks everything read. A realtime INSERT subscription keeps
   the badge live and, when the user has granted permission (asked the
   first time they open the bell), raises an OS notification so go-live
   and starting-soon events reach them even in another tab. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import useEscapeClose from "@/lib/useEscapeClose";

interface Props {
  container?: HTMLElement | null;
}

type NotifRow = {
  id: string;
  type: string;
  actor_id: string | null;
  actor_username: string | null;
  room_id: string | null;
  room_motion: string | null;
  read_at: string | null;
  created_at: string;
};

function notifText(n: NotifRow): string {
  switch (n.type) {
    case "new_follower":
      return `${n.actor_username ?? "Someone"} started following you`;
    case "room_live":
      return `${n.actor_username ?? "A speaker"} is live: “${n.room_motion ?? "a discussion"}”`;
    case "room_starting_soon":
      return `Starting soon: “${n.room_motion ?? "a discussion"}”`;
    default:
      return "New activity";
  }
}

function notifHref(n: NotifRow): string | null {
  if (n.room_id && (n.type === "room_live" || n.type === "room_starting_soon")) return `/agora/${n.room_id}`;
  if (n.actor_id && n.type === "new_follower") return `/?profile=${n.actor_id}`;
  return null;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function NotificationsBell({ container }: Props) {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<NotifRow[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEscapeClose(open, () => setOpen(false));

  const unread = items.filter((n) => !n.read_at).length;

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id ?? null;
    setUserId(uid);
    if (!uid) return;
    const { data } = await supabase.rpc("get_notifications", { p_limit: 30 });
    setItems((data ?? []) as NotifRow[]);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  /* Realtime: RLS scopes the stream to my own rows. Re-load on insert so
     the actor/room names come joined; raise an OS notification when
     permitted (delivery beyond the current tab). */
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel("notif-bell")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          load();
          const row = payload.new as { type?: string; room_id?: string };
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            const body =
              row.type === "room_starting_soon" ? "A discussion you set a reminder for starts soon."
              : row.type === "room_live" ? "A discussion you follow just went live."
              : "You have a new follower.";
            const n = new Notification("AgoraSphere", { body });
            n.onclick = () => {
              window.focus();
              if (row.room_id) window.location.href = `/agora/${row.room_id}`;
            };
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, supabase, load]);

  /* Click-away closes the dropdown. */
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    // First open doubles as the browser-notification permission ask —
    // it's a user gesture, so the prompt is allowed.
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    if (unread > 0) {
      supabase.rpc("mark_notifications_read");
      setItems((xs) => xs.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    }
  }, [open, unread, supabase]);

  if (!userId) return null;

  const bell = (
    <div ref={wrapRef} style={{ position: "relative", fontFamily: "'DM Sans', sans-serif" }}>
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className="cursor-pointer flex items-center justify-center"
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: open ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)",
          border: "1px solid " + (unread > 0 ? "rgba(226,185,107,0.5)" : "rgba(255,255,255,0.12)"),
          color: unread > 0 ? "#f4d47c" : "#c0c0c8",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              borderRadius: 8,
              background: "linear-gradient(135deg,#f7e3a0,#d9a238)",
              color: "#412402",
              fontSize: 10,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 10px)",
            width: 330,
            maxHeight: 420,
            overflowY: "auto",
            background: "rgba(12,12,18,0.97)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 14,
            boxShadow: "0 12px 36px rgba(0,0,0,0.55)",
            backdropFilter: "blur(18px)",
            zIndex: 300,
          }}
        >
          <p className="m-0 px-4 py-3 text-[12px]" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#f5f5f0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            Notifications
          </p>
          {items.length === 0 && (
            <p className="m-0 px-4 py-6 text-[12px] text-center" style={{ color: "#6b6b74" }}>
              Nothing yet — follow speakers and set reminders to hear when things go live.
            </p>
          )}
          {items.map((n) => {
            const href = notifHref(n);
            return (
              <button
                key={n.id}
                onClick={() => { if (href) window.location.href = href; }}
                className="w-full text-left px-4 py-3 flex items-start gap-2.5"
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  cursor: href ? "pointer" : "default",
                  fontFamily: "inherit",
                }}
              >
                <span className="text-[13px]" style={{ marginTop: 1 }}>
                  {n.type === "new_follower" ? "👤" : n.type === "room_starting_soon" ? "🔔" : "🔴"}
                </span>
                <span className="flex-1 text-[12.5px]" style={{ color: "#d5d5dc", lineHeight: 1.45 }}>
                  {notifText(n)}
                </span>
                <span className="text-[10.5px] shrink-0" style={{ color: "#6b6b74", marginTop: 2 }}>
                  {timeAgo(n.created_at)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  if (container === undefined) return bell;         // inline (React Navbar)
  if (container === null) return null;              // portal target not ready yet
  return createPortal(bell, container);
}
