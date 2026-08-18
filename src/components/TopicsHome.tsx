"use client";

/* Topics on the homepage — rendered into the MVP markup (portal into
   #fieldsSection, just below the live carousel).

   Layout: a horizontal row of field-of-study pills (like the Browse row —
   all fields side by side, one selected). Below the row, the selected
   field shows:
   1. Its standing questions with matchmaking queues (same RPCs as the old
      Topics tab: get_debate_topics / queue_for_topic / check_topic_match /
      leave_topic_queue — backed by 20260817_topic_queues.sql).
   2. Open rooms in that field — live discussions plus lobbies people
      created ('created'/'scheduled') — and a button to open your own. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS } from "@/types/database";
import TopicIcon from "./topicIcons";
import { useUserMenu } from "./userMenuContext";
import { roomPath } from "@/lib/urls";
import { displayName } from "@/lib/names";
import UserAvatar from "./UserAvatar";

interface Props {
  container: HTMLElement | null;
  onCreateLobby: (topicKey: string, schedule?: boolean) => void;
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
  thumbnail_url?: string | null;
  host: { id: string; username: string; display_name?: string | null; avatar_url: string | null } | null;
  participants: { role: string; stance: string | null; left_at: string | null; user: { id: string; username: string; display_name?: string | null; avatar_url: string | null } | null }[] | null;
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

/* Field key → Explore page category-pill label (the pills filter rooms by
   label substring, so "Law" selects the Politics (Law) rooms exactly). */
const EXPLORE_PILL: Record<string, string> = {
  "politics-law": "Law",
  ethics: "Ethics",
  sports: "Sports",
  culture: "Culture",
  economics: "Economics",
  "science-tech": "Science & Tech",
  "foreign-policy": "Foreign Policy",
  philosophy: "Philosophy",
};

const rowCard: React.CSSProperties = {
  background: "rgba(11,11,13,0.95)",
  border: "0.5px solid #2e2e38",
  borderRadius: 12,
};

