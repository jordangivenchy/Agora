"use client";

/* Topics — replaces the old matchmaking-style Discuss page. Instead of
   "finding an opponent," people queue into conversations from what's
   actually happening: headlines (news_topics rows) and topic areas
   ranked by live activity.

   Join flow per row:
   - something's live on the topic → jump straight into the busiest room
     (the room's own join screen handles side/queue/spectate)
   - nothing live → hand the motion/topic to the create-room modal via
     onStart, so the user opens the conversation themselves */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS } from "@/types/database";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Prefills the real CreateRoomModal (same contract as NewsPage). */
  onStart: (motion: string, topicKey: string) => void;
}

type NewsRow = {
  id: string;
  headline: string;
  topic_key: string;
  suggested_motion: string;
  created_at: string;
};

type LiveTopic = {
  key: string;
  label: string;
  emoji: string;
  liveCount: number;
  topRoomId: string | null;
  topRoomMotion: string | null;
  watching: number;
};

const card: React.CSSProperties = {
  background: "rgba(18,18,24,0.92)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

const joinBtn: React.CSSProperties = {
  background: "rgba(24,48,82,0.9)",
  border: "0.5px solid #2c5382",
  color: "#9cc4f0",
  borderRadius: 9,
  padding: "7px 14px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const startBtn: React.CSSProperties = {
  background: "transparent",
  border: "0.5px solid #3a3a42",
  color: "#c0c0c8",
  borderRadius: 9,
  padding: "7px 14px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

export default function TopicsPage({ open, onClose, onStart }: Props) {
  const [supabase] = useState(() => createClient());
  const [news, setNews] = useState<NewsRow[]>([]);
  const [topics, setTopics] = useState<LiveTopic[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [newsRes, roomsRes] = await Promise.all([
      supabase
        .from("news_topics")
        .select("id, headline, topic_key, suggested_motion, created_at")
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("debate_rooms")
        .select("id, motion, topic_key, viewer_count, started_at")
        .eq("status", "live")
        .eq("is_private", false)
        .order("viewer_count", { ascending: false }),
    ]);

    setNews((newsRes.data ?? []) as NewsRow[]);

    const rooms = roomsRes.data ?? [];
    const byTopic = new Map<string, typeof rooms>();
    for (const r of rooms) {
      const list = byTopic.get(r.topic_key) ?? [];
      list.push(r);
      byTopic.set(r.topic_key, list);
    }
    const ranked: LiveTopic[] = TOPICS.map((t) => {
      const list = byTopic.get(t.key) ?? [];
      return {
        key: t.key,
        label: t.label,
        emoji: t.emoji,
        liveCount: list.length,
        topRoomId: list[0]?.id ?? null,
        topRoomMotion: list[0]?.motion ?? null,
        watching: list.reduce((n, r) => n + (r.viewer_count ?? 0), 0),
      };
    }).sort((a, b) => b.liveCount - a.liveCount || b.watching - a.watching);
    setTopics(ranked);
    setLoaded(true);
  }, [supabase]);

  useEffect(() => { if (open) load(); }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const joinLive = (roomId: string) => {
    window.location.href = `/rooms/${roomId}`;
  };

  /** Live room on the news item's topic, if any. */
  const liveForTopic = (topicKey: string): LiveTopic | undefined =>
    topics.find((t) => t.key === topicKey && t.liveCount > 0);

  if (!open) return null;

  return (
    <div
      className="fixed overflow-y-auto"
      style={{
        top: "var(--nav-height)",
        left: "calc(var(--sidebar-width) + 12px)",
        right: 0,
        bottom: 0,
        zIndex: 50,
        fontFamily: "'DM Sans', sans-serif",
        background: "var(--bg-primary, #0a0a0c)",
      }}
    >
      <div className="max-w-[860px] mx-auto px-6 py-5">

        <div className="flex items-center gap-3.5 mb-5 flex-wrap">
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>
            Topics
          </span>
          <span className="text-[12px]" style={{ color: "#8b8b94" }}>
            Join a conversation about what&rsquo;s happening now
          </span>
        </div>

        {/* ── In the news ── */}
        <p className="m-0 mb-2.5 text-[13px]" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>
          In the news
        </p>
        {news.length === 0 ? (
          <div className="p-5 mb-6 text-center" style={card}>
            <p className="m-0 text-[12px]" style={{ color: "#8b8b94" }}>
              {loaded ? "No news topics yet — they'll appear here once the news pipeline is live." : "Loading…"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 mb-6">
            {news.map((n) => {
              const live = liveForTopic(n.topic_key);
              const t = TOPICS.find((x) => x.key === n.topic_key);
              return (
                <div key={n.id} className="p-4 flex items-center gap-3.5 flex-wrap" style={card}>
                  <div className="flex-1 min-w-[220px]">
                    <p className="m-0 text-[10.5px]" style={{ color: "#8b8b94" }}>
                      {t ? `${t.emoji} ${t.label}` : n.topic_key}
                    </p>
                    <p className="m-0 mt-0.5 text-[13.5px]" style={{ color: "#f5f5f0" }}>{n.headline}</p>
                    <p className="m-0 mt-1 text-[11.5px]" style={{ color: "#c9b06a" }}>
                      &ldquo;{n.suggested_motion}&rdquo;
                    </p>
                  </div>
                  {live?.topRoomId ? (
                    <button style={joinBtn} onClick={() => joinLive(live.topRoomId!)}>
                      Join live · {live.liveCount}
                    </button>
                  ) : (
                    <button style={joinBtn} onClick={() => onStart(n.suggested_motion, n.topic_key)}>
                      Start the conversation
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Trending topics ── */}
        <p className="m-0 mb-2.5 text-[13px]" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#f5f5f0" }}>
          Trending topics
        </p>
        <div className="flex flex-col gap-2.5 pb-8">
          {topics.map((t) => (
            <div key={t.key} className="p-4 flex items-center gap-3.5 flex-wrap" style={card}>
              <div className="flex-1 min-w-[220px]">
                <p className="m-0 text-[13.5px]" style={{ color: "#f5f5f0" }}>
                  {t.emoji} {t.label}
                </p>
                <p className="m-0 mt-0.5 text-[11px]" style={{ color: t.liveCount ? "#f09595" : "#6b6b74" }}>
                  {t.liveCount
                    ? `● ${t.liveCount} live now${t.watching ? ` · ${t.watching} watching` : ""}`
                    : "Quiet right now"}
                </p>
                {t.topRoomMotion && (
                  <p className="m-0 mt-1 text-[11.5px] truncate" style={{ color: "#9a9aa2" }}>
                    Busiest: &ldquo;{t.topRoomMotion}&rdquo;
                  </p>
                )}
              </div>
              {t.topRoomId ? (
                <button style={joinBtn} onClick={() => joinLive(t.topRoomId!)}>
                  Join live
                </button>
              ) : (
                <button style={startBtn} onClick={() => onStart("", t.key)}>
                  Start one
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
