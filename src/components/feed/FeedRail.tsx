"use client";

/* Right rail beside Your Feed (lg+ only; the feed keeps its single
   column on smaller screens). Four compact blocks, all riding existing
   backends: Live now, Who to follow (get_people_suggestions), Queue —
   today's three most-waited-on Daily Topics (queue_for_topic /
   check_topic_match, same stanceless flow as the Browse board), and
   Upcoming (rooms you set reminders for). */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import { roomPath, userPath } from "@/lib/urls";

interface LiveRoom {
  id: string;
  motion: string;
  viewer_count: number | null;
  host: { id: string; username: string; display_name: string | null; avatar_url: string | null } | null;
}
interface Person {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  reason: string;
}
interface RailTopic {
  id: string;
  question: string;
  topic_key: string;
  queue_count: number;
  am_queued: boolean;
}
interface Upcoming {
  id: string;
  motion: string;
  scheduled_start: string;
}

/* Styled to match the Communities right rail: bare list, 10px uppercase
   section titles, px-3.5 py-2 rounded rows — tinted only where the
   Communities rail tints (red for live, faint white for scheduled). */
function sectionLabel(text: string, accent?: React.ReactNode) {
  return (
    <p className="m-0 mt-3 mb-1 px-3.5 text-[10px] font-bold flex items-center gap-1.5" style={{ color: "rgba(238,238,245,0.32)", letterSpacing: "0.08em" }}>
      {accent}
      {text}
    </p>
  );
}

const liveRow: React.CSSProperties = {
  borderRadius: 10,
  background: "rgba(232,64,64,0.06)",
  border: "0.5px solid rgba(232,64,64,0.3)",
};
const quietRow: React.CSSProperties = {
  borderRadius: 10,
  background: "rgba(255,255,255,0.03)",
  border: "0.5px solid rgba(255,255,255,0.07)",
};

/* userId null = signed-out viewer (public profile pages): the reminders
   query is skipped and the auth-only sections simply stay empty. */
