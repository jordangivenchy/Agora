"use client";

/* Direct messages dock — a floating panel (bottom-right, above the AI
   assistant bubble) with a conversation list and a thread view. Mounted
   once in the root layout so DMs work on every page.

   Wide viewports (≥ 760px) get a two-pane layout — conversation list on
   the left, thread on the right — so users can hop between threads
   without leaving one. Narrow viewports fall back to a single pane with
   a back arrow.

   Opens via the navbar Messages button (window event "agora:messages")
   or straight into a thread from anywhere ("agora:dm" with a user).
   Messages are friends-only, enforced by RLS — a rejected send shows an
   explanatory note instead of the message.

   Media: images upload to the post-images bucket (the uploader's own
   folder, same as community posts) and GIPHY picks store the CDN URL;
   both land in direct_messages.image_url (migration 20260848). */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase-browser";
import UserAvatar from "../UserAvatar";
import useEscapeClose from "@/lib/useEscapeClose";
import { displayName } from "@/lib/names";
import { uploadPostImage } from "@/lib/postImages";
import EmojiPicker from "@/components/EmojiPicker";
import GifPicker, { giphyEnabled } from "@/components/community/GifPicker";

interface Thread {
  peer_id: string;
  peer_username: string;
  peer_display_name: string | null;
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
  image_url: string | null;
  created_at: string;
  reply_to: string | null;
  read_at: string | null;
}

interface Peer {
  id: string;
  username: string;
  display_name?: string | null;
  avatarUrl: string | null;
}

const DM_SELECT = "id, sender_id, recipient_id, content, image_url, created_at, reply_to, read_at";
const WIDE_MIN = 760;
const MAX_DM_IMAGE_BYTES = 5 * 1024 * 1024;
const LIST_WIDTH = 210;

/* Hero accent pair — same as the sidebar active tab / news pill. */
const YELLOW = "#ffb700";
const YELLOW_INK = "#1a0e00";

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

