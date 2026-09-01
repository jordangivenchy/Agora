"use client";

/* /messages — the full-page DM surface. Conversation rail on the left,
   the shared DmThread on the right, on the same starfield glass as the
   dock (which suppresses itself on this route). Deep links land at
   /messages/<username>; picking a thread keeps the URL in step via
   replaceState. Narrow viewports collapse to a single pane. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import useEscapeClose from "@/lib/useEscapeClose";
import { displayName } from "@/lib/names";
import { pathFor } from "@/lib/routes";
import DmThread, {
  type DmThreadHandle,
  type Peer,
  type Thread,
  relTime,
  YELLOW,
  YELLOW_INK,
} from "./DmThread";

const WIDE_MIN = 900;

export default function MessagesPage({ initialUsername }: { initialUsername?: string }) {
  const [supabase] = useState(() => createClient());
  const [me, setMe] = useState<string | null | undefined>(undefined); // undefined = loading
  const [wide, setWide] = useState(true);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [search, setSearch] = useState("");
  const [peer, setPeer] = useState<Peer | null>(null);
  const peerRef = useRef<Peer | null>(null);
  peerRef.current = peer;
  const threadRef = useRef<DmThreadHandle>(null);
  const deepLinkedRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${WIDE_MIN}px)`);
    const apply = () => setWide(mq.matches);
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

  const selectPeer = useCallback((p: Peer | null) => {
    peerRef.current = p;
    setPeer(p);
    window.history.replaceState(null, "", p ? pathFor.messages(p.username) : pathFor.messages());
  }, []);

  useEscapeClose(!!peer, () => {
    if (threadRef.current?.consumeEscape()) return;
    if (!wide) selectPeer(null);
  });

  /* Boot: load threads, then honor the deep link (or land on the top
     conversation in wide mode, like the dock does). */
  useEffect(() => {
    if (!me) return;
    (async () => {
      const ts = await loadThreads();
      if (deepLinkedRef.current || peerRef.current) return;
      deepLinkedRef.current = true;
      /* Trust the live URL over the route param: a Back-restored history
         entry can replay a stale Next tree (older [username] param) while
         the address bar already shows where the user really was. */
      let target = initialUsername ?? null;
      const urlUser = /^\/messages\/([^/]+)/.exec(window.location.pathname)?.[1];
      if (urlUser) {
        try {
          target = decodeURIComponent(urlUser);
        } catch {
          target = urlUser;
        }
      }
      if (target) {
        const uname = target.toLowerCase();
        const t = ts.find((x) => x.peer_username.toLowerCase() === uname);
        if (t) {
          selectPeer({
            id: t.peer_id,
            username: t.peer_username,
            display_name: t.peer_display_name ?? null,
            avatarUrl: t.peer_avatar_url,
          });
          return;
        }
        const { data } = await supabase
          .from("users")
          .select("id, username, display_name, avatar_url")
          .ilike("username", uname.replace(/[\\%_]/g, "\\$&"))
          .maybeSingle();
        if (data) {
          const u = data as { id: string; username: string; display_name: string | null; avatar_url: string | null };
          selectPeer({ id: u.id, username: u.username, display_name: u.display_name, avatarUrl: u.avatar_url });
        }
        /* Unknown user: leave the rail on its placeholder rather than
           silently opening someone else's conversation. */
        return;
      }
      const t = ts[0];
      if (t && window.matchMedia(`(min-width: ${WIDE_MIN}px)`).matches) {
        selectPeer({
          id: t.peer_id,
          username: t.peer_username,
          display_name: t.peer_display_name ?? null,
          avatarUrl: t.peer_avatar_url,
        });
      }
    })();
  }, [me, initialUsername, loadThreads, selectPeer, supabase]);

  /* "Message" buttons anywhere on this page route land here, not in the
     suppressed dock. */
  useEffect(() => {
    const onDm = (e: Event) => {
      const d = (e as CustomEvent).detail as { userId: string; username: string; avatarUrl?: string | null };
      if (!d?.userId) return;
      selectPeer({ id: d.userId, username: d.username, avatarUrl: d.avatarUrl ?? null });
    };
    window.addEventListener("agora:dm", onDm);
    return () => window.removeEventListener("agora:dm", onDm);
  }, [selectPeer]);

  /* Thread-list freshness (per-thread realtime lives inside DmThread;
     unique topic — the browser client is a shared singleton). */
  useEffect(() => {
    if (!me) return;
    const channel = supabase
      .channel("dm-page-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${me}` },
        () => {
          loadThreads();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [me, supabase, loadThreads]);

  const q = search.trim().toLowerCase();
  const visibleThreads = useMemo(
    () =>
      q && threads
        ? threads.filter(
            (t) =>
              t.peer_username.toLowerCase().includes(q) ||
              (t.peer_display_name ?? "").toLowerCase().includes(q)
          )
        : threads ?? [],
    [threads, q]
  );

  if (me === undefined) return null;
  if (me === null) {
    return (
      <div className="messages-beside-sidebar" style={{ paddingTop: 28 }}>
        <div style={{ textAlign: "center", padding: "80px 24px" }}>
          <p style={{ color: "#c9c9d4", fontSize: 14, margin: "0 0 14px" }}>Sign in to see your messages.</p>
          <a
            href="/login"
            className="no-underline"
            style={{
              display: "inline-block",
              padding: "8px 18px",
              borderRadius: 999,
              background: YELLOW,
              color: YELLOW_INK,
              fontWeight: 700,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  const rail = (
    <div
      style={{
        width: wide ? 340 : "100%",
        flexShrink: 0,
        borderRight: wide ? "1px solid rgba(255,255,255,0.08)" : "none",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <h1
          style={{
            margin: "0 0 10px",
            color: "#f5f5f0",
            fontWeight: 700,
            fontSize: 17,
            fontFamily: "'Space Grotesk', sans-serif",
          }}
        >
          Messages
        </h1>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <span
            style={{
              position: "absolute",
              left: 10,
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
              height: 32,
              borderRadius: 9,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)",
              color: "white",
              fontSize: 12.5,
              padding: "0 10px 0 30px",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {threads !== null && threads.length === 0 && (
          <p style={{ color: "#8b8b94", fontSize: 12.5, textAlign: "center", padding: "32px 20px", lineHeight: 1.5 }}>
            No conversations yet. Open a friend&apos;s profile and hit <b>Message</b>, or use your Friend List.
          </p>
        )}
        {threads !== null && threads.length > 0 && visibleThreads.length === 0 && (
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
                gap: 11,
                padding: "11px 14px",
                cursor: "pointer",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                background: active ? "rgba(255,183,0,0.12)" : "transparent",
                borderLeft: active ? `2px solid ${YELLOW}` : "2px solid transparent",
              }}
            >
              <UserAvatar size={44} username={t.peer_username} avatarUrl={t.peer_avatar_url} seed={t.peer_id} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <p
                    style={{
                      margin: 0,
                      flex: 1,
                      minWidth: 0,
                      color: "#f5f5f0",
                      fontSize: 13.5,
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
                    fontSize: 12,
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
    </div>
  );

  return (
    <main className="messages-beside-sidebar" style={{ paddingTop: 24, paddingBottom: 20 }}>
      <div
        style={{
          display: "flex",
          height: "calc(100vh - var(--nav-height, 60px) - 60px)",
          minHeight: 420,
          borderRadius: 18,
          /* Same starfield glass as the dock/friends panel. */
          background: "rgba(9,10,14,0.45)",
          border: "1px solid rgba(255,255,255,0.1)",
          overflow: "hidden",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {(wide || !peer) && rail}
        {peer ? (
          <DmThread
            ref={threadRef}
            me={me}
            peer={peer}
            variant="page"
            topic="page"
            onBack={wide ? undefined : () => selectPeer(null)}
            onThreadsChanged={loadThreads}
          />
        ) : (
          wide && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <p style={{ color: "#8b8b94", fontSize: 13, textAlign: "center", padding: 24 }}>
                {threads !== null && threads.length === 0
                  ? "Your conversations will show up here."
                  : "Pick a conversation."}
              </p>
            </div>
          )
        )}
      </div>
    </main>
  );
}