export default function TopicsHome({ container, onCreateLobby }: Props) {
  const [supabase] = useState(() => createClient());
  const { openUserMenu } = useUserMenu();

  /* Clickable username → unified user context menu (profile, follow, report). */
  const nameSpan = (u: { id: string; username: string; display_name?: string | null; avatar_url?: string | null } | null | undefined) =>
    u ? (
      <span
        onClick={(e) => {
          e.stopPropagation();
          openUserMenu({ x: e.clientX, y: e.clientY }, { userId: u.id, username: u.username });
        }}
        className="inline-flex items-center gap-1"
        style={{
          cursor: "pointer",
          verticalAlign: "middle",
          lineHeight: 1,
          textDecoration: "underline dotted rgba(255,255,255,0.25)",
          textUnderlineOffset: 2,
        }}
      >
        <UserAvatar size={13} username={u.username} avatarUrl={u.avatar_url} seed={u.id} />
        {displayName(u)}
      </span>
    ) : null;
  const [userId, setUserId] = useState<string | null>(null);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [reminders, setReminders] = useState<Record<string, { count: number; amSet: boolean }>>({});
  const [selectedKey, setSelectedKey] = useState<string>(TOPICS[0].key);
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
        .select("id, motion, topic_key, status, format, scheduled_start, created_at, viewer_count, thumbnail_url, host:users!host_id(id, username, display_name, avatar_url), participants:debate_participants(role, stance, left_at, user:users(id, username, display_name, avatar_url))")
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

  const selCat = TOPICS.find((c) => c.key === selectedKey) ?? TOPICS[0];
  const selRows = topics
    .filter((t) => t.topic_key === selCat.key)
    .sort((a, b) => b.queue_count - a.queue_count);
  // Popular rooms: live first (most watched on top), then open lobbies
  // (newest first). Scheduled discussions get their own section, ordered
  // by how many people signed up for a reminder.
  const fieldRooms = rooms.filter((r) => r.topic_key === selCat.key);
  const selRooms = fieldRooms
    .filter((r) => !isScheduled(r))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "live" ? -1 : 1;
      if (a.status === "live") return (b.viewer_count ?? 0) - (a.viewer_count ?? 0);
      return b.created_at.localeCompare(a.created_at);
    });
  const selScheduled = fieldRooms
    .filter(isScheduled)
    .sort((a, b) => (reminders[b.id]?.count ?? 0) - (reminders[a.id]?.count ?? 0));

  const speakerLine = (r: RoomRow) => {
    const seated = (r.participants ?? [])
      .filter((p) => p.role === "debater" && !p.left_at && p.user?.username);
    if (seated.length) {
      return seated.map((p, i) => (
        <span key={p.user!.id} className="inline-flex items-center gap-1">
          {i > 0 && <span>vs</span>}
          {nameSpan(p.user)}
        </span>
      ));
    }
    return r.host?.username ? (
      <span className="inline-flex items-center gap-1">
        <span>hosted by</span> {nameSpan(r.host)}
      </span>
    ) : (
      "speakers TBD"
    );
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
    // No top margin: the carousel section's 40px bottom margin is the
    // uniform section gap used across the page.
    <div style={{ fontFamily: "'DM Sans', sans-serif", margin: "0 0 6px" }}>
      <div className="flex items-baseline gap-3 flex-wrap mb-3">
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: 19, color: "#f5f5f0" }}>
          Browse
        </span>
      </div>

      {/* Field pills — side by side, like the Browse row */}
      <div
        className="flex gap-2.5 pb-1 hide-scrollbar"
        style={{ overflowX: "auto" }}
        role="tablist"
        aria-label="Fields of study"
      >
        {TOPICS.map((cat) => {
          const active = cat.key === selCat.key;
          const catTopics = topics.filter((t) => t.topic_key === cat.key);
          const waiting = catTopics.reduce((n, t) => n + t.queue_count, 0);
          const queuedHere = catTopics.some((t) => t.am_queued);
          const live = rooms.filter((r) => r.topic_key === cat.key && r.status === "live").length;
          const scheduled = rooms.filter((r) => r.topic_key === cat.key && isScheduled(r)).length;
          const open = rooms.filter((r) => r.topic_key === cat.key && r.status !== "live" && !isScheduled(r)).length;
          /* Status line: active states get a glowing dot + small-caps count;
             quiet stays a bare dim word so busy tabs pop against it. */
          const status = live > 0
            ? { label: `${live} LIVE`, color: "#ff5c5c", dot: true, pulse: true }
            : waiting > 0
              ? { label: `${waiting} WAITING`, color: "#f4d47c", dot: true, pulse: false }
              : open > 0
                ? { label: `${open} OPEN`, color: "#6fd3a0", dot: true, pulse: false }
                : scheduled > 0
                  ? { label: `${scheduled} SCHEDULED`, color: "#a99df2", dot: true, pulse: false }
                  : { label: "quiet", color: "#565660", dot: false, pulse: false };
          return (
            <button
              key={cat.key}
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedKey(cat.key)}
              className="cursor-pointer shrink-0 px-4 py-2 text-left"
              style={{
                background: "rgba(11,11,13,0.95)",
                border: active ? "1px solid #d9a238" : "0.5px solid #2e2e38",
                boxShadow: active ? "0 0 12px rgba(217,162,56,0.25)" : "none",
                borderRadius: 999,
                fontFamily: "inherit",
              }}
            >
              {/* Icon left of the whole text block; label + status stack beside it. */}
              <span className="flex items-center gap-2.5" style={{ color: active ? "#f4d47c" : "#f5f5f0" }}>
                <TopicIcon topicKey={cat.key} size={17} />
                <span className="flex flex-col items-start">
                  <span className="flex items-center gap-1.5 text-[12.5px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: active ? "#f4d47c" : "#f5f5f0", whiteSpace: "nowrap" }}>
                    {cat.label}
                    {queuedHere && <span className="animate-pulse text-[9px]" style={{ color: "#f4d47c" }}>●</span>}
                  </span>
                  <span
                    className="flex items-center gap-1 mt-0.5"
                    style={{
                      color: status.color,
                      whiteSpace: "nowrap",
                      fontSize: status.dot ? 9 : 10,
                      fontWeight: status.dot ? 700 : 400,
                      letterSpacing: status.dot ? "0.07em" : 0,
                      fontStyle: status.dot ? "normal" : "italic",
                      opacity: status.dot ? 1 : 0.8,
                    }}
                  >
                    {status.dot && (
                      <span
                        className={status.pulse ? "animate-pulse" : undefined}
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 999,
                          background: status.color,
                          boxShadow: `0 0 6px ${status.color}`,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    {status.label}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mt-3 mb-0 px-4 py-2.5 rounded-lg text-[12px]"
          style={{ background: "rgba(239,68,68,0.08)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 mt-3">

        {/* Popular rooms (left) and scheduled debates (right) share a row;
            the queue grid sits underneath. Wraps to stacked on narrow screens. */}
        <div className="flex gap-5 items-start flex-wrap">
        <div className="min-w-0 flex flex-col gap-2" style={{ flex: "1 1 0", minWidth: 320 }}>
        {/* Selected field: popular rooms */}
        <div className="flex items-center gap-3 mb-0.5">
          <span className="text-[11px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "#9cc4f0", letterSpacing: "0.04em" }}>
            POPULAR ROOMS
          </span>
          <span className="flex-1" style={{ height: 0.5, background: "#26262e" }} />
          <button
            onClick={() => {
              // Hand off to the MVP Explore page with this field's category
              // filter pre-selected (pills are engine-owned DOM).
              const label = EXPLORE_PILL[selCat.key];
              (document.querySelector('[data-nav-id="explore"]') as HTMLElement | null)?.click();
              setTimeout(() => {
                const pill = [...document.querySelectorAll("#epCategoryFilter .explore-pill")]
                  .find((p) => p.textContent?.trim() === label);
                const w = window as unknown as { _epFilter?: (el: Element, group: string) => void };
                if (pill && w._epFilter) w._epFilter(pill, "category");
              }, 120);
            }}
            className="cursor-pointer text-[11px] px-3 py-1.5 rounded-lg"
            style={{ background: "transparent", border: "0.5px solid #3a3a42", color: "#c0c0c8", fontFamily: "inherit" }}
          >
            Explore all {selCat.label} rooms →
          </button>
          <button
            onClick={() => onCreateLobby(selCat.key)}
            className="cursor-pointer text-[11px] px-3 py-1.5 rounded-lg"
            style={{ background: "rgba(255,255,255,0.07)", border: "0.5px solid #3a3a42", color: "#e0e0e6", fontFamily: "inherit" }}
          >
            + Create a room
          </button>
        </div>

        {selRooms.length === 0 && (
          <p className="m-0 text-[11px]" style={{ color: "#6b6b74" }}>
            No open rooms in {selCat.label} yet — start one and pick your own question.
          </p>
        )}

        {selRooms.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {selRooms.map((r) => (
              <div
                key={r.id}
                role="link"
                tabIndex={0}
                onClick={() => { window.location.href = roomPath(r); }}
                onKeyDown={(e) => { if (e.key === "Enter") window.location.href = roomPath(r); }}
                className="cursor-pointer shrink-0"
                style={{ ...rowCard, width: 168, height: 168, borderRadius: 16, overflow: "hidden", position: "relative" }}
              >
                {/* Host-picked thumbnail; their profile picture is the default */}
                <div style={{ position: "absolute", inset: 0 }}>
                  {r.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumbnail_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  ) : (
                    <UserAvatar
                      size={168}
                      radius={0}
                      username={r.host?.username}
                      avatarUrl={r.host?.avatar_url}
                      seed={r.host?.id}
                    />
                  )}
                  {r.status === "live" ? (
                    <span
                      style={{
                        position: "absolute", top: 8, left: 8,
                        background: "#ef4444", color: "white",
                        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
                        padding: "2px 7px", borderRadius: 6,
                      }}
                    >
                      LIVE
                    </span>
                  ) : (
                    <span
                      style={{
                        position: "absolute", top: 8, left: 8,
                        background: "rgba(59,130,246,0.85)", color: "white",
                        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
                        padding: "2px 7px", borderRadius: 6,
                      }}
                    >
                      OPEN
                    </span>
                  )}
                  {/* Topic — plain muted text, matching the Explore cards */}
                  <span
                    style={{
                      position: "absolute", top: 9, right: 10,
                      color: "rgba(255,255,255,0.65)",
                      fontSize: 10, fontWeight: 500,
                      textShadow: "0 1px 4px rgba(0,0,0,0.9)",
                    }}
                  >
                    {selCat.label}
                  </span>
                </div>
                {/* Info overlaid on the photo — keeps the block a true square */}
                <div
                  className="px-2.5 pb-2 pt-6"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "linear-gradient(transparent, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.88))",
                  }}
                >
                  <p
                    className="m-0 text-[12px]"
                    style={{
                      color: "white",
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontWeight: 700,
                      lineHeight: 1.25,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                    }}
                  >
                    {r.motion}
                  </p>
                  {r.host?.username && (
                    <p className="m-0 mt-0.5 text-[10.5px] flex items-center gap-1" style={{ color: "rgba(255,255,255,0.8)" }}>
                      <span>by</span> {nameSpan(r.host)}
                    </p>
                  )}
                  <p className="m-0 mt-0.5 text-[9.5px]" style={{ color: "rgba(255,255,255,0.55)" }}>
                    {FORMAT_LABEL[r.format] ?? r.format}
                    {r.status === "live"
                      ? ` · ${r.viewer_count ?? 0} watching`
                      : " · waiting for speakers"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        </div>
        <div className="min-w-0 flex flex-col gap-2" style={{ flex: "1 1 0", minWidth: 320 }}>
        {/* Scheduled discussions — their own section, ordered by sign-ups.
            Empty topics keep the half: a standing invitation to fill it. */}
        {selScheduled.length > 0 ? (
          <>
            <div className="flex items-center gap-3 mt-2.5 mb-0.5">
              <span className="text-[11px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "#c9a6f0", letterSpacing: "0.04em" }}>
                SCHEDULED
              </span>
              <span className="flex-1" style={{ height: 0.5, background: "#26262e" }} />
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {selScheduled.map((r) => (
                <div
                  key={r.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => { window.location.href = roomPath(r); }}
                  onKeyDown={(e) => { if (e.key === "Enter") window.location.href = roomPath(r); }}
                  className="cursor-pointer shrink-0"
                  style={{ ...rowCard, width: 168, height: 168, borderRadius: 16, overflow: "hidden", position: "relative" }}
                >
                  {/* Host-picked thumbnail; their profile picture is the default */}
                  <div style={{ position: "absolute", inset: 0 }}>
                    {r.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.thumbnail_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : (
                      <UserAvatar
                        size={168}
                        radius={0}
                        username={r.host?.username}
                        avatarUrl={r.host?.avatar_url}
                        seed={r.host?.id}
                      />
                    )}
                    <span
                      style={{
                        position: "absolute", top: 8, left: 8,
                        background: "rgba(139,92,246,0.85)", color: "white",
                        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
                        padding: "2px 7px", borderRadius: 6,
                      }}
                    >
                      {r.scheduled_start
                        ? new Date(r.scheduled_start).toLocaleDateString([], { month: "short", day: "numeric" }).toUpperCase()
                        : "TBD"}
                    </span>
                    {/* Reminder bell — gold once set */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleReminder(r); }}
                      disabled={busyId === r.id}
                      title={reminders[r.id]?.amSet ? "Reminder set" : "Notify me"}
                      className="cursor-pointer"
                      style={{
                        position: "absolute", top: 6, right: 6,
                        width: 26, height: 26, borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, lineHeight: 1, padding: 0,
                        background: reminders[r.id]?.amSet ? "rgba(226,185,107,0.92)" : "rgba(0,0,0,0.55)",
                        border: reminders[r.id]?.amSet ? "0.5px solid #d9a238" : "0.5px solid rgba(255,255,255,0.25)",
                      }}
                    >
                      🔔
                    </button>
                  </div>
                  {/* Info overlaid on the photo — keeps the block a true square */}
                  <div
                    className="px-2.5 pb-2 pt-6"
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: "linear-gradient(transparent, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.88))",
                    }}
                  >
                    <p
                      className="m-0 text-[12px]"
                      style={{
                        color: "white",
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontWeight: 700,
                        lineHeight: 1.25,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                      }}
                    >
                      {r.motion}
                    </p>
                    {r.host?.username && (
                      <p className="m-0 mt-0.5 text-[10.5px] flex items-center gap-1" style={{ color: "rgba(255,255,255,0.8)" }}>
                        <span>by</span> {nameSpan(r.host)}
                      </p>
                    )}
                    <p className="m-0 mt-0.5 text-[9.5px]" style={{ color: "rgba(255,255,255,0.55)" }}>
                      {r.scheduled_start
                        ? new Date(r.scheduled_start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                        : "Time TBD"}
                      {" · "}{FORMAT_LABEL[r.format] ?? r.format}
                      {" · 🔔 "}{reminders[r.id]?.count ?? 0}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-0.5">
              <span className="text-[11px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "#c9a6f0", letterSpacing: "0.04em" }}>
                SCHEDULED
              </span>
              <span className="flex-1" style={{ height: 0.5, background: "#26262e" }} />
            </div>
            {/* Empty half earns its keep: a standing invitation to fill it. */}
            <div
              className="flex flex-col items-start justify-center gap-2 p-5"
              style={{ ...rowCard, minHeight: 168, borderStyle: "dashed", borderColor: "#3a3145" }}
            >
              <p className="m-0 text-[13px]" style={{ color: "#c9c9d2", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
                Nothing on the calendar in {selCat.label} yet.
              </p>
              <p className="m-0 text-[11.5px]" style={{ color: "#8b8b94", lineHeight: 1.5 }}>
                Schedule a debate and it headlines here — everyone who taps 🔔 gets
                reminded when doors open, 30 minutes before start.
              </p>
              <button
                onClick={() => onCreateLobby(selCat.key, true)}
                className="cursor-pointer text-[12px] px-4 py-2 rounded-lg mt-1"
                style={{ background: "rgba(35,24,52,0.85)", border: "0.5px solid #43315e", color: "#c9a6f0", fontFamily: "inherit" }}
              >
                Schedule a debate
              </button>
            </div>
          </>
        )}
        </div>
        </div>

        {/* Selected field: queue questions */}
        <div className="flex items-center gap-3 mt-2.5 mb-0.5">
          <span className="text-[11px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "#f4d47c", letterSpacing: "0.04em" }}>
            QUEUE
          </span>
          <span className="flex-1" style={{ height: 0.5, background: "#26262e" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 10 }}>
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
                <p className="m-0 text-[14px]" style={{ color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}>
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
        </div>
        {selRows.length === 0 && (
          <p className="m-0 text-[11.5px] px-1" style={{ color: "#6b6b74" }}>
            No standing questions in {selCat.label} yet.
          </p>
        )}

      </div>
    </div>,
    container
  );
}
