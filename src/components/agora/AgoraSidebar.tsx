"use client";

/* Right rail of the Agora: Chat / Q&A tabs, active moderators, and rules.
   Chat is live — same room_messages table and realtime channel the classic
   room uses, restyled to the amphitheater look (avatar, name, timestamp).
   Q&A is a placeholder until audience questions get a backend. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
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
  hostName: string | null;
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

const RULES = [
  { icon: "🤝", text: "Be respectful" },
  { icon: "✋", text: "No interruptions" },
  { icon: "🎯", text: "Stay on topic" },
  { icon: "👂", text: "Listen to others" },
  { icon: "🚫", text: "No personal attacks" },
];

export default function AgoraSidebar({ roomId, currentUser, hostName }: Props) {
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<"chat" | "qa">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

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
      {/* Chat / Q&A card */}
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
                    <div className="ag-chat-avatar" style={{ background: getUserColor(msg.user_id) }}>
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="ag-chat-body">
                      <div className="ag-chat-meta">
                        <span className="ag-chat-name">{name}</span>
                        <span className="ag-chat-time">{fmtTime(msg.created_at)}</span>
                      </div>
                      <div className="ag-chat-text">{msg.content}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {currentUser ? (
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
            )}
          </>
        ) : (
          <div className="ag-qa-placeholder">
            <div className="ag-qa-icon">❓</div>
            Audience questions will appear here.
            <small>Q&amp;A is coming soon.</small>
          </div>
        )}
      </section>

      {/* Moderators */}
      <section className="ag-card">
        <div className="ag-card-title">
          ACTIVE MODERATORS — {hostName ? 2 : 1}
        </div>
        <div className="ag-mod-row">
          <div className="ag-chat-avatar ag-mod-avatar" style={{ background: "#5865f2" }}>M</div>
          <span className="ag-mod-name">Moderator</span>
          <span className="ag-badge-bot">BOT</span>
        </div>
        {hostName && (
          <div className="ag-mod-row">
            <div className="ag-chat-avatar ag-mod-avatar" style={{ background: getUserColor(hostName) }}>
              {hostName.charAt(0).toUpperCase()}
            </div>
            <span className="ag-mod-name">
              {hostName}
              <small>Host</small>
            </span>
            <span className="ag-badge-shield" title="Host">🛡️</span>
          </div>
        )}
      </section>

      {/* Rules */}
      <section className="ag-card">
        <div className="ag-card-title">RULES</div>
        <ul className="ag-rules">
          {RULES.map((r) => (
            <li key={r.text}>
              <span className="ag-rule-icon">{r.icon}</span>
              {r.text}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
