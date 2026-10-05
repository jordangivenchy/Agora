"use client";

/* Notification bell — the delivery surface for the notifications backend
   (20260814 → 20260852 migrations; realtime-published, RLS-scoped to the
   owner). Copy / icons / hrefs live in src/lib/notifications.ts, shared
   with the /notifications page.

   Used two ways:
   - <NotificationsBell />                   → inline (React Navbar)
   - <NotificationsBell container={el} />    → portal (MVP homepage navbar)

   Delivery: the dropdown lists the latest 30 with an unread badge;
   opening it marks everything read. A realtime subscription keeps the
   badge live and announces what lands: while you're on the page, as a
   pop-up under the bell (NotificationToasts); while you're away from it
   — another tab, another app — as a system notification, once you've
   allowed them (asked the first time you open the bell). Both say who
   and what, and both open what they're about. */

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import useEscapeClose from "@/lib/useEscapeClose";
import { notifHref, type NotifRow } from "@/lib/notifications";
import { OPEN_NOTIFICATION, raiseSystemAlert } from "@/lib/notifAlerts";
import NotificationsPanel, { type PushState } from "@/components/notifications/NotificationsPanel";
import NotificationToasts, { type Toast } from "@/components/notifications/NotificationToasts";
import { sessionUser } from "@/lib/session";
import { goTo } from "@/lib/softNav";

interface Props {
  container?: HTMLElement | null;
}

/* VAPID public key (base64url) → the BufferSource pushManager wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/* Pop-ups up at once; another sends the oldest on its way. */
const TOAST_LIMIT = 3;

