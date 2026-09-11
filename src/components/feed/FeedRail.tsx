"use client";

/* Right rail beside Your Feed (lg+ only; the feed keeps its single
   column on smaller screens). Four compact blocks, all riding existing
   backends: Live now, Who to follow (get_people_suggestions), Queue —
   today's three most-waited-on Daily Topics (queue_for_topic /
   check_topic_match, same stanceless flow as the Browse board), and
   Upcoming (rooms you set reminders for). */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import { roomPath, userPath } from "@/lib/urls";
import { progressOnClick } from "@/lib/progress";
import { leaveQueue as leaveTopicQueue, openQueue, useQueue } from "@/lib/queue";

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

  /* The queue panel (lib/queue.ts) owns queueing: a topic's button
     opens it, or leaves the line it is already in. */
  const queue = useQueue();
  const toggleQueue = useCallback((t: RailTopic) => {
    if (queue.entries.some((e) => e.topicId === t.id)) { void leaveTopicQueue(t.id); return; }
    openQueue({ id: t.id, question: t.question, topicKey: t.topic_key, queueCount: t.queue_count });
  }, [queue.entries]);

  const follow = useCallback(async (p: Person) => {
    setFollowed((f) => new Set(f).add(p.id));
    const { error } = await supabase.rpc("follow_user", { p_target: p.id });
    /* The database can refuse (follow rate limit, unverified email —
       20260890): don't leave the button claiming otherwise. */
    if (error) setFollowed((f) => { const n = new Set(f); n.delete(p.id); return n; });
  }, [supabase]);

  return (
    <aside className="hidden xl:block shrink-0 sticky feed-rail" style={{ width: 310, top: "calc(var(--nav-height, 60px) + 8px)" }}>
      {live.length > 0 && (
        <>
          {sectionLabel("LIVE NOW", <span className="feed-live-dot" aria-hidden="true" />)}
          {live.map((r) => (
            <Link onClick={progressOnClick} key={r.id} href={roomPath(r)} className="flex items-center gap-2.5 mb-1 px-3.5 py-2 no-underline" style={liveRow}>
              <UserAvatar size={26} username={r.host?.username} avatarUrl={r.host?.avatar_url ?? null} seed={r.host?.id} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] truncate" style={{ color: "#eeeef5" }}>{r.motion}</span>
                <span className="block text-[10px]" style={{ color: "rgba(238,238,245,0.32)" }}>
                  {r.host?.display_name || r.host?.username}{r.viewer_count ? ` · ${r.viewer_count} watching` : ""}
                </span>
              </span>
              <Icon name="play" size={12} style={{ color: "#e84040", flexShrink: 0 }} />
            </Link>
          ))}
        </>
      )}

      {people.length > 0 && (
        <>
          {sectionLabel("WHO TO FOLLOW")}
          {people.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 mb-1 px-3.5 py-2" style={{ borderRadius: 10 }}>
              <Link onClick={progressOnClick} href={userPath(p.username)} className="no-underline shrink-0">
                <UserAvatar size={26} username={p.username} avatarUrl={p.avatar_url} seed={p.id} />
              </Link>
              <span className="min-w-0 flex-1">
                <Link onClick={progressOnClick} href={userPath(p.username)} className="block text-[12.5px] truncate no-underline" style={{ color: "#eeeef5" }}>
                  {p.display_name || p.username}
                </Link>
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
                {followed.has(p.id) ? <Icon name="check" size={11} /> : "Follow"}
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
                  {queue.entries.some((e) => e.topicId === t.id) ? "In line — waiting for a match…" : t.queue_count > 0 ? `${t.queue_count} waiting to talk` : "no one waiting yet"}
                </span>
              </span>
              <button
                onClick={() => toggleQueue(t)}
                disabled={queue.busy}
                className="cursor-pointer text-[10px] font-semibold px-2.5 py-1 rounded-md shrink-0 disabled:opacity-60"
                style={queue.entries.some((e) => e.topicId === t.id)
                  ? { background: "#1d4f8c", border: "none", color: "#fff", fontFamily: "inherit" }
                  : t.queue_count > 0
                    ? { background: "#ffb700", border: "none", color: "#1a0e00", fontFamily: "inherit" }
                    : { background: "#2f7fe0", border: "none", color: "#fff", fontFamily: "inherit" }}
              >
                {queue.entries.some((e) => e.topicId === t.id) ? "Leave" : "Queue"}
              </button>
            </div>
          ))}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          {sectionLabel("UPCOMING")}
          {upcoming.map((r) => (
            <Link onClick={progressOnClick} key={r.id} href={roomPath(r)} className="block mb-1 px-3.5 py-2 no-underline" style={quietRow}>
              <span className="block text-[12.5px] truncate" style={{ color: "#eeeef5" }}>{r.motion}</span>
              <span className="block text-[10px]" style={{ color: "#8b5cf6" }}>
                {new Date(r.scheduled_start).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
              </span>
            </Link>
          ))}
        </>
      )}
    </aside>
  );
}
