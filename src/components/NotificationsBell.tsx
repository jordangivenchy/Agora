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
import {
  actorLabel, notifDetail, notifHref, notifIcon, notifText, timeAgo, type NotifRow,
} from "@/lib/notifications";

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
  debate_replay_ready: "Your discussion replay is ready to watch.",
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
  const [pushState, setPushState] = useState<"unsupported" | "off" | "on" | "busy">("off");
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
          <div className="flex items-center justify-between" style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="m-0 text-[12px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>
              Notifications
              {unread > 0 && (
                <span className="text-[10px] rounded-full" style={{ marginLeft: 8, padding: "2px 7px", background: "rgba(226,185,107,0.18)", color: "#f4d47c", fontWeight: 700 }}>
                  {unread} new
                </span>
              )}
            </p>
            <button
              onClick={markAllRead}
              disabled={unread === 0}
              className="flex items-center gap-1 text-[11px] cursor-pointer bg-transparent border-none"
              style={{ color: unread > 0 ? "#9cc4f0" : "#55555e", fontFamily: "inherit" }}
            >
              <Icon name="check-check" size={12} /> Mark all read
            </button>
          </div>
          {items.length === 0 && (
            <p className="text-[12px] text-center" style={{ margin: 0, padding: "24px 16px", color: "#6b6b74" }}>
              Nothing yet — follow speakers and set reminders to hear when things go live.
            </p>
          )}
          {items.filter((n) => !dismissed.has(n.id)).map((n) => {
            const href = notifHref(n);
            const detail = notifDetail(n);
            const unreadRow = !n.read_at;
            return (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className="w-full text-left flex items-start"
                style={{
                  padding: "10px 14px",
                  gap: 10,
                  background: unreadRow ? "rgba(226,185,107,0.05)" : "transparent",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  cursor: href ? "pointer" : "default",
                  fontFamily: "inherit",
                }}
              >
                <span
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: 26, height: 26, borderRadius: 8, marginTop: 1,
                    background: unreadRow ? "rgba(226,185,107,0.14)" : "rgba(255,255,255,0.06)",
                    color: unreadRow ? "#f4d47c" : "#9a9aa4",
                  }}
                >
                  <Icon name={notifIcon(n.type)} size={13} />
                </span>
                <span className="flex-1 text-[12.5px]" style={{ color: unreadRow ? "#f0f0f4" : "#c4c4cc", lineHeight: 1.45 }}>
                  {n.type === "new_follower" && n.actor_id && followedBack.has(n.actor_id)
                    ? `${actorLabel(n)} started following you`
                    : notifText(n)}
                  {detail && (
                    <span className="block text-[11.5px] truncate" style={{ marginTop: 2, color: "#8b8b94" }}>
                      “{detail}”
                    </span>
                  )}
                  {n.type === "new_follower" && n.actor_id && !followedBack.has(n.actor_id) && (
                    <span className="flex" style={{ gap: 8, marginTop: 6 }}>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const { error } = await supabase.rpc("follow_user", { p_target: n.actor_id });
                          if (!error) setFollowedBack((s) => new Set(s).add(n.actor_id!));
                        }}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-md cursor-pointer"
                        style={{ background: "#7c6ef7", color: "white", border: "none" }}
                      >
                        Accept
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDismissed((s) => new Set(s).add(n.id));
                        }}
                        className="text-[11px] px-2.5 py-1 rounded-md cursor-pointer"
                        style={{ background: "rgba(255,255,255,0.07)", color: "#c9c9d4", border: "1px solid rgba(255,255,255,0.12)" }}
                      >
                        Dismiss
                      </button>
                    </span>
                  )}
                </span>
                <span className="text-[10.5px] shrink-0 flex items-center" style={{ gap: 6, color: "#6b6b74", marginTop: 2 }}>
                  {timeAgo(n.created_at)}
                  {unreadRow && <span style={{ width: 6, height: 6, borderRadius: 3, background: "#f4d47c" }} />}
                </span>
              </button>
            );
          })}
          <a
            href="/notifications"
            className="block w-full text-center text-[11.5px] no-underline"
            style={{ padding: "10px 16px", color: "#9cc4f0", borderTop: "1px solid rgba(255,255,255,0.06)" }}
          >
            See all notifications
          </a>
          {pushState !== "unsupported" && (
            <button
              onClick={togglePush}
              disabled={pushState === "busy"}
              className="w-full text-left text-[11.5px] flex items-center cursor-pointer"
              style={{
                padding: "10px 16px",
                gap: 8,
                background: "transparent",
                border: "none",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                color: pushState === "on" ? "#8fd3a8" : "#9a9aa4",
                fontFamily: "inherit",
              }}
            >
              <span style={{ fontSize: 12 }}>{pushState === "on" ? "●" : "○"}</span>
              {pushState === "busy"
                ? "…"
                : pushState === "on"
                  ? "Push notifications on — reminders reach this device even with the tab closed"
                  : "Enable push notifications for discussion reminders"}
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (container === undefined) return bell;         // inline (React Navbar)
  if (container === null) return null;              // portal target not ready yet
  return createPortal(bell, container);
}