export default function NotificationsBell({ container }: Props) {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<NotifRow[]>([]);
  const [followedBack, setFollowedBack] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  /* Where the popover hangs on desktop (the panel is portaled to body). */
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEscapeClose(open, () => setOpen(false));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [toastAnchor, setToastAnchor] = useState<DOMRect | null>(null);
  /* Each row as last seen, id → created_at: a grouped row that grows
     ("… and 2 others") comes back unread with a new time. */
  const seen = useRef(new Map<string, string>());

  const unread = items.filter((n) => !n.read_at).length;

  const load = useCallback(async (): Promise<NotifRow[]> => {
    const { data: auth } = await sessionUser(supabase);
    const uid = auth?.user?.id ?? null;
    setUserId(uid);
    if (!uid) return [];
    const { data } = await supabase.rpc("get_notifications", { p_limit: 30, p_before: null });
    const rows = (data ?? []) as NotifRow[];
    setItems(rows);
    for (const r of rows) seen.current.set(r.id, r.created_at);
    const actorIds = [...new Set(rows.filter((n) => n.type === "new_follower" && n.actor_id).map((n) => n.actor_id!))];
    if (actorIds.length) {
      const { data: follows } = await supabase
        .from("user_follows")
        .select("following_id")
        .eq("follower_id", uid)
        .in("following_id", actorIds);
      setFollowedBack(new Set(((follows ?? []) as { following_id: string }[]).map((f) => f.following_id)));
    }
    return rows;
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  /* Web-push: reminders reach closed tabs. State reflects whether THIS
     browser holds a live subscription. */
  const [pushState, setPushState] = useState<PushState>("off");
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported");
      return;
    }
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setPushState(sub ? "on" : "off"))
      .catch(() => setPushState("off"));
  }, []);

  const togglePush = useCallback(async () => {
    if (pushState === "busy" || pushState === "unsupported") return;
    const wasOn = pushState === "on";
    setPushState("busy");
    try {
      if (wasOn) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await fetch("/api/push/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          }).catch(() => {});
          await sub.unsubscribe();
        }
        setPushState("off");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setPushState("off");
        return;
      }
      const keyRes = await fetch("/api/push/vapid");
      if (!keyRes.ok) {
        setPushState("off");
        return;
      }
      const { publicKey } = await keyRes.json();
      const reg = await navigator.serviceWorker.register("/push-sw.js");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      const saved = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys }),
      });
      setPushState(saved.ok ? "on" : "off");
      if (!saved.ok) await sub.unsubscribe();
    } catch {
      setPushState(wasOn ? "on" : "off");
    }
  }, [pushState]);

  const markRead = useCallback(
    (id: string) => {
      setItems((xs) => xs.map((x) => (x.id === id && !x.read_at ? { ...x, read_at: new Date().toISOString() } : x)));
      supabase.rpc("mark_notification_read", { p_id: id });
    },
    [supabase]
  );

  const openItem = useCallback(
    (n: NotifRow) => {
      const href = notifHref(n);
      if (!n.read_at) markRead(n.id);
      if (href) goTo(href);
    },
    [markRead]
  );

  const accept = useCallback(
    async (n: NotifRow) => {
      const { error } = await supabase.rpc("follow_user", { p_target: n.actor_id });
      if (!error && n.actor_id) setFollowedBack((s) => new Set(s).add(n.actor_id!));
    },
    [supabase]
  );

  /* Pop-ups: a new one on top (a grouped row that grew takes its own
     place again, its time started over); past the limit, the oldest
     goes. Closing one lets it fade before it's taken away
     (NotificationToasts). */
  const showToast = useCallback((n: NotifRow) => {
    setToastAnchor(wrapRef.current?.getBoundingClientRect() ?? null);
    setToasts((ts) => {
      if (ts.some((t) => t.n.id === n.id)) return ts.map((t) => (t.n.id === n.id ? { n, leaving: false } : t));
      let kept = 0;
      return [{ n, leaving: false }, ...ts].map((t) => (t.leaving || ++kept <= TOAST_LIMIT ? t : { ...t, leaving: true }));
    });
  }, []);
  const closeToast = useCallback((id: string) => {
    setToasts((ts) => ts.map((t) => (t.n.id === id ? { ...t, leaving: true } : t)));
  }, []);
  const dropToast = useCallback((id: string) => {
    setToasts((ts) => ts.filter((t) => t.n.id !== id || !t.leaving));
  }, []);
  useEffect(() => {
    if (!toasts.length) return;
    const measure = () => setToastAnchor(wrapRef.current?.getBoundingClientRect() ?? null);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [toasts.length]);

  /* Something new for you: a pop-up if you're looking at this page (not
     with the list open — it's in there — nor with a room lying over the
     page), a system notification if you're not (another tab, another
     app in front). */
  const announce = useEffectEvent((n: NotifRow) => {
    const looking = document.visibilityState === "visible";
    const roomOver = document.documentElement.classList.contains("agora-covered");
    if (looking && !open && !roomOver) showToast(n);
    if (!document.hasFocus()) void raiseSystemAlert(n, openItem);
  });

  /* Realtime: RLS scopes the stream to my own rows. Re-load on each
     change so names come joined; announce rows that are new, and
     grouped rows that grew (an update that moves an unread row's time —
     not marking read, nor the push dispatcher stamping it sent). */
  useEffect(() => {
    if (!userId) return;
    const arrived = async (id: string) => {
      const rows = await load();
      const n = rows.find((r) => r.id === id);
      if (n && !n.read_at) announce(n);
    };
    const channel = supabase
      .channel("notif-bell")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          void arrived((payload.new as { id: string }).id);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { id: string; read_at: string | null; created_at: string };
          const was = seen.current.get(row.id);
          if (!row.read_at && was !== undefined && was !== row.created_at) void arrived(row.id);
          else load();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, supabase, load]);

  /* A click on a system notification, handed to this tab by the worker
     (which waits to hear it was taken, or opens a tab of its own): there
     in the page, so a call carries on minimized, and it's read. */
  const openFromAlert = useEffectEvent((url: string | null, id: string | null) => {
    if (id) markRead(id);
    if (url) goTo(url);
  });
  useEffect(() => {
    if (!userId || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string | null; id?: string | null } | null;
      if (d?.type !== OPEN_NOTIFICATION) return;
      e.ports[0]?.postMessage("opened");
      openFromAlert(d.url ?? null, d.id ?? null);
    };
    sw.addEventListener("message", onMessage);
    sw.startMessages();
    return () => sw.removeEventListener("message", onMessage);
  }, [userId]);

  /* The panel's scrim handles click-away; keep its anchor honest while
     the window resizes. */
  useEffect(() => {
    if (!open) return;
    const measure = () => setAnchor(wrapRef.current?.getBoundingClientRect() ?? null);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  const toggle = useCallback(async () => {
    const next = !open;
    setAnchor(wrapRef.current?.getBoundingClientRect() ?? null);
    setOpen(next);
    if (!next) return;
    /* The list has them all now. */
    setToasts((ts) => ts.map((t) => (t.leaving ? t : { ...t, leaving: true })));
    // First open doubles as the browser-notification permission ask —
    // it's a user gesture, so the prompt is allowed.
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [open]);

  const markAllRead = useCallback(async () => {
    if (unread === 0) return;
    setItems((xs) => xs.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    await supabase.rpc("mark_all_notifications_read");
  }, [unread, supabase]);

  if (!userId) return null;

  const bell = (
    <div ref={wrapRef} style={{ position: "relative", fontFamily: "'DM Sans', sans-serif" }}>
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className="notif-bell-btn cursor-pointer flex items-center justify-center"
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: open ? "#18181c" : "#0b0b0d",
          border: "1px solid " + (unread > 0 ? "#ffb700" : "#26262c"),
          color: unread > 0 ? "#ffb700" : "#c0c0c8",
        }}
      >
        <Icon name="bell" size={16} />
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
              background: "#ffb700",
              color: "#1a0e00",
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

      <NotificationsPanel
        open={open}
        anchor={anchor}
        items={items}
        unread={unread}
        followedBack={followedBack}
        dismissed={dismissed}
        pushState={pushState}
        onClose={() => setOpen(false)}
        onMarkAllRead={markAllRead}
        onOpen={openItem}
        onAccept={accept}
        onDismiss={(n) => setDismissed((s) => new Set(s).add(n.id))}
        onTogglePush={togglePush}
      />

      <NotificationToasts
        toasts={toasts}
        anchor={toastAnchor}
        followedBack={followedBack}
        onOpen={(n) => { closeToast(n.id); openItem(n); }}
        onAccept={(n) => { closeToast(n.id); void accept(n); }}
        onClose={closeToast}
        onGone={dropToast}
      />
    </div>
  );

  if (container === undefined) return bell;         // inline (React Navbar)
  if (container === null) return null;              // portal target not ready yet
  return createPortal(bell, container);
}
