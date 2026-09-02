"use client";

/* Topics on the homepage — rendered into the MVP markup (portal into
   #fieldsSection, just below the hero).

   Order, top to bottom — and nothing renders empty:
   1. LIVE NOW / OPEN ROOMS — every live discussion and open lobby across
      all fields, most watched first. Hidden when there are none.
   2. TODAY'S QUESTIONS — the standing questions with matchmaking queues
      (get_debate_topics / queue_for_topic / check_topic_match /
      leave_topic_queue, backed by 20260817_topic_queues.sql), filtered
      by the field pills. Always has content, so it anchors the page.
   3. UPCOMING — scheduled discussions across all fields, most reminders
      first. Hidden when there are none.

   It also publishes the day's top question to the vanilla hero
   (window.__agoraApplyData → heroTopics) for when nothing is live, and
   serves that card's queue button (agora:queue-topic). */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase-browser";
import { Icon } from "@/components/icons";
import { TOPICS } from "@/types/database";
import TopicIcon from "./topicIcons";
import { useUserMenu } from "./userMenuContext";
import { roomPath } from "@/lib/urls";
import { displayName } from "@/lib/names";
import { setPresenceQueued } from "@/lib/presence";
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
  community: { id: string; name: string; color: string | null } | null;
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
const QUESTIONS_SHOWN = 5;

/* Rooms carry scheduling as a scheduled_start on a 'created' (or
   'scheduled') row — mirror page.tsx's classification. */
const isScheduled = (r: { status: string; scheduled_start: string | null }) =>
  r.status !== "live" && !!r.scheduled_start;

