"use client";

/* Shared DM thread view — the message scroller (bubbles, reply quotes,
   read receipts), typing indicator, and composer. Rendered by the
   floating MessagesDock ("dock" variant) and the /messages page ("page"
   variant); owns all per-thread data and realtime. The surrounding
   surface owns the thread LIST and passes the open peer down.

   The browser supabase client is a shared singleton, so each surface
   passes a unique `topic` for the thread channel; the typing channel's
   pair topic is deliberately shared — both people must meet on it.

   Escape handling: the parent owns the escape layer and calls
   consumeEscape() (imperative handle) first in its cascade — it closes
   an open picker or cancels a pending reply and reports whether it ate
   the keypress. */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase-browser";
import UserAvatar from "../UserAvatar";
import { displayName } from "@/lib/names";
import { uploadPostImage } from "@/lib/postImages";
import EmojiPicker from "@/components/EmojiPicker";
import GifPicker, { giphyEnabled } from "@/components/community/GifPicker";

export interface Dm {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  image_url: string | null;
  created_at: string;
  reply_to: string | null;
  read_at: string | null;
}

export interface Peer {
  id: string;
  username: string;
  display_name?: string | null;
  avatarUrl: string | null;
}

/* One conversation row from get_dm_threads — shared by both rails
   (dock + /messages page) so they can't drift. */
export interface Thread {
  peer_id: string;
  peer_username: string;
  peer_display_name: string | null;
  peer_avatar_url: string | null;
  last_content: string;
  last_at: string;
  last_from_me: boolean;
  unread: number;
}

export function relTime(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export const DM_SELECT = "id, sender_id, recipient_id, content, image_url, created_at, reply_to, read_at";
export const MAX_DM_IMAGE_BYTES = 5 * 1024 * 1024;

/* Hero accent pair — same as the sidebar active tab / news pill. */
export const YELLOW = "#ffb700";
export const YELLOW_INK = "#1a0e00";

export const dmIconBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  border: "none",
  background: "none",
  color: "rgba(255,255,255,0.6)",
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
};

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function isGif(url: string) {
  return /giphy\.com/i.test(url) || /\.gif(\?|$)/i.test(url);
}

export interface DmThreadHandle {
  /** Close an open picker / cancel a pending reply; true if consumed. */
  consumeEscape: () => boolean;
}

interface Props {
  me: string;
  peer: Peer;
  variant: "dock" | "page";
  /** Unique realtime-topic suffix per surface (shared singleton client). */
  topic: string;
  /** Narrow-mode back arrow (dock + page single-pane). */
  onBack?: () => void;
  /** Dock narrow-mode close button. */
  onClose?: () => void;
  /** Ping the parent to refresh its thread list (send/read/receive). */
  onThreadsChanged: () => void;
}