const iconBtn: React.CSSProperties = {
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

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function relTime(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function isGif(url: string) {
  return /giphy\.com/i.test(url) || /\.gif(\?|$)/i.test(url);
}

export default function MessagesDock() {
  const [supabase] = useState(() => createClient());
  const [me, setMe] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [search, setSearch] = useState("");
  const [peer, setPeer] = useState<Peer | null>(null);
  const [msgs, setMsgs] = useState<Dm[]>([]);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | "emoji" | "gif">(null);
  const [replyTo, setReplyTo] = useState<Dm | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [closing, setClosing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const peerRef = useRef<Peer | null>(null);
  peerRef.current = peer;
  const wideRef = useRef(false);
  const typingChanRef = useRef<RealtimeChannel | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef(0);
  const closeTimerRef = useRef<number | null>(null);

  /* Close plays the panel's exit animation, then unmounts. */
  const closeDock = useCallback(() => {
    if (closeTimerRef.current !== null) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setClosing(false);
      setOpen(false);
      /* Leave no thread "open" behind the closed dock — the inbox
         listener would keep auto-marking its messages read, showing the
         sender a false "Seen" for messages nobody saw. */
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
    if (picker) {
      setPicker(null);
      return;
    }
    if (replyTo) {
      setReplyTo(null);
      return;
    }
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

  const loadThread = useCallback(
    async (p: Peer) => {
      const { data } = await supabase
        .from("direct_messages")
        .select(DM_SELECT)
        .or(`sender_id.eq.${p.id},recipient_id.eq.${p.id}`)
        .order("created_at", { ascending: true })
        .limit(200);
      // A faster thread switch may have happened while this was in flight.
      if (peerRef.current?.id !== p.id) return;
      setMsgs((data ?? []) as Dm[]);
      /* The "agora:dm" open-DM path constructs a Peer before any thread row
         exists, so the display name isn't known yet — fetch it lazily. */
      if (p.display_name === undefined) {
        supabase
          .from("users")
          .select("display_name")
          .eq("id", p.id)
          .single()
          .then(({ data: u }) => {
            const dn = (u as { display_name: string | null } | null)?.display_name ?? null;
            setPeer((cur) => (cur && cur.id === p.id ? { ...cur, display_name: dn } : cur));
          });
      }
      supabase.rpc("mark_dm_read", { p_peer: p.id }).then(loadThreads);
    },
    [supabase, loadThreads]
  );

  const clearFile = useCallback(() => {
    setFile(null);
    setFilePreview((cur) => {
      if (cur) URL.revokeObjectURL(cur);
      return null;
    });
  }, []);

  const selectPeer = useCallback(
    (p: Peer) => {
      peerRef.current = p; // so an in-flight loadThread for an older peer is discarded
      setPeer(p);
      setSendError(null);
      setPicker(null);
      setReplyTo(null);
      setPeerTyping(false);
      setMsgs([]);
      loadThread(p);
    },
    [loadThread]
  );

  /* Open events from anywhere in the app. */
  useEffect(() => {
    const cancelClosing = () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setClosing(false);
    };
    const onMessages = async () => {
      cancelClosing();
      setOpen(true);
      setPeer(null);
      peerRef.current = null;
      const ts = await loadThreads();
      /* Wide mode: land on the top conversation so the right pane isn't
         empty. (Narrow mode shows the list, as before.) */
      const t = ts[0];
      if (t && wideRef.current && !peerRef.current) {
        selectPeer({
          id: t.peer_id,
          username: t.peer_username,
          display_name: t.peer_display_name ?? null,
          avatarUrl: t.peer_avatar_url,
        });
      }
    };
    const onDm = (e: Event) => {
      const d = (e as CustomEvent).detail as { userId: string; username: string; avatarUrl?: string | null };
      if (!d?.userId) return;
      cancelClosing();
      setOpen(true);
      loadThreads();
      selectPeer({ id: d.userId, username: d.username, avatarUrl: d.avatarUrl ?? null });
    };
    window.addEventListener("agora:messages", onMessages);
    window.addEventListener("agora:dm", onDm);
    return () => {
      window.removeEventListener("agora:messages", onMessages);
      window.removeEventListener("agora:dm", onDm);
    };
  }, [loadThreads, selectPeer]);

  /* Incoming messages + read receipts in realtime (RLS scopes both
     streams to my rows). */
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
            setPeerTyping(false); // the message they were typing just landed
            supabase.rpc("mark_dm_read", { p_peer: p.id });
          }
          loadThreads();
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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [me, supabase, loadThreads]);

  /* Typing indicator: an ephemeral broadcast channel per conversation
     pair (deterministic name from the sorted ids — both sides join the
     same one). Carries no content, only "someone's keys are moving";
     the flag decays after 3.5s of silence. */
  useEffect(() => {
    setPeerTyping(false);
    if (!me || !peer?.id || !open) return;
    const name = `dm-typing-${[me, peer.id].sort().join("-")}`;
    const ch = supabase
      .channel(name, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if ((payload as { from?: string } | null)?.from !== peerRef.current?.id) return;
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
  }, [me, peer?.id, open, supabase]);

  /* Pin-to-bottom. Keyed on the LAST MESSAGE ID, not array identity —
     read-receipt merges rebuild the array without adding messages and
     must not yank a reader who scrolled up. Separately: when composer
     chrome (reply chip, typing strip, image preview) grows while the
     list is pinned, re-pin after layout so the newest message doesn't
     slide behind it. */
  const pinnedRef = useRef(true);
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
  }, [draft, peer]);

  const sendMessage = useCallback(
    async (text: string, imageUrl: string | null, replyToId: string | null = null) => {
      if (!me || !peer) return false;
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
      loadThreads();
      return true;
    },
    [me, peer, supabase, loadThreads]
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !file) || !me || !peer || sending) return;
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
  }, [draft, file, me, peer, sending, supabase, sendMessage, clearFile, replyTo]);

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

  if (!me || !open) return null;

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

  /* ── Thread pane ───────────────────────────────────────────────── */
  const threadPane = peer && (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Thread header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: wide ? "8px 12px" : "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          minHeight: 46,
        }}
      >
        {!wide && (
          <button
            onClick={() => {
              setPeer(null);
              setSendError(null);
              setPicker(null);
              loadThreads();
            }}
            style={iconBtn}
            aria-label="Back to conversations"
          >
            <Icon name="arrow-left" size={15} />
          </button>
        )}
        <a
          href={`/users/${peer.username}`}
          style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, textDecoration: "none" }}
          title="View profile"
        >
          <UserAvatar size={32} username={peer.username} avatarUrl={peer.avatarUrl} seed={peer.id} />
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block",
                color: "#f5f5f0",
                fontWeight: 600,
                fontSize: 13,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {displayName(peer)}
            </span>
            <span style={{ display: "block", color: "#8b8b94", fontSize: 11, lineHeight: 1.2 }}>@{peer.username}</span>
          </span>
        </a>
        {!wide && (
          <button onClick={closeDock} style={{ ...iconBtn, marginLeft: "auto" }} aria-label="Close messages">
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
        style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}
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
                  maxWidth: "85%",
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
                        {quoted ? (quoted.sender_id === me ? "You" : displayName(peer)) : "Earlier message"}
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
                        style={{ display: "block", maxWidth: 220, maxHeight: 260, borderRadius: 9, objectFit: "cover" }}
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
          padding: "0 14px",
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
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: "8px 10px" }}>
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
                Replying to {replyTo.sender_id === me ? "yourself" : displayName(peer)}
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
                typingChanRef.current?.state === "joined" &&
                me
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
              style={{ ...iconBtn, color: picker === "emoji" ? YELLOW : iconBtn.color }}
              aria-label="Add emoji"
              title="Emoji"
            >
              <Icon name="smile" size={17} />
            </button>
            {picker === "emoji" && (
              <EmojiPicker align="right" vertical="above" onPick={insertAtCaret} onClose={() => setPicker(null)} />
            )}
          </span>
          <label style={{ ...iconBtn, cursor: "pointer" }} aria-label="Attach image" title="Image">
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
                  ...iconBtn,
                  width: "auto",
                  padding: "0 6px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: picker === "gif" ? YELLOW : iconBtn.color,
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
              ...iconBtn,
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

  /* ── Layouts ───────────────────────────────────────────────────── */
  if (wide) {
    return (
      <div className={`dm-dock-panel${closing ? " dm-dock-closing" : ""}`} style={{ ...panelBase, width: 600, height: 480 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
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
          <button onClick={closeDock} style={{ ...iconBtn, marginLeft: "auto" }} aria-label="Close messages">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <div
            style={{
              width: LIST_WIDTH,
              flexShrink: 0,
              borderRight: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            {searchField}
            {threadList}
          </div>
          {threadPane ?? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <p style={{ color: "#8b8b94", fontSize: 12.5, textAlign: "center", padding: 24 }}>
                {threads.length === 0 ? "Your conversations will show up here." : "Pick a conversation."}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`dm-dock-panel${closing ? " dm-dock-closing" : ""}`} style={{ ...panelBase, width: 330, height: 460 }}>
      {peer ? (
        threadPane
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
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
            <button onClick={closeDock} style={{ ...iconBtn, marginLeft: "auto" }} aria-label="Close messages">
              <Icon name="x" size={14} />
            </button>
          </div>
          {searchField}
          {threadList}
        </>
      )}
    </div>
  );
}