export default function FeedRail({ userId }: { userId: string | null }) {
  const [supabase] = useState(() => createClient());
  const [live, setLive] = useState<LiveRoom[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [topics, setTopics] = useState<RailTopic[]>([]);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [queueBusy, setQueueBusy] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);

  const loadLive = useCallback(async () => {
    const { data } = await supabase
      .from("debate_rooms")
      .select("id, motion, viewer_count, host:users!debate_rooms_host_id_fkey(id, username, display_name, avatar_url)")
      .eq("status", "live")
      .eq("is_private", false)
      .order("viewer_count", { ascending: false })
      .limit(4);
    setLive((data as unknown as LiveRoom[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    let alive = true;
    loadLive();
    const t = setInterval(loadLive, 60_000);

    supabase.rpc("get_people_suggestions", { p_limit: 4 }).then(({ data }) => {
      if (alive) setPeople((data as Person[] | null) ?? []);
    });

    supabase.rpc("get_debate_topics").then(({ data }) => {
      if (!alive) return;
      const rows = (data as RailTopic[] | null) ?? [];
      /* "Popular": most people waiting first; break ties by spreading
         across categories so the rail isn't three politics questions. */
      const sorted = rows.slice().sort((a, b) => b.queue_count - a.queue_count);
      const picked: RailTopic[] = [];
      const seenCats = new Set<string>();
      for (const t of sorted) {
        if (picked.length >= 3) break;
        if (t.queue_count > 0 || !seenCats.has(t.topic_key)) {
          picked.push(t);
          seenCats.add(t.topic_key);
        }
      }
      setTopics(picked.slice(0, 3));
      setQueued(new Set(rows.filter((r) => r.am_queued).map((r) => r.id)));
    });

    if (userId) supabase
      .from("room_reminders")
      .select("room:debate_rooms(id, motion, scheduled_start, status)")
      .eq("user_id", userId)
      .then(({ data }) => {
        if (!alive) return;
        const rooms = ((data ?? []) as unknown as Array<{ room: (Upcoming & { status: string }) | null }>)
          .map((r) => r.room)
          .filter((r): r is Upcoming & { status: string } =>
            !!r && !!r.scheduled_start && r.status !== "ended" && new Date(r.scheduled_start).getTime() > Date.now())
          .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start))
          .slice(0, 3);
        setUpcoming(rooms);
      });

    return () => { alive = false; clearInterval(t); };
  }, [supabase, userId, loadLive]);

  /* Stanceless queue: same flow as the Browse board — the poll jumps
     straight into the room on a match. */
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ensurePoll = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const { data: roomId } = await supabase.rpc("check_topic_match");
      if (roomId) {
        if (pollRef.current) clearInterval(pollRef.current);
        window.location.href = `/agora/${roomId}`;
      }
    }, 2500);
  }, [supabase]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const toggleQueue = useCallback(async (t: RailTopic) => {
    if (queueBusy) return;
    setQueueBusy(t.id);
    if (queued.has(t.id)) {
      await supabase.rpc("leave_topic_queue", { p_topic: t.id });
      setQueued((q) => { const n = new Set(q); n.delete(t.id); return n; });
      setQueueBusy(null);
      if (pollRef.current && queued.size <= 1) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    const { data, error } = await supabase.rpc("queue_for_topic", { p_topic: t.id, p_stance: "PRO" });
    setQueueBusy(null);
    if (error) return;
    const res = data as { status?: string; room_id?: string } | null;
    if (res?.status === "matched" && res.room_id) { window.location.href = `/agora/${res.room_id}`; return; }
    setQueued((q) => new Set(q).add(t.id));
    ensurePoll();
  }, [supabase, queued, queueBusy, ensurePoll]);

  const follow = useCallback(async (p: Person) => {
    setFollowed((f) => new Set(f).add(p.id));
    await supabase.rpc("follow_user", { p_target: p.id });
  }, [supabase]);

  return (
    <aside className="hidden lg:block shrink-0 sticky feed-rail" style={{ width: 310, top: "calc(var(--nav-height, 60px) + 8px)" }}>
      {live.length > 0 && (
        <>
          {sectionLabel("LIVE NOW", <span style={{ color: "#ef4444", letterSpacing: 0 }}>●</span>)}
          {live.map((r) => (
            <a key={r.id} href={roomPath(r)} className="flex items-center gap-2.5 mb-1 px-3.5 py-2 no-underline" style={liveRow}>
              <UserAvatar size={26} username={r.host?.username} avatarUrl={r.host?.avatar_url ?? null} seed={r.host?.id} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] truncate" style={{ color: "#eeeef5" }}>{r.motion}</span>
                <span className="block text-[10px]" style={{ color: "rgba(238,238,245,0.32)" }}>
                  {r.host?.display_name || r.host?.username}{r.viewer_count ? ` · ${r.viewer_count} watching` : ""}
                </span>
              </span>
              <Icon name="play" size={12} style={{ color: "#e84040", flexShrink: 0 }} />
            </a>
          ))}
        </>
      )}

      {people.length > 0 && (
        <>
          {sectionLabel("WHO TO FOLLOW")}
          {people.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 mb-1 px-3.5 py-2" style={{ borderRadius: 10 }}>
              <a href={userPath(p.username)} className="no-underline shrink-0">
                <UserAvatar size={26} username={p.username} avatarUrl={p.avatar_url} seed={p.id} />
              </a>
              <span className="min-w-0 flex-1">
                <a href={userPath(p.username)} className="block text-[12.5px] truncate no-underline" style={{ color: "#eeeef5" }}>
                  {p.display_name || p.username}
                </a>
                <span className="block text-[10px] truncate" style={{ color: "rgba(238,238,245,0.32)" }}>{p.reason}</span>
              </span>
              <button
                onClick={() => follow(p)}
                disabled={followed.has(p.id)}
                className="cursor-pointer text-[10px] font-semibold px-2 py-1 rounded-md shrink-0 disabled:cursor-default"
                style={followed.has(p.id)
                  ? { background: "transparent", border: "0.5px solid rgba(111,211,160,0.4)", color: "#6fd3a0", fontFamily: "inherit" }
                  : { background: "#2f7fe0", border: "none", color: "#fff", fontFamily: "inherit", borderRadius: 6 }}
              >
                {followed.has(p.id) ? "✓" : "Follow"}
              </button>
            </div>
          ))}
        </>
      )}

      {topics.length > 0 && (
        <>
          {sectionLabel("QUEUE A CONVERSATION")}
          {topics.map((t) => (
            <div key={t.id} className="flex items-center gap-2.5 mb-1 px-3.5 py-2" style={quietRow}>
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] leading-snug" style={{
                  color: "rgba(238,238,245,0.88)",
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>
                  {t.question}
                </span>
                <span className="block mt-0.5 text-[10px]" style={{ color: "rgba(238,238,245,0.32)" }}>
                  {queued.has(t.id) ? "In line — waiting for a match…" : t.queue_count > 0 ? `${t.queue_count} waiting to talk` : "no one waiting yet"}
                </span>
              </span>
              <button
                onClick={() => toggleQueue(t)}
                disabled={queueBusy === t.id}
                className="cursor-pointer text-[10px] font-semibold px-2.5 py-1 rounded-md shrink-0 disabled:opacity-60"
                style={queued.has(t.id)
                  ? { background: "#1d4f8c", border: "none", color: "#fff", fontFamily: "inherit" }
                  : t.queue_count > 0
                    ? { background: "#ffb700", border: "none", color: "#1a0e00", fontFamily: "inherit" }
                    : { background: "#2f7fe0", border: "none", color: "#fff", fontFamily: "inherit" }}
              >
                {queueBusy === t.id ? "…" : queued.has(t.id) ? "Leave" : "Queue"}
              </button>
            </div>
          ))}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          {sectionLabel("UPCOMING")}
          {upcoming.map((r) => (
            <a key={r.id} href={roomPath(r)} className="block mb-1 px-3.5 py-2 no-underline" style={quietRow}>
              <span className="block text-[12.5px] truncate" style={{ color: "#eeeef5" }}>{r.motion}</span>
              <span className="block text-[10px]" style={{ color: "#8b5cf6" }}>
                {new Date(r.scheduled_start).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
              </span>
            </a>
          ))}
        </>
      )}
    </aside>
  );
}
