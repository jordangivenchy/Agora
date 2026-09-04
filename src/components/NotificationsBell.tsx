"use client";

/* Notification bell — the delivery surface for the notifications backend
   (20260814 → 20260852 migrations; realtime-published, RLS-scoped to the
   owner). Copy / icons / hrefs live in src/lib/notifications.ts, shared
   with the /notifications page.

   Used two ways:
   - <NotificationsBell />                   → inline (React Navbar)
   - <NotificationsBell container={el} />    → portal (MVP homepage navbar)

   Delivery: the dropdown lists the latest 30 with an unread badge;
   opening it marks everything read. A realtime INSERT subscription keeps
   the badge live and, when the user has granted permission (asked the
   first time they open the bell), raises an OS notification so go-live
   and starting-soon events reach them even in another tab. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import useEscapeClose from "@/lib/useEscapeClose";
import { notifHref, type NotifRow } from "@/lib/notifications";
import NotificationsPanel, { type PushState } from "@/components/notifications/NotificationsPanel";

interface Props {
  container?: HTMLElement | null;
}

/* VAPID public key (base64url) → the BufferSource pushManager wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/* One-line OS-notification bodies per type (the realtime payload carries
   no joined names, so these stay generic). */
const OS_BODY: Record<string, string> = {
  room_starting_soon: "A discussion you set a reminder for starts soon.",
  room_live: "A discussion you set a reminder for just went live.",
  followed_live: "Someone you follow just went live.",
  followed_scheduled: "Someone you follow scheduled a discussion.",
  debate_replay_ready: "Your replay is ready to watch.",
  join_request: "Someone applied to join your community.",
  join_approved: "Your community application was approved.",
  discussion_opened: "Someone opened the comment thread on your discussion.",
  friend_accepted: "Friend request accepted — you're now friends.",
  room_invite: "A friend invited you to a room.",
  community_post: "New post in a community you joined.",
  community_debate: "A discussion was started in your community.",
  mention: "Someone mentioned you in a thread.",
  post_comment: "Someone commented on your post.",
  post_reply: "Someone replied to your comment.",
  post_upvotes: "Your post hit an upvote milestone.",
  comment_upvotes: "Your comment hit an upvote milestone.",
  repost: "Someone reposted your post.",
  new_follower: "Someone wants to be your friend.",
};

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

  const unread = items.filter((n) => !n.read_at).length;

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id ?? null;
    setUserId(uid);
    if (!uid) return;
    const { data } = await supabase.rpc("get_notifications", { p_limit: 30, p_before: null });
    const rows = (data ?? []) as NotifRow[];
    setItems(rows);
    const actorIds = [...new Set(rows.filter((n) => n.type === "new_follower" && n.actor_id).map((n) => n.actor_id!))];
    if (actorIds.length) {
      const { data: follows } = await supabase
        .from("user_follows")
        .select("following_id")
        .eq("follower_id", uid)
        .in("following_id", actorIds);
      setFollowedBack(new Set(((follows ?? []) as { following_id: string }[]).map((f) => f.following_id)));
    }
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
          const row = payload.new as { type?: string; room_id?: string; post_id?: string };
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            const body = OS_BODY[row.type ?? ""] ?? "New activity on AgoraSphere.";
            const n = new Notification("AgoraSphere", { body });
            n.onclick = () => {
              window.focus();
              if (row.post_id) window.location.href = `/posts/${row.post_id}`;
              else if (row.room_id) window.location.href = `/agora/${row.room_id}`;
            };
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { load(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, supabase, load]);

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

  const openItem = useCallback(
    (n: NotifRow) => {
      const href = notifHref(n);
      if (!n.read_at) {
        setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
        supabase.rpc("mark_notification_read", { p_id: n.id });
      }
      if (href) window.location.href = href;
    },
    [supabase]
  );

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
          background: open ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)",
          border: "1px solid " + (unread > 0 ? "rgba(226,185,107,0.5)" : "rgba(255,255,255,0.12)"),
          color: unread > 0 ? "#f4d47c" : "#c0c0c8",
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
        onAccept={async (n) => {
          const { error } = await supabase.rpc("follow_user", { p_target: n.actor_id });
          if (!error && n.actor_id) setFollowedBack((s) => new Set(s).add(n.actor_id!));
        }}
        onDismiss={(n) => setDismissed((s) => new Set(s).add(n.id))}
        onTogglePush={togglePush}
      />
    </div>
  );

  if (container === undefined) return bell;         // inline (React Navbar)
  if (container === null) return null;              // portal target not ready yet
  return createPortal(bell, container);
}
