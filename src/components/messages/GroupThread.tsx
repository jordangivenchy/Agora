"use client";

/* A group chat thread: the scroller (a sender's name over the first
   bubble of each run and their picture by the last, system lines for
   membership changes), the typing strip, and the same composer as DMs.
   Owns the per-chat data and realtime; the /messages page owns the
   list and passes the open group down. Same escape contract as
   DmThread: the parent calls consumeEscape() first. */

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
import DmMessageMenu from "@/components/messages/DmMessageMenu";
import { createLongPress } from "@/lib/longPress";
import { createClient } from "@/lib/supabase-browser";
import UserAvatar from "../UserAvatar";
import { displayName } from "@/lib/names";
import { uploadPostImage } from "@/lib/postImages";
import EmojiPicker from "@/components/EmojiPicker";
import GifPicker, { giphyEnabled } from "@/components/community/GifPicker";
import {
  dayLabel,
  dmIconBtn,
  fmtTime,
  isGif,
  MAX_DM_IMAGE_BYTES,
  UNSEND_WINDOW_MS,
  YELLOW,
  YELLOW_INK,
  type DmThreadHandle,
} from "./DmThread";
import GroupTile from "./GroupTile";
import GroupInfoModal from "./GroupInfoModal";
import {
  GROUP_MSG_SELECT,
  groupErrorText,
  systemLine,
  type GroupMember,
  type GroupMemberRow,
  type GroupMsg,
  type GroupRow,
} from "./groups";

interface Props {
  me: string;
  chat: GroupRow;
  variant: "dock" | "page";
  /** Unique realtime-topic suffix per surface (shared singleton client). */
  topic: string;
  /** Narrow-mode back arrow. */
  onBack?: () => void;
  /** Dock narrow-mode close button. */
  onClose?: () => void;
  /** Ping the parent to refresh its list (send/read/receive/rename). */
  onThreadsChanged: () => void;
  /** I left or was removed — the parent drops the selection. */
  onLeft: () => void;
}

const UNKNOWN: GroupMember = { id: "", username: "someone", display_name: "Someone", avatar_url: null };

