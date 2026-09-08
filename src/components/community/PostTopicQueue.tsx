"use client";

/* The conversation a post carries: its question, who is waiting, and
   the two ways in — argue PRO or CON. Queueing uses queue_for_topic
   (instant room if someone is already waiting on the other side,
   otherwise a spot in line polled with check_topic_match), the same
   path as the rail's "Queue a conversation". Renders nothing for a
   post without a topic, so cards can mount it unconditionally. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import { TOPICS } from "@/types/database";
import { refreshPostTopic, usePostTopic } from "@/lib/postTopics";

export default function PostTopicQueue({ postId, compact }: { postId: string; compact?: boolean }) {
  const [supabase] = useState(() => createClient());
  const topic = usePostTopic(postId);
  const [busy, setBusy] = useState<"PRO" | "CON" | "leave" | null>(null);
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

  const queue = useCallback(async (stance: "PRO" | "CON") => {
    if (!topic || busy) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }
    setBusy(stance);
    setNote(null);
    const { data, error } = await supabase.rpc("queue_for_topic", { p_topic: topic.topic_id, p_stance: stance });
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
          <Icon name="swords" size={12} /> DEBATE THIS
        </span>
        {field && (
          <span style={{ fontSize: 10.5, fontWeight: 600, color: field.color, flexShrink: 0 }}>{field.label}</span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(238,238,245,0.5)", whiteSpace: "nowrap" }}>
          {topic.am_queued
            ? "You're in line"
            : waiting > 0
              ? `${waiting} waiting · ${topic.pro_count} pro · ${topic.con_count} con`
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
              Waiting for someone to argue {topic.my_stance === "CON" ? "PRO" : "CON"}…
            </span>
            <button type="button" onClick={leave} disabled={busy !== null} className="cursor-pointer" style={quiet}>
              {busy === "leave" ? "…" : "Leave line"}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => queue("PRO")} disabled={busy !== null} className="cursor-pointer" style={side("#2f7fe0", topic.con_count > 0)}>
              {busy === "PRO" ? "…" : topic.con_count > 0 ? "Argue PRO · match now" : "Argue PRO"}
            </button>
            <button type="button" onClick={() => queue("CON")} disabled={busy !== null} className="cursor-pointer" style={side("#e05a5a", topic.pro_count > 0)}>
              {busy === "CON" ? "…" : topic.pro_count > 0 ? "Argue CON · match now" : "Argue CON"}
            </button>
          </>
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

/* A side's button: its colour, and yellow when someone on the other
   side is waiting, so the instant match reads as the obvious tap. */
function side(color: string, hot: boolean): React.CSSProperties {
  return {
    height: 30, padding: "0 14px", borderRadius: 999, border: "none",
    background: hot ? "#ffb700" : color, color: hot ? "#1a0e00" : "#fff",
    fontSize: 12, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
  };
}
