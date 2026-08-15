"use client";

/* Question queues + scheduled discussions on the homepage — rendered into
   the MVP markup (portal into #fieldsSection, below the classic Browse
   pills and Popular-rooms grid).

   The classic homepage chrome owns field selection (category pills →
   setActiveTopic in mvp-home.js); this component follows it via the
   'agora:topic' event and renders only what the classic page never had:
   1. Standing questions with Pro/Con matchmaking queues (RPCs:
      get_debate_topics / queue_for_topic / check_topic_match /
      leave_topic_queue — backed by 20260817_topic_queues.sql).
   2. Scheduled discussions with reminder sign-ups (toggle_room_reminder).
   Open/live rooms are NOT listed here — the Popular-rooms grid covers
   them. Headers reuse the classic .section-header/.section-title look. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS } from "@/types/database";

interface Props {
  container: HTMLElement | null;
  onCreateLobby: (topicKey: string) => void;
}

type TopicRow = {
  id: string;
  question: string;
  topic_key: string;
  queue_count: number;
  pro_count: number;
  con_count: number;
  am_queued: boolean;
  my_stance: "PRO" | "CON" | null;
};

type RoomRow = {
  id: string;
  motion: string;
  topic_key: string;
  status: string;
  format: string;
  scheduled_start: string | null;
  created_at: string;
  viewer_count: number | null;
  host: { username: string } | null;
  participants: { role: string; stance: string | null; left_at: string | null; user: { username: string } | null }[] | null;
};

const FORMAT_LABEL: Record<string, string> = {
  open: "Open",
  oxford: "Oxford",
  "1v1": "1v1",
  panel: "Panel",
};

const POLL_MS = 2500;
const REFRESH_MS = 30000;

/* Rooms carry scheduling as a scheduled_start on a 'created' (or
   'scheduled') row — mirror page.tsx's classification. */
const isScheduled = (r: { status: string; scheduled_start: string | null }) =>
  r.status !== "live" && !!r.scheduled_start;

