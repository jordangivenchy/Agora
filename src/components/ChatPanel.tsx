"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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
  isOpen: boolean;
  onClose: () => void;
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

export default function ChatPanel({ roomId, currentUser, isOpen, onClose }: Props) {
  const supabase = createClient();
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
  }, [roomId]);

  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel(`chat-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_messages",
          filter: `room_id=eq.${roomId}`,
        },
        () => { fetchMessages(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchMessages, roomId]);

  // Auto-scroll
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
    <div className={`chat-panel ${isOpen ? "open" : ""}`}>
      <div className="chat-inner">
        <div className="chat-header">
          <span className="chat-title-text">Live Chat</span>
          <button className="chat-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <div
          className="chat-messages"
          ref={scrollRef}
          onScroll={handleScroll}
        >
          {messages.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "32px 16px",
                color: "rgba(238,238,245,0.18)",
                fontSize: "12px",
              }}
            >
              No messages yet
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className="chat-msg">
              <span
                className="chat-msg-user"
                style={{ color: getUserColor(msg.user_id) }}
              >
                {msg.user?.username || "User"}
              </span>
              <span className="chat-msg-text">{msg.content}</span>
            </div>
          ))}
        </div>

        {currentUser ? (
          <div className="chat-input-row">
            <input
              className="chat-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMessage();
              }}
              placeholder="Say something…"
              maxLength={200}
            />
          </div>
        ) : (
          <div className="chat-input-row">
            <div
              style={{
                textAlign: "center",
                fontSize: "11px",
                color: "rgba(238,238,245,0.25)",
                padding: "4px",
              }}
            >
              Sign in to chat
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
