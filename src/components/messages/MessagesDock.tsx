"use client";

/* Direct messages dock — a floating panel (bottom-right, above the AI
   assistant bubble) with a conversation list and a thread view. Mounted
   once in the root layout so DMs work on every page.

   Opens via the navbar Messages button (window event "agora:messages")
   or straight into a thread from anywhere ("agora:dm" with a user).
   Messages are friends-only, enforced by RLS — a rejected send shows an
   explanatory note instead of the message. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import UserAvatar from "../UserAvatar";
import useEscapeClose from "@/lib/useEscapeClose";

interface Thread {
  peer_id: string;
  peer_username: string;
  peer_avatar_url: string | null;
  last_content: string;
  last_at: string;
  last_from_me: boolean;
  unread: number;
}

interface Dm {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  created_at: string;
}

interface Peer {
  id: string;
  username: string;
  avatarUrl: string | null;
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  right: 84,
  bottom: 20,
  width: 330,
  height: 460,
  zIndex: 950,
  display: "flex",
  flexDirection: "column",
  borderRadius: 16,
  background: "rgba(10,12,18,0.97)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
  backdropFilter: "blur(18px)",
  overflow: "hidden",
  fontFamily: "'DM Sans', sans-serif",
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function MessagesDock() {
  const [supabase] = useState(() => createClient());
  const [me, setMe] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [msgs, setMsgs] = useState<Dm[]>([]);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const peerRef = useRef<Peer | null>(null);
  peerRef.current = peer;

  useEscapeClose(open, () => (peer ? setPeer(null) : setOpen(false)));

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => setMe(s?.user?.id ?? null));
    return () => subscription.unsubscribe();
  }, [supabase]);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase.rpc("get_dm_threads");
    setThreads((data ?? []) as Thread[]);
  }, [supabase]);

  const loadThread = useCallback(
    async (p: Peer) => {
      const { data } = await supabase
        .from("direct_messages")
        .select("id, sender_id, recipient_id, content, created_at")
        .or(`sender_id.eq.${p.id},recipient_id.eq.${p.id}`)
        .order("created_at", { ascending: true })
        .limit(200);
      setMsgs((data ?? []) as Dm[]);
      supabase.rpc("mark_dm_read", { p_peer: p.id }).then(loadThreads);
    },
    [supabase, loadThreads]
  );

  /* Open events from anywhere in the app. */
  useEffect(() => {
    const onMessages = () => {
      setOpen(true);
      setPeer(null);
      loadThreads();
    };
    const onDm = (e: Event) => {
      const d = (e as CustomEvent).detail as { userId: string; username: string; avatarUrl?: string | null };
      if (!d?.userId) return;
      setOpen(true);
      setSendError(null);
      const p = { id: d.userId, username: d.username, avatarUrl: d.avatarUrl ?? null };
      setPeer(p);
      setMsgs([]);
      loadThread(p);
    };
    window.addEventListener("agora:messages", onMessages);
    window.addEventListener("agora:dm", onDm);
    return () => {
      window.removeEventListener("agora:messages", onMessages);
      window.removeEventListener("agora:dm", onDm);
    };
  }, [loadThreads, loadThread]);

  /* Incoming messages in realtime (RLS scopes the stream to my rows). */
  useEffect(() => {
    if (!me) return;
    loadThreads();
    const channel = supabase
      .channel("dm-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${me}` },
        (payload) => {
          const m = payload.new as Dm;
          const p = peerRef.current;
          if (p && m.sender_id === p.id) {
            setMsgs((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
            supabase.rpc("mark_dm_read", { p_peer: p.id });
          }
          loadThreads();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [me, supabase, loadThreads]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !me || !peer) return;
    setDraft("");
    setSendError(null);
    const { data, error } = await supabase
      .from("direct_messages")
      .insert({ sender_id: me, recipient_id: peer.id, content: text })
      .select("id, sender_id, recipient_id, content, created_at")
      .single();
    if (error) {
      setDraft(text);
      setSendError(
        error.code === "42501"
          ? "You can only message friends — you both need to follow each other."
          : "Couldn't send — try again."
      );
      return;
    }
    setMsgs((xs) => [...xs, data as Dm]);
    loadThreads();
  }, [draft, me, peer, supabase, loadThreads]);

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

  if (!me || !open) return null;

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {peer ? (
          <>
            <button
              onClick={() => {
                setPeer(null);
                setSendError(null);
                loadThreads();
              }}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 14 }}
              aria-label="Back to conversations"
            >
              ←
            </button>
            <UserAvatar size={22} username={peer.username} avatarUrl={peer.avatarUrl} seed={peer.id} />
            <span style={{ color: "#f5f5f0", fontWeight: 600, fontSize: 13.5 }}>{peer.username}</span>
          </>
        ) : (
          <span style={{ color: "#f5f5f0", fontWeight: 700, fontSize: 14, fontFamily: "'Space Grotesk', sans-serif" }}>
            Messages{totalUnread > 0 ? ` (${totalUnread})` : ""}
          </span>
        )}
        <button
          onClick={() => setOpen(false)}
          style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 14 }}
          aria-label="Close messages"
        >
          ✕
        </button>
      </div>

      {peer ? (
        <>
          {/* Thread */}
          <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            {msgs.length === 0 && (
              <p style={{ color: "#8b8b94", fontSize: 12, textAlign: "center", marginTop: 24 }}>
                Say hi to @{peer.username} 👋
              </p>
            )}
            {msgs.map((m) => {
              const mine = m.sender_id === me;
              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: mine ? "flex-end" : "flex-start",
                    maxWidth: "80%",
                    padding: "7px 11px",
                    borderRadius: mine ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                    background: mine ? "#4a5fd0" : "rgba(255,255,255,0.07)",
                    color: "#f2f2f5",
                    fontSize: 13,
                    lineHeight: 1.35,
                    wordBreak: "break-word",
                  }}
                  title={fmtTime(m.created_at)}
                >
                  {m.content}
                </div>
              );
            })}
          </div>
          {sendError && (
            <p style={{ margin: 0, padding: "6px 12px", color: "#ff9d92", fontSize: 11.5 }}>{sendError}</p>
          )}
          <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Message…"
              autoFocus
              style={{
                flex: 1,
                height: 34,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "white",
                fontSize: 13,
                padding: "0 12px",
                outline: "none",
              }}
            />
            <button
              onClick={send}
              disabled={!draft.trim()}
              style={{
                height: 34,
                padding: "0 14px",
                borderRadius: 10,
                border: "none",
                background: draft.trim() ? "#7c6ef7" : "rgba(124,110,247,0.35)",
                color: "white",
                fontSize: 13,
                fontWeight: 600,
                cursor: draft.trim() ? "pointer" : "default",
              }}
            >
              Send
            </button>
          </div>
        </>
      ) : (
        /* Conversation list */
        <div style={{ flex: 1, overflowY: "auto" }}>
          {threads.length === 0 && (
            <p style={{ color: "#8b8b94", fontSize: 12.5, textAlign: "center", padding: "28px 18px" }}>
              No conversations yet. Open a friend&apos;s menu and hit <b>Message</b>, or use your Friend List.
            </p>
          )}
          {threads.map((t) => (
            <div
              key={t.peer_id}
              onClick={() => {
                const p = { id: t.peer_id, username: t.peer_username, avatarUrl: t.peer_avatar_url };
                setPeer(p);
                setSendError(null);
                setMsgs([]);
                loadThread(p);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                cursor: "pointer",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <UserAvatar size={30} username={t.peer_username} avatarUrl={t.peer_avatar_url} seed={t.peer_id} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, color: "#f5f5f0", fontSize: 13, fontWeight: t.unread > 0 ? 700 : 500 }}>
                  {t.peer_username}
                </p>
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
                    background: "#7c6ef7",
                    color: "white",
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
          ))}
        </div>
      )}
    </div>
  );
}
