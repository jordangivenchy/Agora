"use client";

/* The conversation a post carries: its question, how many are waiting,
   and one way in — Queue. Stanceless like the rail's "Queue a
   conversation": queue_for_topic pairs you with whoever is already in
   line (instant room) or holds your place, polled with
   check_topic_match. Renders nothing for a post without a topic, so
   cards can mount it unconditionally. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import { TOPICS } from "@/types/database";
import { refreshPostTopic, usePostTopic } from "@/lib/postTopics";

export default function PostTopicQueue({ postId, compact }: { postId: string; compact?: boolean }) {
  const [supabase] = useState(() => createClient());
  const topic = usePostTopic(postId);
  const [busy, setBusy] = useState<"queue" | "leave" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  /* While I'm in line: a match sends me straight into the room. */
  const ensurePoll = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const { data: roomId } = await supabase.rpc("check_topic_match");
      if (roomId) {
        stopPoll();
        window.location.href = `/agora/${roomId}`;
      } else {
        refreshPostTopic(postId);
      }
    }, 4000);
  }, [supabase, stopPoll, postId]);

  useEffect(() => {
    if (topic?.am_queued) ensurePoll();
    else stopPoll();
    return stopPoll;
  }, [topic?.am_queued, ensurePoll, stopPoll]);

  const queue = useCallback(async () => {
    if (!topic || busy) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }
    setBusy("queue");
    setNote(null);
    /* Stanceless: the server seats the joiner opposite whoever is waiting. */
    const { data, error } = await supabase.rpc("queue_for_topic", { p_topic: topic.topic_id, p_stance: "PRO" });
    setBusy(null);
    if (error) { setNote(error.message.replace(/^[a-z_]+:\s*/, "")); return; }
    const res = data as { status?: string; room_id?: string } | null;
    if (res?.status === "matched" && res.room_id) { window.location.href = `/agora/${res.room_id}`; return; }
    refreshPostTopic(postId);
  }, [topic, busy, supabase, postId]);

  const leave = useCallback(async () => {
    if (!topic || busy) return;
    setBusy("leave");
    await supabase.rpc("leave_topic_queue", { p_topic: topic.topic_id });
    setBusy(null);
    stopPoll();
    refreshPostTopic(postId);
  }, [topic, busy, supabase, stopPoll, postId]);

  if (!topic) return null;
  const field = TOPICS.find((t) => t.key === topic.topic_key);
  const waiting = topic.queue_count;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="post-topic"
      style={{
        marginTop: compact ? 8 : 12,
        padding: compact ? "10px 12px" : "12px 14px",
        borderRadius: 12,
        background: "#0b0b0d",
        border: "1px solid rgba(255,255,255,0.12)",
        display: "flex",
        flexDirection: "column",
        gap: compact ? 8 : 10,
        cursor: "default",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", color: "#ffb700", flexShrink: 0 }}>
          <Icon name="swords" size={12} /> QUEUE A CONVERSATION
        </span>
        {field && (
          <span style={{ fontSize: 10.5, fontWeight: 600, color: field.color, flexShrink: 0 }}>{field.label}</span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(238,238,245,0.5)", whiteSpace: "nowrap" }}>
          {topic.am_queued
            ? "In line"
            : waiting > 0
              ? `${waiting} waiting to talk`
              : "No one waiting yet"}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: compact ? 13.5 : 15, fontWeight: 600, color: "#f5f5f0", lineHeight: 1.35 }}>
        {topic.question}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {topic.am_queued ? (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#ffb700", fontWeight: 600 }}>
              <span className="feed-live-dot" aria-hidden />
              In line — waiting for a match…
            </span>
            <button type="button" onClick={leave} disabled={busy !== null} className="cursor-pointer" style={quiet}>
              {busy === "leave" ? "…" : "Leave"}
            </button>
          </>
        ) : (
          <button type="button" onClick={queue} disabled={busy !== null} className="cursor-pointer" style={queueBtn(waiting > 0)}>
            {busy === "queue" ? "…" : waiting > 0 ? "Queue · match now" : "Queue"}
          </button>
        )}
        {note && <span style={{ fontSize: 11.5, color: "#ff9d92" }}>{note}</span>}
      </div>
    </div>
  );
}

const quiet: React.CSSProperties = {
  height: 30, padding: "0 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.16)",
  background: "#000", color: "#c9c9d2", fontSize: 12, fontWeight: 600, fontFamily: "inherit",
};

/* The rail's colours: blue to start a line, yellow when someone is
   already waiting and a tap means a room right now. */
function queueBtn(hot: boolean): React.CSSProperties {
  return {
    height: 30, padding: "0 16px", borderRadius: 999, border: "none",
    background: hot ? "#ffb700" : "#2f7fe0", color: hot ? "#1a0e00" : "#fff",
    fontSize: 12, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
  };
}
