"use client";

/* The conversation a post carries: its question, how many are waiting,
   and one way in — Queue. Stanceless like the rail's "Queue a
   conversation": queue_for_topic pairs you with whoever is already in
   line (instant room) or holds your place, polled with
   check_topic_match. Renders nothing for a post without a topic, so
   cards can mount it unconditionally. */

import { useCallback, useEffect } from "react";
import { Icon } from "@/components/icons";
import { TOPICS } from "@/types/database";
import { refreshPostTopic, usePostTopic } from "@/lib/postTopics";
import { leaveQueue as leaveTopicQueue, openQueue, useQueue } from "@/lib/queue";

export default function PostTopicQueue({ postId, compact }: { postId: string; compact?: boolean }) {
  const topic = usePostTopic(postId);
  /* The queue panel (lib/queue.ts) owns queueing: Queue opens it with
     this question; Leave drops the line. The card refreshes its counts
     whenever the queue changes. */
  const q = useQueue();
  const inLine = !!topic && (topic.am_queued || q.entries.some((e) => e.topicId === topic.topic_id));
  useEffect(() => {
    const on = () => refreshPostTopic(postId);
    window.addEventListener("agora:queue-changed", on);
    return () => window.removeEventListener("agora:queue-changed", on);
  }, [postId]);
  const queue = useCallback(() => {
    if (!topic) return;
    openQueue({ id: topic.topic_id, question: topic.question, topicKey: topic.topic_key, queueCount: topic.queue_count });
  }, [topic]);
  const leave = useCallback(() => { if (topic) void leaveTopicQueue(topic.topic_id); }, [topic]);

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
          {inLine
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
        {inLine ? (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#ffb700", fontWeight: 600 }}>
              <span className="feed-live-dot" aria-hidden />
              In line — waiting for a match…
            </span>
            <button type="button" onClick={leave} disabled={q.busy} className="cursor-pointer" style={quiet}>
              Leave
            </button>
          </>
        ) : (
          <button type="button" onClick={queue} className="cursor-pointer" style={queueBtn(waiting > 0)}>
            {waiting > 0 ? "Queue · match now" : "Queue"}
          </button>
        )}
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
