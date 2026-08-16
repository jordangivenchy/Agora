"use client";

/* Right rail of the Agora: Chat / Q&A tabs.
   Chat is live — same room_messages table and realtime channel the classic
   room uses. Messages are always visible, but posting is gated: you unlock
   the input by clicking "Join chat", which affirms you've read the chat
   rules shown in the gate. The acceptance is remembered per browser.
   Q&A is a placeholder until audience questions get a backend.

   (A moderators panel used to live here — it's deliberately gone from the
   audience-facing rail. Moderation surfaces will return later inside the
   collaborator / stream-start flow, not the public page.) */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useUserMenu } from "../userMenuContext";
import type { User } from "@supabase/supabase-js";

interface Message {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  user?: { username: string; avatar_url: string | null };
}

interface Props {
  roomId: string;
  currentUser: User | null;
}

const USER_COLORS = [
  "#5865f2", "#eb459e", "#23a559", "#e2a83a", "#ed4245",
  "#9c84ef", "#3ba3d0", "#c87941", "#2d7d46", "#4752c4",
];

function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
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

export default function AgoraSidebar({ roomId, currentUser }: Props) {
  const { openUserMenu } = useUserMenu();
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<"chat" | "qa">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
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
      .select("*, user:users(username, avatar_url)")
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
    setSending(true);
    await supabase.from("room_messages").insert({
      room_id: roomId,
      user_id: currentUser.id,
      content: input.trim(),
    });
    setInput("");
    setSending(false);
    userScrolled.current = false;
  }

  return (
    <aside className="ag-sidebar">
      <section className="ag-card ag-chat-card">
        <div className="ag-tabs">
          <button className={`ag-tab ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>
            Chat
          </button>
          <button className={`ag-tab ${tab === "qa" ? "active" : ""}`} onClick={() => setTab("qa")}>
            Q&amp;A
          </button>
        </div>

        {tab === "chat" ? (
          <>
            <div className="ag-chat-scroll" ref={scrollRef} onScroll={handleScroll}>
              {messages.length === 0 && (
                <div className="ag-empty">No messages yet — say hello.</div>
              )}
              {messages.map((msg) => {
                const name = msg.user?.username || "User";
                return (
                  <div key={msg.id} className="ag-chat-msg">
                    <div
                      className="ag-chat-avatar"
                      style={{ background: getUserColor(msg.user_id), overflow: "hidden", cursor: "pointer" }}
                      onClick={(e) => openUserMenu({ x: e.clientX, y: e.clientY }, { userId: msg.user_id, username: name })}
                    >
                      {msg.user?.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={msg.user.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="ag-chat-body">
                      <div className="ag-chat-meta">
                        <span
                          className="ag-chat-name"
                          style={{ cursor: "pointer" }}
                          onClick={(e) => openUserMenu({ x: e.clientX, y: e.clientY }, { userId: msg.user_id, username: name })}
                        >
                          {name}
                        </span>
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
                <form className="ag-chat-inputrow" onSubmit={sendMessage}>
                  <input
                    className="ag-chat-input"
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Message #debate-chat"
                    maxLength={200}
                  />
                </form>
              ) : (
                <div className="ag-chat-signin">
                  <a href="/login">Sign in</a> to chat
                </div>
              )
            ) : null}
          </>
        ) : (
          <div className="ag-qa-placeholder">
            <div className="ag-qa-icon">❓</div>
            Audience questions will appear here.
            <small>Q&amp;A is coming soon.</small>
          </div>
        )}
      </section>
    </aside>
  );
}