const DmThread = forwardRef<DmThreadHandle, Props>(function DmThread(
  { me, peer, variant, topic, onBack, onClose, onThreadsChanged },
  ref
) {
  const [supabase] = useState(() => createClient());
  const [msgs, setMsgs] = useState<Dm[]>([]);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | "emoji" | "gif">(null);
  const [replyTo, setReplyTo] = useState<Dm | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  /* The "agora:dm" open path builds a Peer before any thread row exists,
     so the display name may be unknown — hydrated lazily below. */
  const [peerName, setPeerName] = useState<string | null | undefined>(peer.display_name);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const peerIdRef = useRef(peer.id);
  peerIdRef.current = peer.id;
  const typingChanRef = useRef<RealtimeChannel | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef(0);
  const pinnedRef = useRef(true);
  const refetchRef = useRef<(() => void) | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      consumeEscape: () => {
        if (picker) {
          setPicker(null);
          return true;
        }
        if (replyTo) {
          setReplyTo(null);
          return true;
        }
        return false;
      },
    }),
    [picker, replyTo]
  );

  /* ── Load on peer change ─────────────────────────────────────────── */
  useEffect(() => {
    const id = peer.id;
    setMsgs([]);
    setSendError(null);
    setPicker(null);
    setReplyTo(null);
    setPeerTyping(false);
    setPeerName(peer.display_name);
    const load = async () => {
      const { data } = await supabase
        .from("direct_messages")
        .select(DM_SELECT)
        .or(`sender_id.eq.${id},recipient_id.eq.${id}`)
        .order("created_at", { ascending: true })
        .limit(200);
      if (peerIdRef.current !== id) return; // switched away mid-flight
      setMsgs((data ?? []) as Dm[]);
      supabase.rpc("mark_dm_read", { p_peer: id }).then(onThreadsChanged);
    };
    refetchRef.current = load;
    load();
    if (peer.display_name === undefined) {
      supabase
        .from("users")
        .select("display_name")
        .eq("id", id)
        .single()
        .then(({ data: u }) => {
          if (peerIdRef.current !== id) return;
          setPeerName((u as { display_name: string | null } | null)?.display_name ?? null);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer.id, supabase]);

  /* ── Realtime: incoming messages + read receipts ─────────────────── */
  useEffect(() => {
    const channel = supabase
      .channel(`dm-thread-${topic}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${me}` },
        (payload) => {
          const m = payload.new as Dm;
          if (m.sender_id !== peerIdRef.current) return;
          setMsgs((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
          setPeerTyping(false); // the message they were typing just landed
          supabase.rpc("mark_dm_read", { p_peer: m.sender_id }).then(onThreadsChanged);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "direct_messages", filter: `sender_id=eq.${me}` },
        (payload) => {
          /* The peer marked my messages read — light up "Seen". Return
             the SAME array when nothing changed: receipts from other
             threads must not re-render (or re-pin) this one. */
          const m = payload.new as Dm;
          setMsgs((xs) =>
            xs.some((x) => x.id === m.id && x.read_at !== m.read_at)
              ? xs.map((x) => (x.id === m.id ? { ...x, read_at: m.read_at } : x))
              : xs
          );
        }
      )
      .subscribe((status) => {
        /* The history fetch races the channel join: a message committed
           between the fetch's snapshot and the join ack would be missed.
           Refetch once the stream is live (id-dedupe makes overlap safe;
           also heals reconnects). */
        if (status === "SUBSCRIBED") refetchRef.current?.();
      });
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, supabase, topic]);

  /* ── Typing: ephemeral broadcast channel per conversation pair ────
     (deterministic name from the sorted ids — both sides join the same
     one). Carries no content, only "someone's keys are moving"; the
     flag decays after 3.5s of silence. */
  useEffect(() => {
    setPeerTyping(false);
    const name = `dm-typing-${[me, peer.id].sort().join("-")}`;
    const ch = supabase
      .channel(name, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if ((payload as { from?: string } | null)?.from !== peerIdRef.current) return;
        setPeerTyping(true);
        if (typingTimerRef.current !== null) window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = window.setTimeout(() => setPeerTyping(false), 3500);
      })
      .subscribe();
    typingChanRef.current = ch;
    return () => {
      typingChanRef.current = null;
      lastTypingSentRef.current = 0; // fresh channel, fresh throttle
      if (typingTimerRef.current !== null) window.clearTimeout(typingTimerRef.current);
      supabase.removeChannel(ch);
    };
  }, [me, peer.id, supabase]);

  /* ── Pin-to-bottom ────────────────────────────────────────────────
     Keyed on the LAST MESSAGE ID, not array identity — read-receipt
     merges rebuild the array without adding messages and must not yank
     a reader who scrolled up. When composer chrome (reply chip, typing
     strip, image preview) grows while pinned, re-pin after layout. */
  const lastMsgId = msgs.length ? msgs[msgs.length - 1].id : null;
  useEffect(() => {
    pinnedRef.current = true;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lastMsgId]);
  useLayoutEffect(() => {
    if (pinnedRef.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [replyTo, peerTyping, filePreview]);

  /* Auto-grow the composer up to ~4 lines. */
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    /* border-box: scrollHeight excludes the 1px borders, so add them back
       or a one-line draft overflows by 2px and grows a scrollbar. Only
       allow scrolling once the draft exceeds the 4-line cap. */
    const MAX = 4 * 20 + 14 + 2;
    ta.style.height = "auto";
    const full = ta.scrollHeight + 2;
    ta.style.height = `${Math.min(full, MAX)}px`;
    ta.style.overflowY = full > MAX ? "auto" : "hidden";
  }, [draft, peer.id]);

  const clearFile = useCallback(() => {
    setFile(null);
    setFilePreview((cur) => {
      if (cur) URL.revokeObjectURL(cur);
      return null;
    });
  }, []);

  const sendMessage = useCallback(
    async (text: string, imageUrl: string | null, replyToId: string | null = null) => {
      setSendError(null);
      const { data, error } = await supabase
        .from("direct_messages")
        .insert({ sender_id: me, recipient_id: peer.id, content: text, image_url: imageUrl, reply_to: replyToId })
        .select(DM_SELECT)
        .single();
      if (error) {
        setSendError(
          error.code === "42501"
            ? "You can only message friends — you both need to follow each other."
            : `Couldn't send — ${error.message || "try again."}`
        );
        return false;
      }
      setMsgs((xs) => (xs.some((x) => x.id === (data as Dm).id) ? xs : [...xs, data as Dm]));
      onThreadsChanged();
      return true;
    },
    [me, peer.id, supabase, onThreadsChanged]
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !file) || sending) return;
    setSending(true);
    setSendError(null);
    let imageUrl: string | null = null;
    if (file) {
      try {
        imageUrl = await uploadPostImage(supabase, me, file);
      } catch (e) {
        setSending(false);
        setSendError(e instanceof Error ? e.message : "Image upload failed.");
        return;
      }
    }
    const ok = await sendMessage(text, imageUrl, replyTo?.id ?? null);
    setSending(false);
    if (ok) {
      setDraft("");
      setReplyTo(null);
      clearFile();
      taRef.current?.focus();
    }
  }, [draft, file, me, sending, supabase, sendMessage, clearFile, replyTo]);

  const pickFile = useCallback(
    (f: File | null) => {
      clearFile();
      if (!f) return;
      if (f.size > MAX_DM_IMAGE_BYTES) {
        setSendError("Image is too large — keep it under 5 MB.");
        return;
      }
      setSendError(null);
      setFile(f);
      setFilePreview(URL.createObjectURL(f));
    },
    [clearFile]
  );

  const insertAtCaret = useCallback((s: string) => {
    const ta = taRef.current;
    setDraft((cur) => {
      if (!ta) return cur + s;
      const start = ta.selectionStart ?? cur.length;
      const end = ta.selectionEnd ?? start;
      const next = cur.slice(0, start) + s + cur.slice(end);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + s.length, start + s.length);
      });
      return next;
    });
  }, []);

  const canSend = !sending && (draft.trim().length > 0 || !!file);

  /* "Seen" goes under my newest message, and only once the peer has
     read it (read_at set by their mark_dm_read, streamed back live). */
  let lastMineReadId: string | null = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].sender_id === me) {
      lastMineReadId = msgs[i].read_at ? msgs[i].id : null;
      break;
    }
  }

  const page = variant === "page";
  const hydratedPeer = { ...peer, display_name: peerName === undefined ? peer.display_name : peerName };

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Thread header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: page ? "12px 16px" : onBack ? "10px 14px" : "8px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          minHeight: page ? 56 : 46,
          flexShrink: 0,
        }}
      >
        {onBack && (
          <button onClick={onBack} style={dmIconBtn} aria-label="Back to conversations">
            <Icon name="arrow-left" size={15} />
          </button>
        )}
        <a
          href={`/users/${peer.username}`}
          style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, textDecoration: "none" }}
          title="View profile"
        >
          <UserAvatar size={page ? 40 : 32} username={peer.username} avatarUrl={peer.avatarUrl} seed={peer.id} />
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block",
                color: "#f5f5f0",
                fontWeight: 600,
                fontSize: page ? 14.5 : 13,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {displayName(hydratedPeer)}
            </span>
            <span style={{ display: "block", color: "#8b8b94", fontSize: page ? 11.5 : 11, lineHeight: 1.2 }}>
              @{peer.username}
            </span>
          </span>
        </a>
        {onClose && (
          <button onClick={onClose} style={{ ...dmIconBtn, marginLeft: "auto" }} aria-label="Close messages">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
        }}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: page ? "14px 18px" : "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {msgs.length === 0 && (
          <p style={{ color: "#8b8b94", fontSize: 12, textAlign: "center", marginTop: 24 }}>
            Say hi to @{peer.username} 👋
          </p>
        )}
        {msgs.map((m) => {
          const mine = m.sender_id === me;
          const hasText = m.content.trim().length > 0;
          const quoted = m.reply_to ? msgs.find((x) => x.id === m.reply_to) ?? null : null;
          return (
            <div key={m.id} style={{ display: "contents" }}>
              <div
                id={`dm-msg-${m.id}`}
                className="dm-msg-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexDirection: mine ? "row-reverse" : "row",
                  alignSelf: mine ? "flex-end" : "flex-start",
                  maxWidth: page ? "72%" : "85%",
                }}
              >
                <div
                  style={{
                    padding: m.image_url ? 4 : "7px 11px",
                    borderRadius: mine ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                    background: mine ? YELLOW : "rgba(30,33,42,0.88)",
                    color: mine ? YELLOW_INK : "#f2f2f5",
                    fontSize: 13,
                    lineHeight: 1.35,
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                    minWidth: 0,
                  }}
                  title={fmtTime(m.created_at)}
                >
                  {m.reply_to && (
                    <div
                      onClick={() => {
                        document
                          .getElementById(`dm-msg-${m.reply_to}`)
                          ?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      style={{
                        margin: m.image_url ? "3px 7px 4px" : "0 0 5px",
                        padding: "3px 8px",
                        borderLeft: `2px solid ${mine ? "rgba(0,0,0,0.4)" : YELLOW}`,
                        borderRadius: 6,
                        background: mine ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.06)",
                        cursor: quoted ? "pointer" : "default",
                        fontSize: 11,
                        lineHeight: 1.3,
                        overflow: "hidden",
                      }}
                    >
                      <span style={{ display: "block", fontWeight: 700, opacity: 0.8 }}>
                        {quoted ? (quoted.sender_id === me ? "You" : displayName(hydratedPeer)) : "Earlier message"}
                      </span>
                      {quoted && (
                        <span
                          style={{
                            display: "block",
                            opacity: 0.75,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {quoted.content.trim() ||
                            (quoted.image_url ? (isGif(quoted.image_url) ? "GIF" : "Photo") : "")}
                        </span>
                      )}
                    </div>
                  )}
                  {m.image_url && (
                    <a href={m.image_url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.image_url}
                        alt={isGif(m.image_url) ? "GIF" : "Photo"}
                        style={{
                          display: "block",
                          maxWidth: page ? 300 : 220,
                          maxHeight: page ? 320 : 260,
                          borderRadius: 9,
                          objectFit: "cover",
                        }}
                      />
                    </a>
                  )}
                  {hasText && <div style={{ padding: m.image_url ? "5px 7px 3px" : 0 }}>{m.content}</div>}
                </div>
                <button
                  className="dm-reply-btn"
                  onClick={() => {
                    setReplyTo(m);
                    taRef.current?.focus();
                  }}
                  aria-label="Reply to this message"
                  title="Reply"
                  style={{
                    width: 24,
                    height: 24,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "none",
                    background: "none",
                    color: "rgba(255,255,255,0.45)",
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <Icon name="text-quote" size={13} />
                </button>
              </div>
              {m.id === lastMineReadId && (
                <span style={{ alignSelf: "flex-end", color: "#8b8b94", fontSize: 10.5, marginTop: -3 }}>Seen</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Typing indicator — lives outside the scroller so it doesn't
          retrigger the auto-scroll effect. */}
      <div
        style={{
          height: peerTyping ? 20 : 0,
          overflow: "hidden",
          transition: "height 0.15s ease",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: page ? "0 18px" : "0 14px",
          flexShrink: 0,
        }}
        aria-live="polite"
      >
        {peerTyping && (
          <>
            <span style={{ display: "inline-flex", gap: 3 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="dm-typing-dot"
                  style={{ width: 4, height: 4, borderRadius: "50%", background: YELLOW, display: "inline-block" }}
                />
              ))}
            </span>
            <span style={{ color: "#8b8b94", fontSize: 11 }}>@{peer.username} is typing…</span>
          </>
        )}
      </div>

      {sendError && <p style={{ margin: 0, padding: "6px 12px", color: "#ff9d92", fontSize: 11.5 }}>{sendError}</p>}

      {/* Composer */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: page ? "10px 14px" : "8px 10px", flexShrink: 0 }}>
        {replyTo && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
              padding: "4px 8px",
              borderLeft: `2px solid ${YELLOW}`,
              borderRadius: 6,
              background: "rgba(255,183,0,0.08)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.3 }}>
              <span style={{ display: "block", color: "#c9c9d4", fontWeight: 700 }}>
                Replying to {replyTo.sender_id === me ? "yourself" : displayName(hydratedPeer)}
              </span>
              <span
                style={{
                  display: "block",
                  color: "#8b8b94",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {replyTo.content.trim() || (replyTo.image_url ? (isGif(replyTo.image_url) ? "GIF" : "Photo") : "")}
              </span>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              style={{
                width: 20,
                height: 20,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                background: "none",
                color: "rgba(255,255,255,0.5)",
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
              }}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        )}
        {filePreview && (
          <div style={{ position: "relative", display: "inline-block", marginBottom: 6 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={filePreview} alt="" style={{ height: 56, borderRadius: 8, display: "block" }} />
            <button
              onClick={clearFile}
              aria-label="Remove image"
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                width: 18,
                height: 18,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "#1a1c24",
                color: "white",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
              }}
            >
              <Icon name="x" size={10} />
            </button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              /* Throttled "keys are moving" ping for the peer's typing
                 indicator; carries only my id, never content. */
              const now = Date.now();
              if (
                e.target.value &&
                now - lastTypingSentRef.current > 2000 &&
                typingChanRef.current?.state === "joined"
              ) {
                lastTypingSentRef.current = now;
                typingChanRef.current.send({ type: "broadcast", event: "typing", payload: { from: me } });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message…"
            rows={1}
            autoFocus
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 34,
              maxHeight: 96,
              overflowY: "hidden",
              resize: "none",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "white",
              fontSize: 13,
              lineHeight: "20px",
              padding: "7px 12px",
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button
              onClick={() => setPicker(picker === "emoji" ? null : "emoji")}
              style={{ ...dmIconBtn, color: picker === "emoji" ? YELLOW : dmIconBtn.color }}
              aria-label="Add emoji"
              title="Emoji"
            >
              <Icon name="smile" size={17} />
            </button>
            {picker === "emoji" && (
              <EmojiPicker align="right" vertical="above" onPick={insertAtCaret} onClose={() => setPicker(null)} />
            )}
          </span>
          <label style={{ ...dmIconBtn, cursor: "pointer" }} aria-label="Attach image" title="Image">
            <Icon name="image" size={17} />
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                pickFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
          {giphyEnabled && (
            <span style={{ position: "relative", display: "inline-flex" }}>
              <button
                onClick={() => setPicker(picker === "gif" ? null : "gif")}
                style={{
                  ...dmIconBtn,
                  width: "auto",
                  padding: "0 6px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: picker === "gif" ? YELLOW : dmIconBtn.color,
                }}
                aria-label="Add a GIF"
                title="GIF"
              >
                GIF
              </button>
              {picker === "gif" && (
                <GifPicker
                  placement="above"
                  align="right"
                  onPick={async (u) => {
                    setPicker(null);
                    const ok = await sendMessage("", u, replyTo?.id ?? null);
                    if (ok) setReplyTo(null);
                  }}
                  onClose={() => setPicker(null)}
                />
              )}
            </span>
          )}
          <button
            onClick={send}
            disabled={!canSend}
            aria-label="Send"
            style={{
              ...dmIconBtn,
              background: canSend ? YELLOW : "rgba(255,183,0,0.3)",
              color: canSend ? YELLOW_INK : "rgba(255,255,255,0.55)",
              cursor: canSend ? "pointer" : "default",
            }}
          >
            <Icon name="send" size={15} />
          </button>
        </div>
      </div>
    </div>
  );
});

export default DmThread;
