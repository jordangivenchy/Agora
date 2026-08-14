"use client";

/* Topics — standing questions with matchmaking queues. No lobbies, no
   manual room creation: pick a question ("Is God real?"), queue up,
   and the moment someone else queues on it the server creates the
   room, seats you both, and this page sends each of you in.

   Backed by 20260817_topic_queues.sql:
   - get_debate_topics: question bank + live queue counts + my state
   - queue_for_topic: joins the queue, or matches instantly if someone
     is already waiting (returns the created room)
   - check_topic_match: the waiting side polls until its room exists
   - leave_topic_queue: cancel */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS } from "@/types/database";

interface Props {
  open: boolean;
  onClose: () => void;
}

type TopicRow = {
  id: string;
  question: string;
  topic_key: string;
  queue_count: number;
  am_queued: boolean;
};

const card: React.CSSProperties = {
  background: "rgba(18,18,24,0.92)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

const POLL_MS = 2500;

export default function TopicsPage({ open, onClose }: Props) {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null>(null);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const anyQueued = topics.some((t) => t.am_queued);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    setUserId(auth?.user?.id ?? null);
    const { data, error: err } = await supabase.rpc("get_debate_topics");
    if (err) { setError(err.message); return; }
    setTopics((data ?? []) as TopicRow[]);
    setLoaded(true);
  }, [supabase]);

  useEffect(() => { if (open) load(); }, [open, load]);

  /* While queued anywhere: poll for a match; also refresh counts so
     the board feels alive. Cleared when the page closes or nothing
     is queued. */
  useEffect(() => {
    if (!open || !anyQueued || !userId) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(async () => {
      const { data: roomId } = await supabase.rpc("check_topic_match");
      if (roomId) {
        if (pollRef.current) clearInterval(pollRef.current);
        window.location.href = `/rooms/${roomId}`;
        return;
      }
      load();
    }, POLL_MS);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [open, anyQueued, userId, supabase, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const queueUp = useCallback(async (t: TopicRow) => {
    if (!userId) { window.location.href = "/login"; return; }
    setBusyId(t.id);
    setError(null);
    const { data, error: err } = await supabase.rpc("queue_for_topic", { p_topic: t.id });
    setBusyId(null);
    if (err) {
      setError(err.message.includes("suspended") ? "Your account is suspended." : err.message);
      return;
    }
    const res = data as { status: string; room_id?: string };
    if (res?.status === "matched" && res.room_id) {
      window.location.href = `/rooms/${res.room_id}`;
      return;
    }
    setTopics((ts) => ts.map((x) =>
      x.id === t.id ? { ...x, am_queued: true, queue_count: x.queue_count + 1 } : x));
  }, [supabase, userId]);

  const leaveQueue = useCallback(async (t: TopicRow) => {
    setBusyId(t.id);
    await supabase.rpc("leave_topic_queue", { p_topic: t.id });
    setBusyId(null);
    setTopics((ts) => ts.map((x) =>
      x.id === t.id ? { ...x, am_queued: false, queue_count: Math.max(0, x.queue_count - 1) } : x));
  }, [supabase]);

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
      <div className="max-w-[760px] mx-auto px-6 py-5">

        <div className="flex items-center gap-3.5 mb-1 flex-wrap">
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 24, color: "#f5f5f0" }}>
            Topics
          </span>
          <span className="text-[12px]" style={{ color: "#8b8b94" }}>
            Pick a question, queue up, get matched
          </span>
        </div>
        <p className="m-0 mb-5 text-[11px]" style={{ color: "#6b6b74" }}>
          The moment someone else queues on the same question, a live discussion opens with both of you in it.
        </p>

        {error && (
          <p className="mb-3 px-4 py-2.5 rounded-lg text-[12px]"
            style={{ background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
            {error}
          </p>
        )}

        {!loaded && (
          <p className="text-[12px] text-center py-8" style={{ color: "#6b6b74" }}>Loading…</p>
        )}

        <div className="flex flex-col gap-2.5 pb-8">
          {(() => {
            // Group questions by field of study; order categories by how
            // many people are actively waiting across their questions.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const groups = TOPICS
              .map((cat) => {
                const rows = topics
                  .filter((t) => t.topic_key === cat.key)
                  .sort((a, b) => b.queue_count - a.queue_count);
                return {
                  cat,
                  rows,
                  active: rows.reduce((n, t) => n + t.queue_count, 0),
                };
              })
              .filter((g) => g.rows.length > 0)
              .sort((a, b) => b.active - a.active);
            const other = topics
              .filter((t) => !TOPICS.some((c) => c.key === t.topic_key))
              .sort((a, b) => b.queue_count - a.queue_count);
            if (other.length) {
              groups.push({
                cat: { key: "other", label: "Other", emoji: "💬", color: "#8b8b94" } as unknown as (typeof TOPICS)[number],
                rows: other,
                active: other.reduce((n, t) => n + t.queue_count, 0),
              });
            }
            return groups.map((g) => (
              <div key={g.cat.key}>
                <p className="m-0 mb-2 mt-2 text-[12px]" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#c0c0c8" }}>
                  {g.cat.emoji} {g.cat.label}
                  {g.active > 0 && (
                    <span className="ml-2 text-[10.5px]" style={{ color: "#f4d47c", fontFamily: "'DM Sans', sans-serif", fontWeight: 400 }}>
                      {g.active} active
                    </span>
                  )}
                </p>
                <div className="flex flex-col gap-2.5">
                  {g.rows.map((t) => {
            const cat = TOPICS.find((x) => x.key === t.topic_key);
            const waiting = t.am_queued;
            return (
              <div
                key={t.id}
                className="p-4 flex items-center gap-3.5 flex-wrap"
                style={{
                  ...card,
                  border: waiting ? "0.5px solid rgba(226,185,107,0.45)" : (card.border as string),
                }}
              >
                <div className="flex-1 min-w-[240px]">
                  <p className="m-0 text-[15px]" style={{ color: "#f5f5f0", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>
                    {t.question}
                  </p>
                  <p className="m-0 mt-1 text-[11px]" style={{ color: t.queue_count > 0 ? "#f4d47c" : "#6b6b74" }}>
                    {t.queue_count > 0 ? `${t.queue_count} waiting to talk` : "no one waiting yet"}
                  </p>
                  {waiting && (
                    <p className="m-0 mt-1.5 text-[11px]" style={{ color: "#f4d47c" }}>
                      <span className="inline-block animate-pulse">●</span> In queue — you&rsquo;ll be
                      matched the moment someone joins. Keep this page open.
                    </p>
                  )}
                </div>
                {waiting ? (
                  <button
                    onClick={() => leaveQueue(t)}
                    disabled={busyId === t.id}
                    className="cursor-pointer text-[12px] px-4 py-2 rounded-lg shrink-0"
                    style={{ background: "transparent", border: "0.5px solid #3a3a42", color: "#c0c0c8", fontFamily: "inherit" }}
                  >
                    Leave queue
                  </button>
                ) : (
                  <button
                    onClick={() => queueUp(t)}
                    disabled={busyId === t.id}
                    className="cursor-pointer text-[12px] px-4 py-2 rounded-lg shrink-0"
                    style={{
                      background: t.queue_count > 0 ? "linear-gradient(135deg,#f7e3a0,#d9a238)" : "rgba(24,48,82,0.9)",
                      border: t.queue_count > 0 ? "0.5px solid #d9a238" : "0.5px solid #2c5382",
                      color: t.queue_count > 0 ? "#412402" : "#9cc4f0",
                      fontFamily: "inherit",
                      fontWeight: t.queue_count > 0 ? 600 : 400,
                    }}
                  >
                    {busyId === t.id ? "Joining…" : "Queue"}
                  </button>
                )}
              </div>
                  );
                  })}
                </div>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}