const GroupThread = forwardRef<DmThreadHandle, Props>(function GroupThread(
  { me, chat, variant, topic, onBack, onClose, onThreadsChanged, onLeft },
  ref
) {
  const [supabase] = useState(() => createClient());
  const page = variant === "page";
  const chatId = chat.chat_id;
  const [name, setName] = useState(chat.name);
  const [members, setMembers] = useState<GroupMemberRow[]>([]);
  /* Senders who have since left, looked up once. */
  const [extra, setExtra] = useState<Map<string, GroupMember>>(new Map());
  const [msgs, setMsgs] = useState<GroupMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | "emoji" | "gif">(null);
  const [replyTo, setReplyTo] = useState<GroupMsg | null>(null);
  const [menuFor, setMenuFor] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [confirmUnsend, setConfirmUnsend] = useState<GroupMsg | null>(null);
  const [info, setInfo] = useState(false);
  /* user id → name, for the typing strip. */
  const [typing, setTyping] = useState<Map<string, string>>(new Map());
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  const myNameRef = useRef<string>("");
  const typingChanRef = useRef<RealtimeChannel | null>(null);
  const typingTimersRef = useRef<Map<string, number>>(new Map());
  const lastTypingSentRef = useRef(0);
  const pinnedRef = useRef(true);
  const refetchRef = useRef<(() => void) | null>(null);
  const menuOpenedAt = useRef(0);
  const openMenu = useCallback((m: GroupMsg, el: HTMLElement) => {
    menuOpenedAt.current = Date.now();
    setMenuFor({ id: m.id, rect: el.getBoundingClientRect() });
  }, []);
  const [press] = useState(() =>
    createLongPress<GroupMsg>((m, el) => {
      if (navigator.vibrate) navigator.vibrate(8);
      openMenu(m, el);
    })
  );

  /* The rail refreshes the row (rename from elsewhere). */
  useEffect(() => setName(chat.name), [chat.name]);

  useImperativeHandle(
    ref,
    () => ({
      consumeEscape: () => {
        if (confirmUnsend) {
          setConfirmUnsend(null);
          return true;
        }
        if (menuFor) {
          setMenuFor(null);
          return true;
        }
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
    [picker, replyTo, menuFor, confirmUnsend]
  );

  const who = useCallback(
    (id: string | null): GroupMember => {
      if (!id) return UNKNOWN;
      return members.find((m) => m.id === id) ?? extra.get(id) ?? { ...UNKNOWN, id };
    },
    [members, extra]
  );

  const loadMembers = useCallback(async () => {
    const { data } = await supabase.rpc("get_group_members", { p_chat: chatId });
    if (chatIdRef.current !== chatId) return;
    const rows = (data ?? []) as GroupMemberRow[];
    setMembers(rows);
    const mine = rows.find((m) => m.id === me);
    if (mine) myNameRef.current = displayName(mine);
  }, [supabase, chatId, me]);

  /* ── Load on chat change ─────────────────────────────────────────── */
  useEffect(() => {
    setMsgs([]);
    setMembers([]);
    setSendError(null);
    setPicker(null);
    setReplyTo(null);
    setMenuFor(null);
    setConfirmUnsend(null);
    setInfo(false);
    setTyping(new Map());
    const load = async () => {
      const [{ data }] = await Promise.all([
        supabase
          .from("group_messages")
          .select(GROUP_MSG_SELECT)
          .eq("chat_id", chatId)
          .order("created_at", { ascending: true })
          .limit(300),
        loadMembers(),
      ]);
      if (chatIdRef.current !== chatId) return; // switched away mid-flight
      setMsgs((data ?? []) as GroupMsg[]);
      supabase.rpc("mark_group_read", { p_chat: chatId }).then(onThreadsChanged);
    };
    refetchRef.current = load;
    load();
    return () => {
      refetchRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, supabase, loadMembers]);

  /* Names for people who have left the group but whose messages remain. */
  useEffect(() => {
    if (!members.length) return;
    const missing = [
      ...new Set(
        msgs
          .map((m) => m.sender_id)
          .filter((id): id is string => !!id && id !== me && !members.some((x) => x.id === id) && !extra.has(id))
      ),
    ];
    if (!missing.length) return;
    supabase
      .from("users")
      .select("id, username, display_name, avatar_url")
      .in("id", missing)
      .then(({ data }) => {
        if (!data?.length) return;
        setExtra((cur) => {
          const next = new Map(cur);
          for (const u of data as GroupMember[]) next.set(u.id, u);
          return next;
        });
      });
  }, [msgs, members, extra, me, supabase]);

  /* ── Realtime: messages in, unsends, and my own removal ───────────── */
  useEffect(() => {
    const channel = supabase
      .channel(`group-thread-${topic}-${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const m = payload.new as GroupMsg;
          setMsgs((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
          if (m.kind === "system") {
            /* Membership and renames arrive as system lines (the tables
               themselves aren't streamed to everyone). */
            const renamed = /^renamed the group to “(.+)”$/.exec(m.content);
            if (renamed) setName(renamed[1]);
            void loadMembers();
          }
          if (m.sender_id !== me) {
            const from = m.sender_id;
            if (from) {
              setTyping((t) => {
                if (!t.has(from)) return t;
                const n = new Map(t);
                n.delete(from);
                return n;
              });
            }
            if (m.kind === "text") supabase.rpc("mark_group_read", { p_chat: chatId }).then(onThreadsChanged);
            else onThreadsChanged();
          }
        }
      )
      .on(
        "postgres_changes",
        /* Unsend: DELETE events carry only the primary key and are not
           RLS-scoped — the filter is our own "is it in this thread". */
        { event: "DELETE", schema: "public", table: "group_messages" },
        (payload) => {
          const oldId = (payload.old as { id?: string } | null)?.id;
          if (!oldId) return;
          setMsgs((xs) => (xs.some((x) => x.id === oldId) ? xs.filter((x) => x.id !== oldId) : xs));
        }
      )
      .on(
        "postgres_changes",
        /* Composite PK = the DELETE payload carries chat + user. Mine
           means I left elsewhere or was removed; the "removed" system
           line never reaches me (I'm no longer a member by then). */
        { event: "DELETE", schema: "public", table: "group_chat_members" },
        (payload) => {
          const old = payload.old as { chat_id?: string; user_id?: string } | null;
          if (old?.chat_id !== chatIdRef.current) return;
          if (old.user_id === me) onLeft();
          else void loadMembers();
        }
      )
      .subscribe((status) => {
        /* The history fetch races the channel join; refetch once live
           (id-dedupe makes overlap safe; also heals reconnects). */
        if (status === "SUBSCRIBED") refetchRef.current?.();
      });
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, supabase, topic, chatId, loadMembers]);

  /* ── Typing: one broadcast channel per group, names only ───────────
     Each sender's flag decays after 3.5s of silence. */
  useEffect(() => {
    setTyping(new Map());
    const timers = typingTimersRef.current;
    const ch = supabase
      .channel(`group-typing-${chatId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const p = payload as { from?: string; name?: string } | null;
        if (!p?.from || p.from === me) return;
        const from = p.from;
        const label = p.name || "Someone";
        setTyping((t) => {
          const n = new Map(t);
          n.set(from, label);
          return n;
        });
        const prev = timers.get(from);
        if (prev !== undefined) window.clearTimeout(prev);
        timers.set(
          from,
          window.setTimeout(() => {
            timers.delete(from);
            setTyping((t) => {
              if (!t.has(from)) return t;
              const n = new Map(t);
              n.delete(from);
              return n;
            });
          }, 3500)
        );
      })
      .subscribe();
    typingChanRef.current = ch;
    return () => {
      typingChanRef.current = null;
      lastTypingSentRef.current = 0;
      for (const id of timers.values()) window.clearTimeout(id);
      timers.clear();
      supabase.removeChannel(ch);
    };
  }, [me, chatId, supabase]);

  /* ── Pin-to-bottom (keyed on the last message id, like DMs) ──────── */
  const lastMsgId = msgs.length ? msgs[msgs.length - 1].id : null;
  const typingLabel = (() => {
    const names = [...typing.values()];
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return "Several people are typing…";
  })();
  useEffect(() => {
    pinnedRef.current = true;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lastMsgId]);
  useLayoutEffect(() => {
    if (pinnedRef.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [replyTo, typingLabel, filePreview]);

  /* Auto-grow the composer up to ~4 lines. */
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const MAX = 4 * 22 + 14 + 2;
    ta.style.height = "auto";
    const full = ta.scrollHeight + 2;
    ta.style.height = `${Math.min(full, MAX)}px`;
    ta.style.overflowY = full > MAX ? "auto" : "hidden";
  }, [draft, chatId]);

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
        .from("group_messages")
        .insert({ chat_id: chatId, sender_id: me, content: text, image_url: imageUrl, reply_to: replyToId })
        .select(GROUP_MSG_SELECT)
        .single();
      if (error) {
        setSendError(error.code === "42501" ? "You're not in this group any more." : groupErrorText(error.message));
        return false;
      }
      setMsgs((xs) => (xs.some((x) => x.id === (data as GroupMsg).id) ? xs : [...xs, data as GroupMsg]));
      onThreadsChanged();
      return true;
    },
    [me, chatId, supabase, onThreadsChanged]
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

  const canUnsend = useCallback(
    (m: GroupMsg) => m.sender_id === me && m.kind === "text" && Date.now() - new Date(m.created_at).getTime() < UNSEND_WINDOW_MS,
    [me]
  );

  const unsend = useCallback(
    async (m: GroupMsg) => {
      setMsgs((xs) => xs.filter((x) => x.id !== m.id));
      setReplyTo((r) => (r?.id === m.id ? null : r));
      const { data } = await supabase.from("group_messages").delete().eq("id", m.id).select("id");
      if (!data || data.length === 0) {
        /* The window closed between the tap and the request: put it back. */
        setMsgs((xs) =>
          xs.some((x) => x.id === m.id) ? xs : [...xs, m].sort((a, b) => a.created_at.localeCompare(b.created_at))
        );
        return;
      }
      onThreadsChanged();
    },
    [supabase, onThreadsChanged]
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
  const menuMsg = menuFor ? msgs.find((m) => m.id === menuFor.id) ?? null : null;
  const others = members.filter((m) => m.id !== me);
  const tileMembers: GroupMember[] = members.length ? [...others, ...members.filter((m) => m.id === me)] : chat.members;
  const memberCount = members.length || chat.member_count;

  return (
    <div ref={rootRef} style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
      {/* Per-message menu: reply / copy / unsend (no reactions, nothing to "delete for you"). */}
      {menuFor && menuMsg && rootRef.current && (
        <DmMessageMenu
          anchor={menuFor.rect}
          root={rootRef.current.getBoundingClientRect()}
          mine={menuMsg.sender_id === me}
          reactions={[]}
          myReactions={new Set()}
          canUnsend={canUnsend(menuMsg)}
          hasText={menuMsg.content.trim().length > 0}
          showDelete={false}
          onReact={() => setMenuFor(null)}
          onReply={() => { setMenuFor(null); setReplyTo(menuMsg); taRef.current?.focus(); }}
          onCopy={() => { setMenuFor(null); void navigator.clipboard?.writeText(menuMsg.content); }}
          onUnsend={() => { setMenuFor(null); setConfirmUnsend(menuMsg); }}
          onDelete={() => setMenuFor(null)}
          onClose={() => setMenuFor(null)}
          shouldIgnoreClick={() => press.consumeClick() || Date.now() - menuOpenedAt.current < 350}
        />
      )}

      {/* Confirm sheet for unsend. */}
      {confirmUnsend && (
        <div
          className="dm-confirm-scrim"
          onClick={() => setConfirmUnsend(null)}
          role="presentation"
          style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div
            className="dm-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-confirm-title"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(100%, 360px)", background: "#000", borderRadius: 16, padding: "18px 20px", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
          >
            <p id="group-confirm-title" style={{ margin: 0, color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15 }}>
              Unsend this message?
            </p>
            <p style={{ margin: "6px 0 0", color: "#9a9aa4", fontSize: 13, lineHeight: 1.5 }}>It will be removed for everyone in the group.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setConfirmUnsend(null)}
                style={{ padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: "#0b0b0d", border: "1px solid rgba(255,255,255,0.12)", color: "#d5d5dc" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { const m = confirmUnsend; setConfirmUnsend(null); void unsend(m); }}
                autoFocus
                style={{ padding: "8px 16px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, background: "#e05a5a", border: "1px solid #e05a5a", color: "#fff" }}
              >
                Unsend
              </button>
            </div>
          </div>
        </div>
      )}

      {info && (
        <GroupInfoModal
          chatId={chatId}
          name={name}
          me={me}
          members={members}
          onClose={() => setInfo(false)}
          onRenamed={(n) => { setName(n); onThreadsChanged(); }}
          onMembersChanged={() => { void loadMembers(); onThreadsChanged(); }}
          onLeft={() => { setInfo(false); onLeft(); }}
        />
      )}

      {/* Thread header — the whole identity opens group info. */}
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
        <button
          type="button"
          onClick={() => setInfo(true)}
          title="Group info"
          className="cursor-pointer"
          style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, background: "none", border: "none", padding: 0, color: "inherit", fontFamily: "inherit", textAlign: "left" }}
        >
          <GroupTile members={tileMembers} size={page ? 40 : 32} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", color: "#f5f5f0", fontWeight: 600, fontSize: page ? 16 : 14, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {name}
            </span>
            <span style={{ display: "block", color: "#8b8b94", fontSize: page ? 12.5 : 12, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {others.length
                ? others.map((m) => displayName(m)).join(", ")
                : `${memberCount} member${memberCount === 1 ? "" : "s"}`}
            </span>
          </span>
        </button>
        <button onClick={() => setInfo(true)} style={{ ...dmIconBtn, marginLeft: "auto" }} aria-label="Group info" title="Group info">
          <Icon name="info" size={16} />
        </button>
        {onClose && (
          <button onClick={onClose} style={dmIconBtn} aria-label="Close messages">
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
        style={{ flex: 1, overflowY: "auto", padding: page ? "14px 18px" : "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}
      >
        {msgs.length === 0 && (
          <p style={{ color: "#8b8b94", fontSize: 13, textAlign: "center", marginTop: 24 }}>Say hi to the group 👋</p>
        )}
        {msgs.map((m, i) => {
          const mine = m.sender_id === me;
          const prev = i > 0 ? msgs[i - 1] : null;
          const next = i < msgs.length - 1 ? msgs[i + 1] : null;
          const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
          const day = newDay && (
            <div style={{ alignSelf: "center", margin: "10px 0 2px", fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "#6b6b74" }}>
              {dayLabel(m.created_at)}
            </div>
          );
          if (m.kind === "system") {
            return (
              <div key={m.id} style={{ display: "contents" }}>
                {day}
                <div style={{ alignSelf: "center", textAlign: "center", margin: "6px 0", fontSize: 11.5, lineHeight: 1.4, color: "#8b8b94", maxWidth: "85%" }}>
                  {systemLine(m.content, mine ? "You" : displayName(who(m.sender_id)))}
                </div>
              </div>
            );
          }
          const sender = who(m.sender_id);
          const hasText = m.content.trim().length > 0;
          const quoted = m.reply_to ? msgs.find((x) => x.id === m.reply_to) ?? null : null;
          const startsRun = !prev || prev.sender_id !== m.sender_id || prev.kind === "system";
          const endsRun = !next || next.sender_id !== m.sender_id || next.kind === "system";
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {day}
              {/* Their name over the first bubble of each of their runs. */}
              {!mine && startsRun && (
                <div style={{ alignSelf: "flex-start", marginLeft: 34, marginTop: 10, marginBottom: -2, lineHeight: 1.2, fontSize: 11.5, color: "rgba(238,238,245,0.5)" }}>
                  {displayName(sender)}
                </div>
              )}
              <div
                id={`gm-msg-${m.id}`}
                className="dm-msg-row"
                style={{ display: "flex", alignItems: "flex-end", gap: 6, flexDirection: mine ? "row-reverse" : "row", alignSelf: mine ? "flex-end" : "flex-start", maxWidth: page ? "72%" : "85%" }}
              >
                {!mine && (
                  <span style={{ width: 22, height: 22, flexShrink: 0, alignSelf: "flex-end", marginBottom: 2 }}>
                    {endsRun && <UserAvatar size={22} username={sender.username} avatarUrl={sender.avatar_url} seed={sender.id || m.id} />}
                  </span>
                )}
                <div
                  className={`dm-bubble${menuFor?.id === m.id ? " is-menu" : ""}`}
                  style={{
                    padding: m.image_url ? 4 : "7px 11px",
                    borderRadius: mine ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                    background: mine ? YELLOW : "#1e2129",
                    color: mine ? YELLOW_INK : "#f2f2f5",
                    fontSize: page ? 15 : 14.5,
                    lineHeight: 1.4,
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                    minWidth: 0,
                  }}
                  title={fmtTime(m.created_at)}
                  onPointerDown={(e) => press.onPointerDown(e, m)}
                  onPointerMove={press.onPointerMove}
                  onPointerUp={press.onPointerUp}
                  onPointerCancel={press.onPointerCancel}
                  onClick={(e) => {
                    if (press.consumeClick()) { e.preventDefault(); return; }
                    if ((e.target as HTMLElement).closest("a")) return;
                    if (press.lastPointerType() === "mouse") openMenu(m, e.currentTarget);
                  }}
                  onContextMenu={(e) => { e.preventDefault(); if (press.lastPointerType() === "mouse") openMenu(m, e.currentTarget); }}
                >
                  {m.reply_to && (
                    <div
                      onClick={() => {
                        document.getElementById(`gm-msg-${m.reply_to}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      style={{
                        margin: m.image_url ? "3px 7px 4px" : "0 0 5px",
                        padding: "3px 8px",
                        borderLeft: `2px solid ${mine ? "rgba(0,0,0,0.4)" : YELLOW}`,
                        borderRadius: 6,
                        background: mine ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.06)",
                        cursor: quoted ? "pointer" : "default",
                        fontSize: 12,
                        lineHeight: 1.3,
                        overflow: "hidden",
                      }}
                    >
                      <span style={{ display: "block", fontWeight: 700, opacity: 0.8 }}>
                        {quoted ? (quoted.sender_id === me ? "You" : displayName(who(quoted.sender_id))) : "Earlier message"}
                      </span>
                      {quoted && (
                        <span style={{ display: "block", opacity: 0.75, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {quoted.content.trim() || (quoted.image_url ? (isGif(quoted.image_url) ? "GIF" : "Photo") : "")}
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
                        style={{ display: "block", maxWidth: page ? 420 : 280, maxHeight: page ? 440 : 320, borderRadius: 9, objectFit: "cover" }}
                      />
                    </a>
                  )}
                  {hasText && <div style={{ padding: m.image_url ? "5px 7px 3px" : 0 }}>{m.content}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Typing strip — outside the scroller so it doesn't retrigger auto-scroll. */}
      <div
        style={{ height: typingLabel ? 22 : 0, overflow: "hidden", transition: "height 0.15s ease", display: "flex", alignItems: "center", gap: 6, padding: page ? "0 18px" : "0 14px", flexShrink: 0 }}
        aria-live="polite"
      >
        {typingLabel && (
          <>
            <span style={{ display: "inline-flex", gap: 3 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="dm-typing-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: YELLOW, display: "inline-block" }} />
              ))}
            </span>
            <span style={{ color: "#8b8b94", fontSize: 12 }}>{typingLabel}</span>
          </>
        )}
      </div>

      {sendError && <p style={{ margin: 0, padding: "6px 12px", color: "#ff9d92", fontSize: 11.5 }}>{sendError}</p>}

      {/* Composer */}
      <div className="dm-composer" style={{ position: "relative", borderTop: "1px solid rgba(255,255,255,0.08)", padding: page ? "10px 14px" : "8px 10px", flexShrink: 0 }}>
        {replyTo && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "4px 8px", borderLeft: `2px solid ${YELLOW}`, borderRadius: 6, background: "rgba(255,183,0,0.08)" }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.3 }}>
              <span style={{ display: "block", color: "#c9c9d4", fontWeight: 700 }}>
                Replying to {replyTo.sender_id === me ? "yourself" : displayName(who(replyTo.sender_id))}
              </span>
              <span style={{ display: "block", color: "#8b8b94", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {replyTo.content.trim() || (replyTo.image_url ? (isGif(replyTo.image_url) ? "GIF" : "Photo") : "")}
              </span>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              style={{ width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", padding: 0, flexShrink: 0 }}
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
              style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 999, border: "1px solid rgba(255,255,255,0.2)", background: "#1a1c24", color: "white", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}
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
              const now = Date.now();
              if (e.target.value && now - lastTypingSentRef.current > 2000 && typingChanRef.current?.state === "joined") {
                lastTypingSentRef.current = now;
                typingChanRef.current.send({ type: "broadcast", event: "typing", payload: { from: me, name: myNameRef.current } });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`Message ${name}…`}
            rows={1}
            autoFocus={typeof window === "undefined" || !window.matchMedia("(max-width: 639px)").matches}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 36,
              maxHeight: 104,
              overflowY: "hidden",
              resize: "none",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "white",
              fontSize: 14.5,
              lineHeight: "22px",
              padding: "7px 12px",
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          <span className="dm-picker-anchor dm-emoji-btn" style={{ position: "relative", display: "inline-flex" }}>
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
            <span className="dm-picker-anchor" style={{ position: "relative", display: "inline-flex" }}>
              <button
                onClick={() => setPicker(picker === "gif" ? null : "gif")}
                style={{ ...dmIconBtn, width: "auto", padding: "0 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: picker === "gif" ? YELLOW : dmIconBtn.color }}
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

export default GroupThread;
