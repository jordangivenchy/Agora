"use client";

/* /notifications — the full list behind the bell. Same RPC as the bell
   (get_notifications, keyset-paginated on created_at), filter chips
   All · Mentions · Debates · Posts, "Mark all read", realtime refresh.
   Rendered inside the same shell the standalone profile route uses
   (wordmark header + the homepage glass sidebar on lg+). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { pathFor } from "@/lib/routes";
import { Icon } from "@/components/icons";
import Wordmark from "@/components/Wordmark";
import UserAvatar from "@/components/UserAvatar";
import {
  actorLabel, matchesFilter, notifDetail, notifHref, notifIcon, notifText, timeAgo,
  type NotifFilter, type NotifRow,
} from "@/lib/notifications";

/* mvp-home.css is imported inside the sidebar; keep it client-only so the
   route stays free of it on the server. */
const HomeSidebar = dynamic(() => import("@/components/HomeSidebar"), { ssr: false });

const PAGE = 30;

const FILTERS: { id: NotifFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mentions", label: "Mentions" },
  { id: "debates", label: "Discussions" },
  { id: "posts", label: "Posts" },
];

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  if (now.getTime() - d.getTime() < 7 * 86_400_000) return "This week";
  return "Earlier";
}

export default function NotificationsPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [items, setItems] = useState<NotifRow[]>([]);
  const [filter, setFilter] = useState<NotifFilter>("all");
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);
  const [busyMore, setBusyMore] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback(
    async (before: string | null): Promise<NotifRow[]> => {
      const { data } = await supabase.rpc("get_notifications", { p_limit: PAGE, p_before: before });
      return (data ?? []) as NotifRow[];
    },
    [supabase]
  );

  const reload = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id ?? null;
    setUserId(uid);
    if (!uid) { setLoading(false); return; }
    const rows = await fetchPage(null);
    setItems(rows);
    setMore(rows.length === PAGE);
    setLoading(false);
  }, [supabase, fetchPage]);

  useEffect(() => { reload(); }, [reload]);

  const loadMore = useCallback(async () => {
    if (busyMore || !more || items.length === 0) return;
    setBusyMore(true);
    const last = items[items.length - 1].created_at;
    const rows = await fetchPage(last);
    setItems((xs) => {
      const seen = new Set(xs.map((x) => x.id));
      return [...xs, ...rows.filter((r) => !seen.has(r.id))];
    });
    setMore(rows.length === PAGE);
    setBusyMore(false);
  }, [busyMore, more, items, fetchPage]);

  /* Infinite scroll: the sentinel at the bottom pulls the next page. */
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, more]);

  /* Realtime: any insert/update on my rows → refetch the first page
     (coalesced rows move to the top when they update). */
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel("notif-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { fetchPage(null).then((rows) => setItems((xs) => {
          const ids = new Set(rows.map((r) => r.id));
          return [...rows, ...xs.filter((x) => !ids.has(x.id))];
        })); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, supabase, fetchPage]);

  const unread = items.filter((n) => !n.read_at).length;

  const markAllRead = useCallback(async () => {
    if (unread === 0) return;
    const now = new Date().toISOString();
    setItems((xs) => xs.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    await supabase.rpc("mark_all_notifications_read");
  }, [unread, supabase]);

  const open = useCallback(
    (n: NotifRow) => {
      const href = notifHref(n);
      if (!n.read_at) {
        setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
        supabase.rpc("mark_notification_read", { p_id: n.id });
      }
      if (href) router.push(href);
    },
    [supabase, router]
  );

  const visible = useMemo(() => items.filter((n) => matchesFilter(n.type, filter)), [items, filter]);

  const groups = useMemo(() => {
    const out: { label: string; rows: NotifRow[] }[] = [];
    for (const n of visible) {
      const label = dayLabel(n.created_at);
      const g = out[out.length - 1];
      if (g && g.label === label) g.rows.push(n);
      else out.push({ label, rows: [n] });
    }
    return out;
  }, [visible]);

  if (userId === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: "var(--bg-primary, #0a0a0c)" }}>
        <Wordmark size={24} />
        <p style={{ color: "#8b8b94", fontFamily: "'DM Sans', sans-serif" }}>Sign in to see your notifications.</p>
        <Link href="/" style={{ color: "#9cc4f0", fontFamily: "'DM Sans', sans-serif", fontSize: 14 }}>← Back to the Agora</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary, #0a0a0c)", fontFamily: "'DM Sans', sans-serif" }}>
      <div className="flex items-center justify-between px-6 py-4">
        <Link href="/" className="no-underline"><Wordmark size={20} /></Link>
        <Link href="/" style={{ color: "#8b8b94", fontSize: 13, textDecoration: "none" }}>← Back to the Agora</Link>
      </div>

      <div className="hidden lg:block">
        <HomeSidebar activeId={null} onNavigate={(id) => router.push(pathFor.section(id))} />
      </div>

      <main className="max-w-[860px] mx-auto px-6 pb-16 profile-beside-sidebar">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
          <div>
            <h1 className="m-0 text-[22px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>
              Notifications
            </h1>
            <p className="m-0 mt-1 text-[12.5px]" style={{ color: "#8b8b94" }}>
              {unread > 0 ? `${unread} unread` : "You're all caught up"}
              {" · "}
              <Link href="/settings" style={{ color: "#9cc4f0", textDecoration: "none" }}>Preferences</Link>
            </p>
          </div>
          <button
            onClick={markAllRead}
            disabled={unread === 0}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg cursor-pointer"
            style={{
              background: unread > 0 ? "rgba(255,255,255,0.07)" : "transparent",
              border: "1px solid rgba(255,255,255,0.12)",
              color: unread > 0 ? "#e8e8ee" : "#55555e",
              fontFamily: "inherit",
            }}
          >
            <Icon name="check-check" size={13} /> Mark all read
          </button>
        </div>

        <div className="flex gap-2 mb-5 flex-wrap">
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className="text-[12.5px] px-3.5 py-1.5 rounded-full cursor-pointer"
                style={{
                  background: on ? "rgba(226,185,107,0.16)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${on ? "rgba(226,185,107,0.45)" : "rgba(255,255,255,0.1)"}`,
                  color: on ? "#f4d47c" : "#b8b8c2",
                  fontWeight: on ? 600 : 500,
                  fontFamily: "inherit",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {loading && (
          <div className="py-20 flex justify-center">
            <div className="animate-spin" style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid #3b6cf6", borderTopColor: "transparent" }} />
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div
            className="py-16 px-6 text-center"
            style={{ background: "rgba(18,18,24,0.92)", border: "0.5px solid #2e2e38", borderRadius: 14 }}
          >
            <span className="inline-flex items-center justify-center mb-3" style={{ width: 44, height: 44, borderRadius: 14, background: "rgba(255,255,255,0.06)", color: "#8b8b94" }}>
              <Icon name="bell" size={20} />
            </span>
            <p className="m-0 text-[14px]" style={{ color: "#d5d5dc" }}>
              {filter === "all" ? "Nothing yet" : `No ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} yet`}
            </p>
            <p className="m-0 mt-1 text-[12.5px]" style={{ color: "#6b6b74" }}>
              Follow speakers, join communities and set reminders to hear when things happen.
            </p>
          </div>
        )}

        {groups.map((g) => (
          <section key={g.label} className="mb-5">
            <p className="m-0 mb-2 text-[11px] uppercase tracking-wider" style={{ color: "#6b6b74", fontWeight: 600 }}>
              {g.label}
            </p>
            <div style={{ background: "rgba(18,18,24,0.92)", border: "0.5px solid #2e2e38", borderRadius: 14, overflow: "hidden" }}>
              {g.rows.map((n, i) => {
                const href = notifHref(n);
                const detail = notifDetail(n);
                const unreadRow = !n.read_at;
                return (
                  <button
                    key={n.id}
                    onClick={() => open(n)}
                    className="w-full text-left px-4 py-3.5 flex items-start gap-3"
                    style={{
                      background: unreadRow ? "rgba(226,185,107,0.05)" : "transparent",
                      border: "none",
                      borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                      cursor: href ? "pointer" : "default",
                      fontFamily: "inherit",
                    }}
                  >
                    <span className="relative shrink-0">
                      {n.actor_id ? (
                        <UserAvatar username={n.actor_username ?? "?"} avatarUrl={n.actor_avatar_url} size={36} />
                      ) : (
                        <span className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 12, background: "rgba(255,255,255,0.06)", color: "#c0c0c8" }}>
                          <Icon name={notifIcon(n.type)} size={16} />
                        </span>
                      )}
                      <span
                        className="absolute flex items-center justify-center"
                        style={{
                          right: -5, bottom: -5, width: 18, height: 18, borderRadius: 6,
                          background: unreadRow ? "#e2b96b" : "#2a2a33",
                          color: unreadRow ? "#2a1a00" : "#a0a0aa",
                          border: "2px solid #121218",
                        }}
                      >
                        <Icon name={notifIcon(n.type)} size={9} strokeWidth={2.5} />
                      </span>
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px]" style={{ color: unreadRow ? "#f5f5f0" : "#c9c9d1", lineHeight: 1.45 }}>
                        {n.type === "new_follower" ? `${actorLabel(n)} wants to be your friend` : notifText(n)}
                      </span>
                      {detail && (
                        <span className="block mt-1 text-[12px] truncate" style={{ color: "#8b8b94" }}>
                          “{detail}”
                        </span>
                      )}
                      {n.community_name && (n.type === "post_comment" || n.type === "post_reply" || n.type === "repost" || n.type === "post_upvotes") && (
                        <span className="block mt-1 text-[11px]" style={{ color: "#6b6b74" }}>in {n.community_name}</span>
                      )}
                    </span>
                    <span className="shrink-0 flex items-center gap-2 text-[11px]" style={{ color: "#6b6b74", marginTop: 3 }}>
                      {timeAgo(n.created_at)}
                      {unreadRow && <span style={{ width: 7, height: 7, borderRadius: 4, background: "#f4d47c" }} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <div ref={sentinel} />
        {more && !loading && items.length > 0 && (
          <div className="flex justify-center py-4">
            <button
              onClick={loadMore}
              disabled={busyMore}
              className="text-[12.5px] px-4 py-2 rounded-lg cursor-pointer"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#d5d5dc", fontFamily: "inherit" }}
            >
              {busyMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