const rowCard: React.CSSProperties = {
  background: "rgba(18,18,24,0.92)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

export default function TopicsHome({ container, onCreateLobby }: Props) {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState<string | null>(null);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [reminders, setReminders] = useState<Record<string, { count: number; amSet: boolean }>>({});
  // 'all' or a field key — mirrors the classic Browse pills. Initial value
  // comes from the same URL param / localStorage the pills persist to.
  const [selectedKey, setSelectedKey] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    try {
      return new URL(window.location.href).searchParams.get("topic")
        ?? localStorage.getItem("agora_topic")
        ?? "all";
    } catch { return "all"; }
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const anyQueued = topics.some((t) => t.am_queued);

  const load = useCallback(async () => {
    const [{ data: auth }, topicsRes, roomsRes] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc("get_debate_topics"),
      supabase
        .from("debate_rooms")
        .select("id, motion, topic_key, status, format, scheduled_start, created_at, viewer_count, host:users!host_id(username), participants:debate_participants(role, stance, left_at, user:users(username))")
        .in("status", ["live", "created", "scheduled"])
        .order("created_at", { ascending: false })
        .limit(80),
    ]);
    setUserId(auth?.user?.id ?? null);
    if (!topicsRes.error) setTopics((topicsRes.data ?? []) as TopicRow[]);
    if (!roomsRes.error) {
      const rows = (roomsRes.data ?? []) as unknown as RoomRow[];
      setRooms(rows);
      const scheduledIds = rows.filter((r) => isScheduled(r)).map((r) => r.id);
      if (scheduledIds.length) {
        const { data: rem } = await supabase.rpc("get_room_reminders", { p_rooms: scheduledIds });
        const map: Record<string, { count: number; amSet: boolean }> = {};
        for (const r of (rem ?? []) as { room_id: string; reminder_count: number; am_set: boolean }[]) {
          map[r.room_id] = { count: Number(r.reminder_count), amSet: r.am_set };
        }
        setReminders(map);
      } else {
        setReminders({});
      }
    }
  }, [supabase]);

  /* Follow the classic Browse pills (mvp-home.js setActiveTopic). */
  useEffect(() => {
    const onTopic = (e: Event) => {
      const key = (e as CustomEvent).detail;
      if (typeof key === "string") setSelectedKey(key);
    };
    window.addEventListener("agora:topic", onTopic);
    return () => window.removeEventListener("agora:topic", onTopic);
  }, []);

  useEffect(() => {
    load();
    const heartbeat = setInterval(load, REFRESH_MS);
    const channel = supabase
      .channel("topics-home")
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_rooms" }, load)
      .subscribe();
    return () => {
      clearInterval(heartbeat);
      supabase.removeChannel(channel);
    };
  }, [load, supabase]);

  /* While queued anywhere: poll for a match; also refresh counts so the
     board feels alive. */
  useEffect(() => {
    if (!anyQueued || !userId) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(async () => {
      const { data: roomId } = await supabase.rpc("check_topic_match");
      if (roomId) {
        if (pollRef.current) clearInterval(pollRef.current);
        window.location.href = `/agora/${roomId}`;
        return;
      }
      load();
    }, POLL_MS);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [anyQueued, userId, supabase, load]);

  const queueUp = useCallback(async (t: TopicRow, stance: "PRO" | "CON") => {
    if (!userId) { window.location.href = "/login"; return; }
    setBusyId(t.id);
    setError(null);
    const { data, error: err } = await supabase.rpc("queue_for_topic", { p_topic: t.id, p_stance: stance });
    setBusyId(null);
    if (err) {
      setError(err.message.includes("suspended") ? "Your account is suspended." : err.message);
      return;
    }
    const res = data as { status: string; room_id?: string };
    if (res?.status === "matched" && res.room_id) {
      window.location.href = `/agora/${res.room_id}`;
      return;
    }
    setTopics((ts) => ts.map((x) =>
      x.id === t.id
        ? {
            ...x,
            am_queued: true,
            my_stance: stance,
            queue_count: x.queue_count + 1,
            pro_count: x.pro_count + (stance === "PRO" ? 1 : 0),
            con_count: x.con_count + (stance === "CON" ? 1 : 0),
          }
        : x));
  }, [supabase, userId]);

  const leaveQueue = useCallback(async (t: TopicRow) => {
    setBusyId(t.id);
    await supabase.rpc("leave_topic_queue", { p_topic: t.id });
    setBusyId(null);
    setTopics((ts) => ts.map((x) =>
      x.id === t.id
        ? {
            ...x,
            am_queued: false,
            my_stance: null,
            queue_count: Math.max(0, x.queue_count - 1),
            pro_count: Math.max(0, x.pro_count - (x.my_stance === "PRO" ? 1 : 0)),
            con_count: Math.max(0, x.con_count - (x.my_stance === "CON" ? 1 : 0)),
          }
        : x));
  }, [supabase]);

  if (!container) return null;

  // 'all' shows the busiest questions across every field; a selected field
  // narrows both sections to it (matching what the grid above shows).
  const selCat = TOPICS.find((c) => c.key === selectedKey) ?? null;
  const fieldLabel = selCat ? selCat.label : "all fields";
  const selRows = topics
    .filter((t) => !selCat || t.topic_key === selCat.key)
    .sort((a, b) => b.queue_count - a.queue_count)
    .slice(0, selCat ? undefined : 8);
  const fieldRooms = rooms.filter((r) => !selCat || r.topic_key === selCat.key);
  const selScheduled = fieldRooms
    .filter(isScheduled)
    .sort((a, b) => (reminders[b.id]?.count ?? 0) - (reminders[a.id]?.count ?? 0));

  const speakerLine = (r: RoomRow) => {
    const seated = (r.participants ?? [])
      .filter((p) => p.role === "debater" && !p.left_at && p.user?.username)
      .map((p) => p.user!.username);
    if (seated.length) return seated.join(" vs ");
    return r.host?.username ? `hosted by ${r.host.username}` : "speakers TBD";
  };

  const toggleReminder = async (r: RoomRow) => {
    if (!userId) { window.location.href = "/login"; return; }
    setBusyId(r.id);
    setError(null);
    const { data, error: err } = await supabase.rpc("toggle_room_reminder", { p_room: r.id });
    setBusyId(null);
    if (err) {
      setError(err.message.includes("suspended") ? "Your account is suspended." : err.message);
      return;
    }
    const nowSet = data === true;
    setReminders((m) => {
      const cur = m[r.id] ?? { count: 0, amSet: false };
      return { ...m, [r.id]: { count: Math.max(0, cur.count + (nowSet ? 1 : -1)), amSet: nowSet } };
    });
  };

  return createPortal(
    <div style={{ fontFamily: "'DM Sans', sans-serif", margin: "6px 0" }}>
      {error && (
        <p className="mt-3 mb-0 px-4 py-2.5 rounded-lg text-[12px]"
          style={{ background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
          {error}
        </p>
      )}

      {/* Question queues — classic section header, grid-matching chrome */}
      <div className="section-header" style={{ marginTop: 26 }}>
        <div className="section-title">
          Open questions{selCat ? ` · ${selCat.emoji} ${selCat.label}` : ""}
        </div>
        <a
          className="view-all"
          href="#"
          onClick={(e) => { e.preventDefault(); onCreateLobby(selCat?.key ?? TOPICS[0].key); }}
        >
          + Create a room
        </a>
      </div>
      <div className="flex flex-col gap-2">
        {selRows.map((t) => {
          const inQueue = t.am_queued;
          return (
            <div
              key={t.id}
              className="p-3.5 flex items-center gap-3.5 flex-wrap"
              style={{
                ...rowCard,
                border: inQueue ? "0.5px solid rgba(226,185,107,0.45)" : (rowCard.border as string),
              }}
            >
              <div className="flex-1 min-w-[220px]">
                <p className="m-0 text-[14px]" style={{ color: "#f5f5f0", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>
                  {t.question}
                </p>
                <p className="m-0 mt-1 text-[11px]" style={{ color: "#6b6b74" }}>
                  {t.queue_count > 0 ? (
                    <>
                      <span style={{ color: t.pro_count > 0 ? "#97c459" : "#6b6b74" }}>{t.pro_count} on Pro</span>
                      {" · "}
                      <span style={{ color: t.con_count > 0 ? "#e05a5a" : "#6b6b74" }}>{t.con_count} on Con</span>
                    </>
                  ) : (
                    "no one waiting yet"
                  )}
                </p>
                {inQueue && (
                  <p className="m-0 mt-1.5 text-[11px]" style={{ color: "#f4d47c" }}>
                    <span className="inline-block animate-pulse">●</span> In queue on{" "}
                    {t.my_stance === "CON" ? "Con" : "Pro"} — you&rsquo;ll be matched the moment
                    someone takes the other side. Keep this page open.
                  </p>
                )}
              </div>
              {inQueue ? (
                <button
                  onClick={() => leaveQueue(t)}
                  disabled={busyId === t.id}
                  className="cursor-pointer text-[12px] px-4 py-2 rounded-lg shrink-0"
                  style={{ background: "transparent", border: "0.5px solid #3a3a42", color: "#c0c0c8", fontFamily: "inherit" }}
                >
                  Leave queue
                </button>
              ) : (
                <div className="flex gap-2 shrink-0">
                  {/* The side that matches instantly (someone waits opposite) gets the gold treatment. */}
                  <button
                    onClick={() => queueUp(t, "PRO")}
                    disabled={busyId === t.id}
                    className="cursor-pointer text-[12px] px-3.5 py-2 rounded-lg"
                    style={{
                      background: t.con_count > 0 ? "linear-gradient(135deg,#f7e3a0,#d9a238)" : "rgba(28,46,24,0.9)",
                      border: t.con_count > 0 ? "0.5px solid #d9a238" : "0.5px solid #3d5a33",
                      color: t.con_count > 0 ? "#412402" : "#97c459",
                      fontFamily: "inherit",
                      fontWeight: t.con_count > 0 ? 600 : 400,
                    }}
                  >
                    {busyId === t.id ? "…" : "Pro"}
                  </button>
                  <button
                    onClick={() => queueUp(t, "CON")}
                    disabled={busyId === t.id}
                    className="cursor-pointer text-[12px] px-3.5 py-2 rounded-lg"
                    style={{
                      background: t.pro_count > 0 ? "linear-gradient(135deg,#f7e3a0,#d9a238)" : "rgba(52,24,24,0.9)",
                      border: t.pro_count > 0 ? "0.5px solid #d9a238" : "0.5px solid #5a3333",
                      color: t.pro_count > 0 ? "#412402" : "#e05a5a",
                      fontFamily: "inherit",
                      fontWeight: t.pro_count > 0 ? 600 : 400,
                    }}
                  >
                    {busyId === t.id ? "…" : "Con"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {selRows.length === 0 && (
          <p className="m-0 text-[11.5px] px-1" style={{ color: "#6b6b74" }}>
            No standing questions in {fieldLabel} yet.
          </p>
        )}
      </div>

      {/* Scheduled discussions — their own classic section, ordered by sign-ups */}
      {selScheduled.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 24 }}>
            <div className="section-title">Scheduled</div>
          </div>
          <div className="flex flex-col gap-2">
            {selScheduled.map((r) => (
              <div
                key={r.id}
                className="p-3.5 flex items-center gap-3.5 flex-wrap"
                style={rowCard}
              >
                <div
                  className="shrink-0 px-3 py-2 text-center rounded-lg"
                  style={{ background: "rgba(35,24,52,0.85)", border: "0.5px solid #43315e", minWidth: 74 }}
                >
                  <p className="m-0 text-[11px]" style={{ color: "#c9a6f0", fontWeight: 600 }}>
                    {r.scheduled_start
                      ? new Date(r.scheduled_start).toLocaleDateString([], { month: "short", day: "numeric" })
                      : "TBD"}
                  </p>
                  <p className="m-0 text-[11px]" style={{ color: "#8b8b94" }}>
                    {r.scheduled_start
                      ? new Date(r.scheduled_start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                      : ""}
                  </p>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <p className="m-0 text-[13.5px]" style={{ color: "#f5f5f0", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>
                    {r.motion}
                  </p>
                  <p className="m-0 mt-1 text-[11px]" style={{ color: "#8b8b94" }}>
                    {speakerLine(r)} · {FORMAT_LABEL[r.format] ?? r.format}
                    <span style={{ color: (reminders[r.id]?.count ?? 0) > 0 ? "#f4d47c" : "#6b6b74" }}>
                      {" "}· 🔔 {reminders[r.id]?.count ?? 0} signed up
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => toggleReminder(r)}
                  disabled={busyId === r.id}
                  className="cursor-pointer text-[12px] px-3.5 py-2 rounded-lg shrink-0"
                  style={{
                    background: reminders[r.id]?.amSet ? "rgba(226,185,107,0.14)" : "transparent",
                    border: reminders[r.id]?.amSet ? "0.5px solid rgba(226,185,107,0.5)" : "0.5px solid #3a3a42",
                    color: reminders[r.id]?.amSet ? "#f4d47c" : "#c0c0c8",
                    fontFamily: "inherit",
                  }}
                >
                  {reminders[r.id]?.amSet ? "🔔 Reminder set" : "🔔 Notify me"}
                </button>
                <button
                  onClick={() => { window.location.href = `/agora/${r.id}`; }}
                  className="cursor-pointer text-[12px] px-4 py-2 rounded-lg shrink-0"
                  style={{ background: "rgba(24,48,82,0.9)", border: "0.5px solid #2c5382", color: "#9cc4f0", fontFamily: "inherit" }}
                >
                  View
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>,
    container
  );
}
