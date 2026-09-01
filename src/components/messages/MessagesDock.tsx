"use client";

/* Direct messages dock — a floating panel (bottom-right) with a
   conversation list; the thread view itself is the shared DmThread
   (also used by the /messages page). Mounted once in the root layout so
   quick replies work on every page — EXCEPT /messages, where the
   full-page surface takes over and the dock suppresses itself.

   Wide viewports (≥ 760px) get a two-pane layout — conversation list on
   the left, thread on the right. Narrow viewports fall back to a single
   pane with a back arrow.

   Opens straight into a thread from anywhere via the "agora:dm" window
   event (profile Message buttons, the Friends panel, user menus); the
   navbar Messages button goes to the /messages page. Messages are
   friends-only, enforced by RLS. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase-browser";
import UserAvatar from "../UserAvatar";
import useEscapeClose from "@/lib/useEscapeClose";
import { displayName } from "@/lib/names";
import DmThread, {
  type DmThreadHandle,
  type Peer,
  type Thread,
  dmIconBtn,
  relTime,
  YELLOW,
  YELLOW_INK,
} from "./DmThread";

const WIDE_MIN = 760;
const LIST_WIDTH = 210;

const panelBase: React.CSSProperties = {
  position: "fixed",
  right: 84,
  bottom: 20,
  zIndex: 950,
  display: "flex",
  flexDirection: "column",
  borderRadius: 18,
  /* Light unblurred tint, like the friends panel: the starfield stays
     visible through the glass (blur would smear the stars away). Bubbles
     carry their own near-solid backgrounds so text survives whatever is
     behind the panel. */
  background: "rgba(9,10,14,0.45)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
  overflow: "hidden",
  fontFamily: "'DM Sans', sans-serif",
};