/* The rotation flips when Postgres's current_date does — midnight UTC. */
function msToUtcMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}
function fmtRotate(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

const labelOf = (key: string) => TOPICS.find((c) => c.key === key)?.label ?? key;

/* One quiet header style for every section — the colour-per-section
   headers were three accents competing on one screen. */
const HEAD_TEXT: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 700,
  fontSize: 11.5,
  color: "#9a9aa4",
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
const HAIRLINE: React.CSSProperties = { flex: 1, height: 0.5, background: "#26262e" };

const roomCardBox: React.CSSProperties = {
  background: "rgba(11,11,13,0.95)",
  border: "0.5px solid #2e2e38",
  width: 168,
  height: 168,
  borderRadius: 16,
  overflow: "hidden",
  position: "relative",
};

export default function TopicsHome({ container }: Props) {
  const [supabase] = useState(() => createClient());
  const { openUserMenu } = useUserMenu();

  /* Countdown to the next daily rotation — 30s tick keeps the minute
     display honest without a per-second render loop. */
  const [rotateLeft, setRotateLeft] = useState(() => msToUtcMidnight());
  useEffect(() => {
    const t = setInterval(() => setRotateLeft(msToUtcMidnight()), 30000);
    return () => clearInterval(t);
  }, []);

  /* "Explore all rooms" shows only when the room strip actually overflows —
     measured, not guessed, so it tracks viewport resizes too. */
  const roomsRowRef = useRef<HTMLDivElement | null>(null);
  const [roomsOverflow, setRoomsOverflow] = useState(false);
  /* Re-measure whenever the strip's contents could have changed (data
     load) and on resize. Lives up here, above the `!container` early
     return, to keep the hook order stable. */
  useEffect(() => {
    const el = roomsRowRef.current;
    if (!el) { setRoomsOverflow(false); return; }
    const check = () => setRoomsOverflow(el.scrollWidth > el.clientWidth + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  });

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
  /* Community-hosted rooms present the community as the host; clicking
     routes to that community's home page in the Communities view. */
  const communitySpan = (c: { id: string; name: string; color: string | null }) => (
    <span
      onClick={(e) => {
        e.stopPropagation();
        (document.querySelector('[data-nav-id="communities"]') as HTMLElement | null)?.click();
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent("agora:open-community", { detail: { communityId: c.id } }));
        }, 60);
      }}
      className="inline-flex items-center gap-1"
      style={{ cursor: "pointer", verticalAlign: "middle", lineHeight: 1 }}
      title={`Go to ${c.name}`}
    >
      <span
        className="inline-flex items-center justify-center shrink-0"
        style={{
          width: 13, height: 13, borderRadius: 4, background: c.color ?? "#4a9eff",
          color: "#fff", fontSize: 8, fontWeight: 700,
        }}
      >
        {c.name.charAt(0).toUpperCase()}
      </span>
      {c.name}
    </span>
  );

  const [userId, setUserId] = useState<string | null>(null);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [reminders, setReminders] = useState<Record<string, { count: number; amSet: boolean }>>({});
  const [selectedKey, setSelectedKey] = useState<string>(TOPICS[0].key);
  /* A field can carry a dozen questions; five is a screenful. */
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const anyQueued = topics.some((t) => t.am_queued);

  /* Friends lists show "In queue" while we wait — clear it on unmount. */
  useEffect(() => { setPresenceQueued(anyQueued); }, [anyQueued]);
  useEffect(() => () => setPresenceQueued(false), []);

  const load = useCallback(async () => {
    const [{ data: auth }, topicsRes, roomsRes] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc("get_debate_topics"),
      supabase
        .from("debate_rooms")
        .select("id, motion, topic_key, status, format, scheduled_start, created_at, viewer_count, thumbnail_url, host:users!host_id(id, username, display_name, avatar_url), community:communities!community_id(id, name, color), participants:debate_participants(role, stance, left_at, user:users(id, username, display_name, avatar_url))")
        .in("status", ["live", "created", "scheduled"])
        /* Queue-matched duels (1/1 seats) are spontaneous pairings, not
           browsable shows — keep them off the room strips. */
        .or("pro_size.neq.1,con_size.neq.1")
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
     board feels alive.

     Match-vs-refresh race: getting matched WRITES matched_room_id on
     our queue row, so a board refresh that lands between the match and
     our next poll reports am_queued=false — anyQueued flips, this
     effect tears down, and without the catch-up below the winner is
     stranded on the board ("removed from the queue") while their room
     sits waiting. Any transition out of the queued state we didn't
     initiate does one last check_topic_match to collect the room. */
  const wasQueuedRef = useRef(false);
  useEffect(() => {
    if (!anyQueued || !userId) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (wasQueuedRef.current && userId) {
        wasQueuedRef.current = false;
        supabase.rpc("check_topic_match").then(({ data }) => {
          if (data) window.location.href = `/agora/${data}`;
        });
      }
      return;
    }
    wasQueuedRef.current = true;
    pollRef.current = setInterval(async () => {
      const { data: roomId } = await supabase.rpc("check_topic_match");
      if (roomId) {
        if (pollRef.current) clearInterval(pollRef.current);
        wasQueuedRef.current = false;
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
    wasQueuedRef.current = false; // deliberate exit — no catch-up check
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

  /* Hero hand-off: with nothing live, the carousel shows today's question.
     One card — the question with the most people waiting; ties rotate by
     day so one field doesn't front the page forever. Published only when
     something the card shows changed: the queue poll refreshes `topics`
     every 2.5s, and re-rendering the hero that often would fight a tap. */
  const [heroNonce, setHeroNonce] = useState(0);
  const heroKeyRef = useRef("");
  useEffect(() => {
    if (topics.length === 0) return;
    const sorted = [...topics].sort((a, b) => b.queue_count - a.queue_count);
    const day = Math.floor(Date.now() / 86_400_000);
    const top = sorted[0].queue_count > 0 ? sorted[0] : sorted[day % sorted.length];
    const cat = TOPICS.find((c) => c.key === top.topic_key);
    const payload = {
      id: top.id,
      question: top.question,
      topicKey: top.topic_key,
      topicLabel: cat?.label ?? top.topic_key,
      color: cat?.color ?? "#4a9eff",
      queueCount: top.queue_count,
      amQueued: top.am_queued,
      rotateIn: fmtRotate(rotateLeft),
    };
    const key = JSON.stringify(payload) + heroNonce;
    const publish = (force: boolean) => {
      if (!force && heroKeyRef.current === key) return;
      heroKeyRef.current = key;
      const w = window as unknown as { __agoraApplyData?: (d: unknown) => void };
      w.__agoraApplyData?.({ heroTopics: [payload] });
    };
    publish(false);
    /* The adapter may load after our first publish — it asks for a repeat. */
    const onReady = () => publish(true);
    window.addEventListener("agora:adapter-ready", onReady);
    return () => window.removeEventListener("agora:adapter-ready", onReady);
  }, [topics, rotateLeft, heroNonce]);

  /* The hero card's queue button. */
  useEffect(() => {
    const onQueueTopic = async (e: Event) => {
      const id = ((e as CustomEvent).detail as { topicId?: string } | undefined)?.topicId;
      const t = topics.find((x) => x.id === id);
      if (!t) return;
      if (t.am_queued) await leaveQueue(t);
      else await queueUp(t, "PRO");
      /* Repaint even if nothing changed — an RPC error would otherwise
         leave the card's button stuck on "…". */
      setHeroNonce((n) => n + 1);
    };
    window.addEventListener("agora:queue-topic", onQueueTopic);
    return () => window.removeEventListener("agora:queue-topic", onQueueTopic);
  }, [topics, queueUp, leaveQueue]);

  if (!container) return null;

  /* Pills only for fields that have questions today; the rooms strips
     are field-agnostic (a strip that only ever said "nothing here" was
     worse than no strip). */
  const fields = TOPICS.filter((cat) => topics.some((t) => t.topic_key === cat.key));
  const selCat = fields.find((c) => c.key === selectedKey) ?? fields[0] ?? TOPICS[0];
  const selRows = topics
    .filter((t) => t.topic_key === selCat.key)
    .sort((a, b) => b.queue_count - a.queue_count);
  // Live first (most watched on top), then open lobbies (newest first).
  const openRooms = rooms
    .filter((r) => !isScheduled(r))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "live" ? -1 : 1;
      if (a.status === "live") return (b.viewer_count ?? 0) - (a.viewer_count ?? 0);
      return b.created_at.localeCompare(a.created_at);
    });
  const anyLive = openRooms.some((r) => r.status === "live");
  // Scheduled discussions, ordered by how many people signed up for a reminder.
  const upcoming = rooms
    .filter(isScheduled)
    .sort((a, b) => (reminders[b.id]?.count ?? 0) - (reminders[a.id]?.count ?? 0));

  if (topics.length === 0 && rooms.length === 0) return null;

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
    if (r.community) return <span className="inline-flex items-center gap-1"><span>by</span> {communitySpan(r.community)}</span>;
    return r.host?.username ? <span className="inline-flex items-center gap-1"><span>by</span> {nameSpan(r.host)}</span> : null;
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

  const sectionHead = (title: string, opts?: { live?: boolean; right?: React.ReactNode }) => (
    <div className="flex items-center gap-3 mb-2.5">
      {opts?.live && (
        <span className="animate-pulse shrink-0" style={{ width: 7, height: 7, borderRadius: 999, background: "#ff5c5c", boxShadow: "0 0 8px #ff5c5c" }} />
      )}
      <span style={HEAD_TEXT}>{title}</span>
      <span style={HAIRLINE} />
      {opts?.right}
    </div>
  );

  const badge = (text: string, bg: string) => (
    <span
      style={{
        position: "absolute", top: 8, left: 8,
        background: bg, color: "white",
        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
        padding: "2px 7px", borderRadius: 6,
      }}
    >
      {text}
    </span>
  );

  /* One card for both strips: a LIVE/OPEN badge and the field on open
     rooms, a date badge and the reminder bell on scheduled ones. */
  const roomCard = (r: RoomRow) => {
    const scheduled = isScheduled(r);
    const speakers = speakerLine(r);
    return (
      <div
        key={r.id}
        role="link"
        tabIndex={0}
        onClick={() => { window.location.href = roomPath(r); }}
        onKeyDown={(e) => { if (e.key === "Enter") window.location.href = roomPath(r); }}
        className="cursor-pointer shrink-0"
        style={roomCardBox}
      >
        {/* Host-picked thumbnail; their profile picture is the default */}
        <div style={{ position: "absolute", inset: 0 }}>
          {r.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.thumbnail_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <UserAvatar size={168} radius={0} username={r.host?.username} avatarUrl={r.host?.avatar_url} seed={r.host?.id} />
          )}
          {scheduled
            ? badge(
                r.scheduled_start
                  ? new Date(r.scheduled_start).toLocaleDateString([], { month: "short", day: "numeric" }).toUpperCase()
                  : "TBD",
                "rgba(139,92,246,0.85)",
              )
            : r.status === "live"
              ? badge("LIVE", "#ef4444")
              : badge("OPEN", "rgba(59,130,246,0.85)")}
          {scheduled ? (
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
                background: reminders[r.id]?.amSet ? "rgba(255,183,0,0.92)" : "rgba(0,0,0,0.55)",
                border: reminders[r.id]?.amSet ? "0.5px solid #ffb700" : "0.5px solid rgba(255,255,255,0.25)",
                color: reminders[r.id]?.amSet ? "#1a0e00" : "#fff",
              }}
            >
              <Icon name="bell" size={13} />
            </button>
          ) : (
            <span
              style={{
                position: "absolute", top: 9, right: 10,
                color: "rgba(255,255,255,0.65)",
                fontSize: 10, fontWeight: 500,
                textShadow: "0 1px 4px rgba(0,0,0,0.9)",
              }}
            >
              {labelOf(r.topic_key)}
            </span>
          )}
        </div>
        {/* Info overlaid on the photo — keeps the block a true square */}
        <div
          className="px-2.5 pb-2 pt-6"
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
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
          {speakers && (
            <p className="m-0 mt-0.5 text-[10.5px] flex items-center gap-1 flex-wrap" style={{ color: "rgba(255,255,255,0.8)" }}>
              {speakers}
            </p>
          )}
          <p className="m-0 mt-0.5 text-[9.5px]" style={{ color: "rgba(255,255,255,0.55)" }}>
            {scheduled ? (
              <>
                {r.scheduled_start
                  ? new Date(r.scheduled_start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                  : "Time TBD"}
                {" · "}{FORMAT_LABEL[r.format] ?? r.format}
                {" · "}<Icon name="bell" size={10} /> {reminders[r.id]?.count ?? 0}
              </>
            ) : (
              <>
                {FORMAT_LABEL[r.format] ?? r.format}
                {r.status === "live" ? ` · ${r.viewer_count ?? 0} watching` : " · waiting for speakers"}
              </>
            )}
          </p>
        </div>
      </div>
    );
  };

  return createPortal(
    <div className="flex flex-col" style={{ fontFamily: "'DM Sans', sans-serif", gap: 26, margin: "0 0 6px" }}>

      {/* 1. Live now / open rooms — across every field; hidden when empty. */}
      {openRooms.length > 0 && (
        <section>
          {sectionHead(anyLive ? "Live now" : "Open rooms", {
            live: anyLive,
            right: roomsOverflow ? (
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("agora:tab", { detail: "explore" }))}
                className="cursor-pointer text-[11.5px]"
                style={{ background: "transparent", border: "none", color: "#c0c0c8", fontFamily: "inherit", padding: "4px 2px" }}
              >
                All rooms →
              </button>
            ) : undefined,
          })}
          <div ref={roomsRowRef} className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {openRooms.map(roomCard)}
          </div>
        </section>
      )}

      {/* 2. Today's questions — the field pills pick the set. */}
      {fields.length > 0 && (
        <section>
          {sectionHead("Today's questions", {
            right: (
              <span className="text-[11px] whitespace-nowrap inline-flex items-center gap-1.5" style={{ color: "#6b6b74" }}>
                <Icon name="refresh-cw" size={11} /> new in {fmtRotate(rotateLeft)}
              </span>
            ),
          })}

          <div
            className="flex gap-2 pb-1 hide-scrollbar"
            style={{ overflowX: "auto" }}
            role="tablist"
            aria-label="Fields of study"
          >
            {fields.map((cat) => {
              const active = cat.key === selCat.key;
              const catTopics = topics.filter((t) => t.topic_key === cat.key);
              const waiting = catTopics.reduce((n, t) => n + t.queue_count, 0);
              const queuedHere = catTopics.some((t) => t.am_queued);
              const live = rooms.filter((r) => r.topic_key === cat.key && r.status === "live").length;
              /* A status line only when something is happening — a row of
                 "quiet quiet quiet" just advertises emptiness. */
              const status = live > 0
                ? { label: `${live} LIVE`, color: "#ff5c5c", pulse: true }
                : waiting > 0
                  ? { label: `${waiting} WAITING`, color: "#f4d47c", pulse: false }
                  : null;
              return (
                <button
                  key={cat.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setSelectedKey(cat.key); setShowAllQuestions(false); }}
                  className="cursor-pointer shrink-0 px-3.5 py-2 text-left"
                  style={{
                    background: active ? "#ffb700" : "rgba(255,255,255,0.05)",
                    color: active ? "#1a0e00" : "#e8e8ee",
                    border: "none",
                    borderRadius: 999,
                    fontFamily: "inherit",
                    transition: "background 0.15s ease, color 0.15s ease",
                  }}
                >
                  <span className="flex items-center gap-2">
                    <TopicIcon topicKey={cat.key} size={16} />
                    <span className="flex flex-col items-start">
                      <span className="flex items-center gap-1.5 text-[12.5px]" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {cat.label}
                        {queuedHere && <span className="animate-pulse text-[9px]" style={{ color: active ? "#1a0e00" : "#f4d47c" }}>●</span>}
                      </span>
                      {status && (
                        <span
                          className="flex items-center gap-1 mt-0.5"
                          style={{
                            color: active ? "rgba(26,14,0,0.75)" : status.color,
                            whiteSpace: "nowrap",
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: "0.07em",
                          }}
                        >
                          <span
                            className={status.pulse ? "animate-pulse" : undefined}
                            style={{ width: 5, height: 5, borderRadius: 999, background: "currentColor", flexShrink: 0 }}
                          />
                          {status.label}
                        </span>
                      )}
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

          {/* Rows, not boxes: a hairline between questions is all the
              structure they need. */}
          <div className="mt-1">
            {(showAllQuestions ? selRows : selRows.slice(0, QUESTIONS_SHOWN)).map((t, i) => {
              const inQueue = t.am_queued;
              const instant = t.queue_count > 0;
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-4 flex-wrap"
                  style={{ padding: "13px 2px", borderTop: i > 0 ? "0.5px solid #26262e" : "none" }}
                >
                  <div className="flex-1 min-w-[220px]">
                    <p className="m-0 text-[14px]" style={{ color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, lineHeight: 1.3 }}>
                      {t.question}
                    </p>
                    {inQueue ? (
                      <p className="m-0 mt-1.5 text-[11px] inline-flex items-center gap-2 flex-wrap" style={{ color: "#8b8b94" }}>
                        <span className="inline-flex items-center gap-1.5" style={{ color: "#ffb700", fontWeight: 600 }}>
                          <span className="inline-block animate-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#ffb700" }} />
                          In queue
                        </span>
                        <span>You&rsquo;ll be matched the moment someone joins — keep this page open.</span>
                      </p>
                    ) : (
                      <p className="m-0 mt-1 text-[11px]" style={{ color: instant ? "#97c459" : "#6b6b74" }}>
                        {instant ? `${t.queue_count} waiting to talk` : "no one waiting yet"}
                      </p>
                    )}
                  </div>
                  {inQueue ? (
                    <button
                      onClick={() => leaveQueue(t)}
                      disabled={busyId === t.id}
                      className="cursor-pointer text-[12px] px-4 py-2 rounded-full shrink-0"
                      style={{ background: "transparent", border: "0.5px solid #3a3a42", color: "#c0c0c8", fontFamily: "inherit" }}
                    >
                      Leave queue
                    </button>
                  ) : (
                    /* One Queue — matching is stanceless (the server pairs
                       you with whoever is waiting; seats are assigned
                       invisibly). Glows when a match is waiting. */
                    <button
                      onClick={() => queueUp(t, "PRO")}
                      disabled={busyId === t.id}
                      className={`queue-join-btn shrink-0${instant ? " queue-join-btn--instant" : ""}`}
                      title={instant ? "Someone is waiting — you'll be matched right away" : "Queue for this question"}
                    >
                      {busyId === t.id ? "…" : instant ? "Queue — match now" : "Queue"}
                    </button>
                  )}
                </div>
              );
            })}
            {selRows.length > QUESTIONS_SHOWN && (
              <button
                onClick={() => setShowAllQuestions((v) => !v)}
                className="cursor-pointer text-[12px] mt-2"
                style={{ background: "transparent", border: "none", color: "#c0c0c8", fontFamily: "inherit", padding: "6px 2px" }}
              >
                {showAllQuestions ? "Show fewer" : `Show all ${selRows.length} questions`}
              </button>
            )}
          </div>
        </section>
      )}

      {/* 3. Upcoming — scheduled across every field; hidden when empty. */}
      {upcoming.length > 0 && (
        <section>
          {sectionHead("Upcoming")}
          <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {upcoming.map(roomCard)}
          </div>
        </section>
      )}
    </div>,
    container
  );
}
