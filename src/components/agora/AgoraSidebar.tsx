"use client";

/* Right rail of the Agora: the room's chat.
   Live — same room_messages table and realtime channel the classic room
   uses. Messages are always visible, but posting is gated: you unlock
   the input by clicking "Join chat", which affirms you've read the chat
   rules shown in the gate. The acceptance is remembered per browser.

   (A moderators panel used to live here — it's deliberately gone from the
   audience-facing rail. Moderation surfaces will return later inside the
   collaborator / stream-start flow, not the public page.) */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase-browser";
import { useUserMenu } from "../userMenuContext";
import UserAvatar from "../UserAvatar";
import CallSettings, { type CallSettingsProps } from "./CallSettings";
import { displayName } from "@/lib/names";
import { BODY_MIN, cleanTextError } from "@/lib/cleanText";
import type { User } from "@supabase/supabase-js";

interface Message {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  user?: { username: string; display_name?: string | null; avatar_url: string | null };
}

interface Props {
  roomId: string;
  currentUser: User | null;
  /** Rail folded away so the stage can run full width. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Call settings take the chat's place in the rail while open. */
  settings?: CallSettingsProps | null;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

const CHAT_RULES = [
  "Be respectful",
  "No interruptions",
  "Stay on topic",
  "Listen to others",
  "No personal attacks",
];

const CHAT_JOINED_KEY = "agora-chat-joined";

export default function AgoraSidebar({
  roomId,
  currentUser,
  collapsed = false,
  onToggleCollapsed,
  settings,
}: Props) {
  const { openUserMenu } = useUserMenu();
  const [supabase] = useState(() => createClient());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  /* Chat unlock: null until we've read localStorage (avoids a gate flash
     for people who already joined). */
  const [joined, setJoined] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

  useEffect(() => {
    setJoined(localStorage.getItem(CHAT_JOINED_KEY) === "1");
  }, []);

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from("room_messages")
      .select("*, user:users(username, display_name, avatar_url)")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (data) setMessages(data);
  }, [roomId, supabase]);

  useEffect(() => {
    fetchMessages();
    const channel = supabase
      .channel(`agora-chat-${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` },
        () => fetchMessages()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchMessages, roomId, supabase]);

  useEffect(() => {
    if (scrollRef.current && !userScrolled.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollHeight, scrollTop, clientHeight } = scrollRef.current;
    userScrolled.current = scrollHeight - scrollTop - clientHeight > 100;
  }

  function joinChat() {
    localStorage.setItem(CHAT_JOINED_KEY, "1");
    setJoined(true);
  }

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    if (!currentUser || !input.trim() || sending) return;
    const text = input.trim();
    const issue = cleanTextError(text, BODY_MIN);
    if (issue) {
      setChatError(issue);
      return;
    }
    setSending(true);
    setChatError(null);
    const { error } = await supabase.from("room_messages").insert({
      room_id: roomId,
      user_id: currentUser.id,
      content: text,
    });
    if (error) {
      setChatError(error.message);
      setSending(false);
      return;
    }
    setInput("");
    setSending(false);
    userScrolled.current = false;
  }

  return (
    <>
      {/* Restore handle — the only chat affordance left once the rail is
          folded away. Fixed to the viewport so it survives the rail
          collapsing to zero width. */}
      {collapsed && (
        <button
          className="ag-rail-restore"
          onClick={onToggleCollapsed}
          aria-expanded={false}
          title="Show chat"
        >
          <Icon name="message-circle" size={16} />
          <span>Chat</span>
        </button>
      )}

      <aside className="ag-sidebar" aria-hidden={collapsed}>
        {settings ? (
          <CallSettings {...settings} />
        ) : (
        <section className="ag-card ag-chat-card">
          <div className="ag-chat-head">
            <span className="ag-chat-title">Chat</span>
            <button
              className="ag-rail-collapse"
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
              title="Hide chat — full-width stage"
            >
              <Icon name="chevron-down" size={15} />
            </button>
          </div>

          <div className="ag-chat-scroll" ref={scrollRef} onScroll={handleScroll}>
            {messages.length === 0 && (
              <div className="ag-empty">No messages yet — say hello.</div>
            )}
            {messages.map((msg) => {
              const name = displayName(msg.user) || "User";
              const handle = msg.user?.username || name;
              const openMenu = (e: React.MouseEvent) =>
                openUserMenu({ x: e.clientX, y: e.clientY }, { userId: msg.user_id, username: handle });
              return (
                <div key={msg.id} className="ag-chat-msg">
                  <button type="button" className="ag-chat-avatar" onClick={openMenu} aria-label={`@${handle}`}>
                    <UserAvatar size={28} username={handle} avatarUrl={msg.user?.avatar_url ?? null} seed={msg.user_id} />
                  </button>
                  <div className="ag-chat-body">
                    <div className="ag-chat-meta">
                      <button type="button" className="ag-chat-name" onClick={openMenu}>
                        {name}
                      </button>
                      <span className="ag-chat-time">{fmtTime(msg.created_at)}</span>
                    </div>
                    <div className="ag-chat-text">{msg.content}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* The gate: rules first, input after */}
          {joined === false ? (
            <div className="ag-chat-gate">
              <div className="ag-chat-gate-title">Chat rules</div>
              <ul className="ag-chat-gate-rules">
                {CHAT_RULES.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <button className="ag-chat-join" onClick={joinChat}>
                Join chat
              </button>
              <div className="ag-chat-gate-note">
                Joining confirms you&apos;ve read the rules.
              </div>
            </div>
          ) : joined === true ? (
            currentUser ? (
              <>
              {chatError && <div className="ag-chat-err">{chatError}</div>}
              <form className="ag-chat-inputrow" onSubmit={sendMessage}>
                <input
                  className="ag-chat-input"
                  type="text"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (chatError) setChatError(null);
                  }}
                  placeholder="Message…"
                  maxLength={200}
                  /* Phone keyboards cover a fixed bottom sheet; nudge the
                     composer back into the visual viewport. */
                  onFocus={(e) => {
                    const el = e.currentTarget;
                    setTimeout(() => el.scrollIntoView({ block: "nearest" }), 300);
                  }}
                />
                <button
                  type="submit"
                  className="ag-chat-send"
                  disabled={!input.trim() || sending}
                  aria-label="Send"
                  title="Send"
                >
                  <Icon name="send" size={15} />
                </button>
              </form>
              </>
            ) : (
              <div className="ag-chat-signin">
                <a className="ag-chat-signin-btn" href="/login">Sign in to chat</a>
              </div>
            )
          ) : null}
        </section>
        )}
      </aside>
    </>
  );
}