export default function MessagesDock() {
  const [supabase] = useState(() => createClient());
  const [me, setMe] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [wide, setWide] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [search, setSearch] = useState("");
  const [peer, setPeer] = useState<Peer | null>(null);
  const peerRef = useRef<Peer | null>(null);
  peerRef.current = peer;
  const wideRef = useRef(false);
  const threadRef = useRef<DmThreadHandle>(null);
  const closeTimerRef = useRef<number | null>(null);

  /* The /messages page is the full-size surface; the dock stands down
     there (its badge effect keeps running — the component stays
     mounted). */
  const pathname = usePathname();
  const onMessagesRoute = pathname === "/messages" || !!pathname?.startsWith("/messages/");
  const onMessagesRouteRef = useRef(onMessagesRoute);
  onMessagesRouteRef.current = onMessagesRoute;
  useEffect(() => {
    if (onMessagesRoute && open) {
      setOpen(false);
      setClosing(false);
      setPeer(null);
      peerRef.current = null;
    }
  }, [onMessagesRoute, open]);

  /* Close plays the panel's exit animation, then unmounts. */
  const closeDock = useCallback(() => {
    if (closeTimerRef.current !== null) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setClosing(false);
      setOpen(false);
      /* Leave no thread "open" behind the closed dock — a mounted thread
         would keep auto-marking its messages read, showing the sender a
         false "Seen" for messages nobody saw. */
      setPeer(null);
      peerRef.current = null;
    }, 150);
  }, []);
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    []
  );

  useEscapeClose(open, () => {
    if (closing) return; // exit animation already in flight
    if (threadRef.current?.consumeEscape()) return; // picker / pending reply
    if (peer && !wide) setPeer(null);
    else closeDock();
  });

  /* Layout mode tracks the viewport. */
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${WIDE_MIN}px)`);
    const apply = () => {
      wideRef.current = mq.matches;
      setWide(mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => setMe(s?.user?.id ?? null));
    return () => subscription.unsubscribe();
  }, [supabase]);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase.rpc("get_dm_threads");
    const ts = (data ?? []) as Thread[];
    setThreads(ts);
    return ts;
  }, [supabase]);

  const selectPeer = useCallback((p: Peer) => {
    peerRef.current = p;
    setPeer(p);
  }, []);

  /* Open events from anywhere in the app. */
  useEffect(() => {
    const cancelClosing = () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setClosing(false);
    };
    const onDm = (e: Event) => {
      const d = (e as CustomEvent).detail as { userId: string; username: string; avatarUrl?: string | null };
      if (!d?.userId) return;
      if (onMessagesRouteRef.current) return; // the page listens for this itself
      cancelClosing();
      setOpen(true);
      loadThreads();
      selectPeer({ id: d.userId, username: d.username, avatarUrl: d.avatarUrl ?? null });
    };
    window.addEventListener("agora:dm", onDm);
    return () => {
      window.removeEventListener("agora:dm", onDm);
    };
  }, [loadThreads, selectPeer]);

  /* Thread-list freshness + navbar badge while the dock is closed. The
     open thread's own appends/mark-read live inside DmThread. */
  useEffect(() => {
    if (!me) return;
    loadThreads();
    const channel = supabase
      .channel("dm-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${me}` },
        () => {
          loadThreads();
        }
      )
      .on(
        "postgres_changes",
        /* read_at flips on my received rows when *I* mark threads read —
           on the /messages page or in another tab — so the badge and the
           list previews clear everywhere, not just in this dock. */
        { event: "UPDATE", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${me}` },
        () => {
          loadThreads();
        }
      )
      .on(
        "postgres_changes",
        /* Unsend anywhere refreshes previews (DELETE events can't be
           filtered — old rows carry only the PK — so this over-fires;
           get_dm_threads is cheap). */
        { event: "DELETE", schema: "public", table: "direct_messages" },
        () => {
          loadThreads();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [me, supabase, loadThreads]);

  const totalUnread = threads.reduce((n, t) => n + Number(t.unread), 0);

  /* Unread badge on the navbar Messages button (MVP markup, homepage) —
     kept in sync even while the dock is closed, so DMs are never silent. */
  useEffect(() => {
    const btn = document.getElementById("nav-messages-btn");
    if (!btn) return;
    let badge = btn.querySelector<HTMLElement>(".nav-dm-badge");
    if (totalUnread > 0 && me) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-dm-badge";
        btn.appendChild(badge);
      }
      badge.textContent = totalUnread > 9 ? "9+" : String(totalUnread);
    } else {
      badge?.remove();
    }
  }, [totalUnread, me]);

  const q = search.trim().toLowerCase();
  const visibleThreads = useMemo(
    () =>
      q
        ? threads.filter(
            (t) =>
              t.peer_username.toLowerCase().includes(q) ||
              (t.peer_display_name ?? "").toLowerCase().includes(q)
          )
        : threads,
    [threads, q]
  );

  if (!me || !open || onMessagesRoute) return null;

  /* ── Conversation list ─────────────────────────────────────────── */
  const threadList = (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
      {threads.length === 0 && (
        <p style={{ color: "#8b8b94", fontSize: 12.5, textAlign: "center", padding: "28px 18px" }}>
          No conversations yet. Open a friend&apos;s menu and hit <b>Message</b>, or use your Friend List.
        </p>
      )}
      {threads.length > 0 && visibleThreads.length === 0 && (
        <p style={{ color: "#8b8b94", fontSize: 12.5, textAlign: "center", padding: "28px 18px" }}>No matches.</p>
      )}
      {visibleThreads.map((t) => {
        const active = peer?.id === t.peer_id;
        return (
          <div
            key={t.peer_id}
            onClick={() => {
              if (active) return;
              selectPeer({
                id: t.peer_id,
                username: t.peer_username,
                display_name: t.peer_display_name ?? null,
                avatarUrl: t.peer_avatar_url,
              });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: wide ? "9px 10px" : "10px 14px",
              cursor: "pointer",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              background: active ? "rgba(255,183,0,0.12)" : "transparent",
              borderLeft: active ? `2px solid ${YELLOW}` : "2px solid transparent",
            }}
          >
            <UserAvatar size={40} username={t.peer_username} avatarUrl={t.peer_avatar_url} seed={t.peer_id} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <p
                  style={{
                    margin: 0,
                    flex: 1,
                    minWidth: 0,
                    color: "#f5f5f0",
                    fontSize: 13,
                    fontWeight: t.unread > 0 ? 700 : 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {displayName({ display_name: t.peer_display_name, username: t.peer_username })}
                </p>
                <span style={{ color: "#6f6f7a", fontSize: 10.5, flexShrink: 0 }}>{relTime(t.last_at)}</span>
              </div>
              <p
                style={{
                  margin: 0,
                  color: t.unread > 0 ? "#c9c9d4" : "#8b8b94",
                  fontSize: 11.5,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {t.last_from_me ? "You: " : ""}
                {t.last_content}
              </p>
            </div>
            {t.unread > 0 && (
              <span
                style={{
                  background: YELLOW,
                  color: YELLOW_INK,
                  borderRadius: 999,
                  fontSize: 10.5,
                  fontWeight: 700,
                  minWidth: 18,
                  height: 18,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 5px",
                }}
              >
                {t.unread}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  const searchField = (
    <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <span
          style={{
            position: "absolute",
            left: 9,
            display: "inline-flex",
            alignItems: "center",
            color: "rgba(255,255,255,0.4)",
            pointerEvents: "none",
          }}
        >
          <Icon name="search" size={13} />
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
          style={{
            width: "100%",
            boxSizing: "border-box",
            height: 30,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.05)",
            color: "white",
            fontSize: 12.5,
            lineHeight: "28px",
            padding: search ? "0 28px 0 28px" : "0 10px 0 28px",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            aria-label="Clear search"
            style={{
              position: "absolute",
              right: 4,
              width: 22,
              height: 22,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "none",
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              padding: 0,
              borderRadius: 6,
            }}
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
    </div>
  );

  /* ── Layout ────────────────────────────────────────────────────────
     ONE tree for both breakpoints, with keyed children, so crossing
     760px never remounts DmThread (a remount would wipe the draft, a
     pending reply, and an attached image). Wide: header + list + pane.
     Narrow: header + list, or the pane alone (its own back/close). */
  const showList = wide || !peer;
  return (
    <div
      className={`dm-dock-panel${closing ? " dm-dock-closing" : ""}`}
      style={{ ...panelBase, width: wide ? 600 : 330, height: wide ? 480 : 460 }}
    >
      {showList && (
        <div
          key="header"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              color: "#f5f5f0",
              fontWeight: 700,
              fontSize: 14,
              fontFamily: "'Space Grotesk', sans-serif",
              flexShrink: 0,
            }}
          >
            Messages{totalUnread > 0 ? ` (${totalUnread})` : ""}
          </span>
          <a
            href="/messages"
            aria-label="Open full messages page"
            title="Open full page"
            style={{ ...dmIconBtn, marginLeft: "auto", textDecoration: "none" }}
          >
            <Icon name="arrow-up-right" size={14} />
          </a>
          <button onClick={closeDock} style={dmIconBtn} aria-label="Close messages">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      <div key="body" style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {showList && (
          <div
            key="list"
            style={{
              width: wide ? LIST_WIDTH : "100%",
              flexShrink: 0,
              borderRight: wide ? "1px solid rgba(255,255,255,0.08)" : "none",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            {searchField}
            {threadList}
          </div>
        )}
        {peer ? (
          <DmThread
            key="thread"
            ref={threadRef}
            me={me}
            peer={peer}
            variant="dock"
            topic="dock"
            onBack={
              wide
                ? undefined
                : () => {
                    setPeer(null);
                    loadThreads();
                  }
            }
            onClose={wide ? undefined : closeDock}
            onThreadsChanged={loadThreads}
          />
        ) : (
          wide && (
            <div key="empty" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <p style={{ color: "#8b8b94", fontSize: 12.5, textAlign: "center", padding: 24 }}>
                {threads.length === 0 ? "Your conversations will show up here." : "Pick a conversation."}
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
