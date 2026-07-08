"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import Navbar from "@/components/Navbar";
import Sidebar, { type SidebarView } from "@/components/Sidebar";
import CreateRoomModal from "@/components/CreateRoomModal";
import JoinPrivateRoomModal from "@/components/JoinPrivateRoomModal";
import UserProfileModal from "@/components/UserProfileModal";
import DashboardModal from "@/components/DashboardModal";
import DebatesPage from "@/components/DebatesPage";
import RoomCard from "@/components/RoomCard";
import { TOPICS, LANGUAGES } from "@/types/database";
import type { DebateRoom, DebateParticipant } from "@/types/database";

type RoomWithDetails = DebateRoom & {
  participants: (DebateParticipant & { user: { username: string; avatar_url: string | null } })[];
  vote_counts: { pro: number; con: number };
};

const PAGE_SIZE = 20;

// Explore filter types
// Open + Queue are independent toggles; Scheduled is exclusive (selecting it
// turns the other two off). At least one must always be on.
type ExploreStatus = { open: boolean; queue: boolean; scheduled: boolean };
const EXPLORE_STATUS_DEFAULT: ExploreStatus = { open: true, queue: true, scheduled: false };
type ExploreFormat = "any" | "open" | "timed";
type ExploreLanguage = "any" | string; // LANGUAGES value

export default function Home() {
  const supabase = createClient();
  const [rooms, setRooms] = useState<RoomWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinPrivateModal, setShowJoinPrivateModal] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showDebates, setShowDebates] = useState(false);

  // Sidebar view
  const [view, setView] = useState<SidebarView>("home");

  // Home filters (minimal)
  const [homeTopic, setHomeTopic] = useState<string | null>(null);
  const [homeOpenToJoin, setHomeOpenToJoin] = useState(false);

  // Explore filters
  const [explTopic, setExplTopic] = useState<string | null>(null);
  const [explStatus, setExplStatus] = useState<ExploreStatus>(EXPLORE_STATUS_DEFAULT);
  const [explFormat, setExplFormat] = useState<ExploreFormat>("any");
  const [explLanguage, setExplLanguage] = useState<ExploreLanguage>("any");
  const [explOpenToJoin, setExplOpenToJoin] = useState(true);
  const [explSearch, setExplSearch] = useState("");

  const [page, setPage] = useState(0);

  /* ─── Data ─── */

  const fetchRooms = useCallback(async () => {
    try {
      const { data: roomsData } = await supabase
        .from("debate_rooms")
        .select(`
          *,
          participants:debate_participants(
            *,
            user:users(username, avatar_url)
          )
        `)
        .in("status", ["live", "created"])
        .order("created_at", { ascending: false });

      if (roomsData) {
        const roomsWithVotes = await Promise.all(
          roomsData.map(async (room) => {
            const { data: votes } = await supabase
              .from("debate_votes")
              .select("stance")
              .eq("room_id", room.id);

            const pro = votes?.filter((v) => v.stance === "PRO").length || 0;
            const con = votes?.filter((v) => v.stance === "CON").length || 0;

            return { ...room, vote_counts: { pro, con } } as RoomWithDetails;
          })
        );
        setRooms(roomsWithVotes);
      }
    } catch (e) {
      // Never leave `loading=true` on failure — that hangs the UI on refresh.
      console.error("fetchRooms failed", e);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchRooms();
    const channel = supabase
      .channel("rooms-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_rooms" }, fetchRooms)
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_participants" }, fetchRooms)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchRooms, supabase]);

  // Reset page whenever anything that changes the effective list changes
  useEffect(() => { setPage(0); }, [
    view, homeTopic, homeOpenToJoin,
    explTopic, explStatus, explFormat, explLanguage, explOpenToJoin, explSearch,
  ]);

  /* ─── Shared helpers ─── */

  const activeDebaters = useCallback((r: RoomWithDetails) =>
    r.participants.filter((p) => p.role === "debater" && !p.left_at).length, []);

  const roomCapacity = useCallback((r: RoomWithDetails) =>
    (r.pro_size ?? 1) + (r.con_size ?? 1), []);

  // Real connected-viewer count, written by the host's client from LiveKit's
  // authoritative participant list. Never padded with enrolled-but-possibly-
  // stale participant rows — better to show a true 0 than a fabricated 3.
  const viewers = useCallback((r: RoomWithDetails) => r.viewer_count ?? 0, []);

  // Public listings exclude rooms that are private AND don't allow spectators
  const publiclyListable = useCallback((r: RoomWithDetails) => {
    if (!r.is_private) return true;
    return r.allow_spectators === true;
  }, []);

  const isFutureScheduled = useCallback((r: RoomWithDetails) => {
    return (
      r.status === "created" &&
      !!r.scheduled_start &&
      new Date(r.scheduled_start).getTime() > Date.now()
    );
  }, []);

  /* ─── Home list ─── */

  // "Live" rooms = publicly listable and not future-scheduled. Used for the
  // topic pill counts so scheduled-only debates don't inflate "N live" numbers.
  const liveRooms = useMemo(
    () => rooms.filter((r) => publiclyListable(r) && !isFutureScheduled(r)),
    [rooms, publiclyListable, isFutureScheduled],
  );

  const homeList = useMemo(() => {
    let list = rooms.filter(publiclyListable);
    // Home never shows future-scheduled rooms
    list = list.filter((r) => !isFutureScheduled(r));
    if (homeTopic) list = list.filter((r) => r.topic_key === homeTopic);
    if (homeOpenToJoin) list = list.filter((r) => activeDebaters(r) < roomCapacity(r));
    // Sort by viewer count desc
    list = [...list].sort((a, b) => viewers(b) - viewers(a));
    return list;
  }, [rooms, homeTopic, homeOpenToJoin, publiclyListable, isFutureScheduled, activeDebaters, roomCapacity, viewers]);

  /* ─── Explore list ─── */

  const exploreList = useMemo(() => {
    let list = rooms.filter(publiclyListable);

    // Scheduled is exclusive; when it's on, Open/Queue are forced off. Scheduled
    // debates are hidden otherwise, unless the user is actively searching.
    const hasSearch = explSearch.trim().length > 0;
    if (explStatus.scheduled) {
      list = list.filter(isFutureScheduled);
    } else {
      // Union of the enabled status toggles (Open ∪ Queue).
      list = list.filter((r) => {
        if (isFutureScheduled(r)) return hasSearch; // scheduled only visible when searching
        const isOpen = r.status === "live";
        const isQueue = r.status === "created" && !isFutureScheduled(r);
        if (explStatus.open && isOpen) return true;
        if (explStatus.queue && isQueue) return true;
        return false;
      });
    }

    if (explTopic) list = list.filter((r) => r.topic_key === explTopic);

    if (explFormat === "open") list = list.filter((r) => !r.time_limit_seconds);
    else if (explFormat === "timed") list = list.filter((r) => !!r.time_limit_seconds);

    if (explLanguage !== "any") list = list.filter((r) => r.language === explLanguage);

    if (explOpenToJoin) list = list.filter((r) => activeDebaters(r) < roomCapacity(r));

    if (hasSearch) {
      const q = explSearch.trim().toLowerCase();
      list = list.filter((r) => r.motion.toLowerCase().includes(q));
    }

    // Explore default sort: most-viewed first
    list = [...list].sort((a, b) => viewers(b) - viewers(a));
    return list;
  }, [
    rooms, publiclyListable, isFutureScheduled, explTopic, explStatus, explFormat, explLanguage,
    explOpenToJoin, explSearch, activeDebaters, roomCapacity, viewers,
  ]);

  const activeList = view === "home" ? homeList : view === "explore" ? exploreList : [];
  const visibleCount = (page + 1) * PAGE_SIZE;
  const visible = activeList.slice(0, visibleCount);
  const hasMore = activeList.length > visibleCount;

  // Stats banner values for Explore header
  const stats = useMemo(() => {
    const live = rooms.filter((r) => r.status === "live" && publiclyListable(r)).length;
    const debaters = rooms.reduce((acc, r) => acc + activeDebaters(r), 0);
    const watching = rooms.reduce((acc, r) => acc + viewers(r), 0);
    return { live, debaters, watching };
  }, [rooms, publiclyListable, activeDebaters, viewers]);

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <Navbar
        onCreateRoom={() => setShowCreateModal(true)}
        onJoinPrivate={() => setShowJoinPrivateModal(true)}
        onOpenProfile={(uid) => setProfileUserId(uid)}
      />
      <Sidebar
        activeView={view}
        onChangeView={setView}
        onOpenDashboard={() => setShowDashboard(true)}
        onOpenProfile={(uid) => setProfileUserId(uid)}
      />
      <CreateRoomModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <JoinPrivateRoomModal open={showJoinPrivateModal} onClose={() => setShowJoinPrivateModal(false)} />
      <UserProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
      <DashboardModal
        open={showDashboard}
        onClose={() => setShowDashboard(false)}
        onOpenDebates={() => { setShowDashboard(false); setShowDebates(true); }}
      />
      <DebatesPage open={showDebates} onClose={() => setShowDebates(false)} />

      <main
        style={{
          marginLeft: "calc(var(--sidebar-width) + 12px)",
          marginTop: "var(--nav-height)",
          padding: "12px 24px 60px",
          minHeight: "calc(100vh - var(--nav-height))",
        }}
      >
        {view === "home" && (
          <HomeView
            topic={homeTopic}
            onChangeTopic={setHomeTopic}
            openToJoin={homeOpenToJoin}
            onChangeOpenToJoin={setHomeOpenToJoin}
            liveRooms={liveRooms}
            visible={visible}
            visibleCount={visibleCount}
            totalCount={activeList.length}
            hasMore={hasMore}
            onLoadMore={() => setPage((p) => p + 1)}
            loading={loading}
          />
        )}

        {view === "explore" && (
          <ExploreView
            stats={stats}
            search={explSearch}
            onChangeSearch={setExplSearch}
            topic={explTopic}
            onChangeTopic={setExplTopic}
            status={explStatus}
            onChangeStatus={setExplStatus}
            format={explFormat}
            onChangeFormat={setExplFormat}
            language={explLanguage}
            onChangeLanguage={setExplLanguage}
            openToJoin={explOpenToJoin}
            onChangeOpenToJoin={setExplOpenToJoin}
            visible={visible}
            visibleCount={visibleCount}
            totalCount={activeList.length}
            hasMore={hasMore}
            onLoadMore={() => setPage((p) => p + 1)}
            loading={loading}
          />
        )}

        {view === "following" && (
          <EmptyState
            title="Following is coming soon"
            body="Once you can follow debaters, their live rooms will show up here."
          />
        )}
      </main>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   HOME VIEW — simple "most-viewed first" feed with topic + open-to-join
   ══════════════════════════════════════════════════════════════════ */

function HomeView({
  topic, onChangeTopic,
  openToJoin, onChangeOpenToJoin,
  liveRooms,
  visible, visibleCount, totalCount, hasMore, onLoadMore, loading,
}: {
  topic: string | null;
  onChangeTopic: (t: string | null) => void;
  openToJoin: boolean;
  onChangeOpenToJoin: (v: boolean) => void;
  liveRooms: RoomWithDetails[];
  visible: RoomWithDetails[];
  visibleCount: number;
  totalCount: number;
  hasMore: boolean;
  onLoadMore: () => void;
  loading: boolean;
}) {
  return (
    <>
      <BrowseHeading title="Home" subtitle="Trending debates right now — sorted by viewers." />

      <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-2 pt-2 mb-4">
        <CategoryPill label="All Topics" emoji="" active={!topic} onClick={() => onChangeTopic(null)} liveCount={liveRooms.length} />
        {TOPICS.map((t) => {
          const count = liveRooms.filter((r) => r.topic_key === t.key).length;
          return (
            <CategoryPill
              key={t.key}
              label={t.label}
              emoji={t.emoji}
              active={topic === t.key}
              onClick={() => onChangeTopic(t.key)}
              liveCount={count}
            />
          );
        })}
      </div>

      <div className="mb-6">
        <OpenToJoinToggle value={openToJoin} onChange={onChangeOpenToJoin} />
      </div>

      <ResultsArea
        visible={visible}
        visibleCount={visibleCount}
        totalCount={totalCount}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        loading={loading}
      />
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   EXPLORE VIEW — rich filter bar matching the screenshot
   ══════════════════════════════════════════════════════════════════ */

function ExploreView({
  stats,
  search, onChangeSearch,
  topic, onChangeTopic,
  status, onChangeStatus,
  format, onChangeFormat,
  language, onChangeLanguage,
  openToJoin, onChangeOpenToJoin,
  visible, visibleCount, totalCount, hasMore, onLoadMore, loading,
}: {
  stats: { live: number; debaters: number; watching: number };
  search: string;
  onChangeSearch: (v: string) => void;
  topic: string | null;
  onChangeTopic: (t: string | null) => void;
  status: ExploreStatus;
  onChangeStatus: (s: ExploreStatus) => void;
  format: ExploreFormat;
  onChangeFormat: (f: ExploreFormat) => void;
  language: ExploreLanguage;
  onChangeLanguage: (l: ExploreLanguage) => void;
  openToJoin: boolean;
  onChangeOpenToJoin: (v: boolean) => void;
  visible: RoomWithDetails[];
  visibleCount: number;
  totalCount: number;
  hasMore: boolean;
  onLoadMore: () => void;
  loading: boolean;
}) {
  return (
    <>
      {/* Banner: title + stats */}
      <div
        className="flex items-start justify-between gap-6 mb-5"
        style={{ paddingTop: "4px" }}
      >
        <div>
          <h1
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700,
              fontSize: "clamp(24px, 2.4vw, 30px)",
              letterSpacing: "-0.03em",
              color: "var(--text-primary)",
              lineHeight: 1.15,
              marginBottom: "4px",
            }}
          >
            Explore Debates
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: "13.5px" }}>
            Find live rooms, join a queue, or register for upcoming debates
          </p>
        </div>
        <div className="flex gap-7 shrink-0 mt-1">
          <Stat label="Active rooms" value={stats.live} />
          <Stat label="Debaters online" value={stats.debaters} />
          <Stat label="Watching now" value={stats.watching} />
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ position: "absolute", left: "16px", top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.35)" }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          value={search}
          onChange={(e) => onChangeSearch(e.target.value)}
          placeholder="Search motions, debaters, topics, keywords..."
          className="w-full outline-none transition-all"
          style={{
            padding: "12px 16px 12px 40px",
            borderRadius: "12px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-primary)",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "13px",
          }}
        />
      </div>

      {/* Filter card */}
      <div
        className="mb-6"
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "14px",
          padding: "16px 18px",
        }}
      >
        <FilterGroup label="Category">
          <ExplorePill active={!topic} onClick={() => onChangeTopic(null)}>All</ExplorePill>
          {TOPICS.map((t) => (
            <ExplorePill key={t.key} active={topic === t.key} onClick={() => onChangeTopic(t.key)}>
              {t.label}
            </ExplorePill>
          ))}
        </FilterGroup>

        <Divider />

        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
        >
          <FilterGroup label="Status">
            <ExplorePill
              active={status.open}
              onClick={() => {
                // Toggle Open; leaving Scheduled mode if we were in it.
                if (status.scheduled) {
                  onChangeStatus({ open: true, queue: false, scheduled: false });
                  return;
                }
                const nextOpen = !status.open;
                // Don't allow both Open and Queue to be off simultaneously.
                if (!nextOpen && !status.queue) {
                  onChangeStatus({ open: false, queue: true, scheduled: false });
                } else {
                  onChangeStatus({ open: nextOpen, queue: status.queue, scheduled: false });
                }
              }}
              tint="live"
            >
              ● Open
            </ExplorePill>
            <ExplorePill
              active={status.queue}
              onClick={() => {
                if (status.scheduled) {
                  onChangeStatus({ open: false, queue: true, scheduled: false });
                  return;
                }
                const nextQueue = !status.queue;
                if (!nextQueue && !status.open) {
                  onChangeStatus({ open: true, queue: false, scheduled: false });
                } else {
                  onChangeStatus({ open: status.open, queue: nextQueue, scheduled: false });
                }
              }}
            >
              ⏳ Queue
            </ExplorePill>
            <ExplorePill
              active={status.scheduled}
              onClick={() => onChangeStatus({ open: false, queue: false, scheduled: true })}
            >
              📅 Scheduled
            </ExplorePill>
          </FilterGroup>

          <FilterGroup label="Format">
            <ExplorePill active={format === "any"} onClick={() => onChangeFormat("any")}>All</ExplorePill>
            <ExplorePill active={format === "open"} onClick={() => onChangeFormat("open")}>Open</ExplorePill>
            <ExplorePill active={format === "timed"} onClick={() => onChangeFormat("timed")}>Timed</ExplorePill>
          </FilterGroup>

          <FilterGroup label="Language">
            <ExplorePill active={language === "any"} onClick={() => onChangeLanguage("any")}>Any</ExplorePill>
            {LANGUAGES.slice(0, 5).map((l) => (
              <ExplorePill key={l.value} active={language === l.value} onClick={() => onChangeLanguage(l.value)}>
                {l.value.toUpperCase()}
              </ExplorePill>
            ))}
          </FilterGroup>
        </div>

        <Divider />

        <FilterGroup label="Options">
          <OpenToJoinToggle value={openToJoin} onChange={onChangeOpenToJoin} />
        </FilterGroup>
      </div>

      <ResultsArea
        visible={visible}
        visibleCount={visibleCount}
        totalCount={totalCount}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        loading={loading}
      />
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   SHARED PIECES
   ══════════════════════════════════════════════════════════════════ */

function ResultsArea({
  visible, visibleCount, totalCount, hasMore, onLoadMore, loading,
}: {
  visible: RoomWithDetails[];
  visibleCount: number;
  totalCount: number;
  hasMore: boolean;
  onLoadMore: () => void;
  loading: boolean;
}) {
  return (
    <>
      {!loading && totalCount > 0 && (
        <p
          style={{
            fontSize: "12px",
            color: "var(--text-dim)",
            marginBottom: "14px",
          }}
        >
          Showing {Math.min(visibleCount, totalCount)} of {totalCount} {totalCount === 1 ? "debate" : "debates"}
        </p>
      )}

      {visible.length > 0 && (
        <section className="mb-8">
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))" }}
          >
            {visible.map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </div>
        </section>
      )}

      {!loading && totalCount === 0 && (
        <EmptyState
          title="No debates match"
          body="Try adjusting filters, or be the first to start one."
        />
      )}

      {hasMore && (
        <div className="flex justify-center mt-2 mb-8">
          <button
            onClick={onLoadMore}
            className="cursor-pointer transition-all"
            style={{
              padding: "10px 24px",
              borderRadius: "100px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 600,
              fontSize: "13px",
            }}
          >
            Load more
            <span style={{ marginLeft: "8px", color: "var(--text-muted)", fontWeight: 500 }}>
              ({totalCount - visibleCount} left)
            </span>
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div
            className="w-8 h-8 rounded-full animate-spin"
            style={{ border: "2px solid var(--accent-purple)", borderTopColor: "transparent" }}
          />
        </div>
      )}
    </>
  );
}

function BrowseHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <h1
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 700,
          fontSize: "clamp(24px, 2.4vw, 30px)",
          letterSpacing: "-0.03em",
          color: "var(--text-primary)",
          marginBottom: "4px",
          lineHeight: 1.15,
        }}
      >
        {title}
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: "13.5px", marginBottom: "14px" }}>
        {subtitle}
      </p>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-right">
      <span
        className="block"
        style={{ fontSize: "20px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}
      >
        {formatNumber(value)}
      </span>
      <span
        style={{
          fontSize: "10px",
          color: "rgba(255,255,255,0.28)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function formatNumber(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 0 }}>
      <span
        className="block mb-2"
        style={{
          fontSize: "10.5px",
          fontWeight: 600,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.35)",
        }}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5 items-center">{children}</div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "14px 0" }} />;
}

function ExplorePill({
  active,
  onClick,
  tint,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tint?: "live";
  children: React.ReactNode;
}) {
  const activeBg =
    tint === "live" ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.14)";
  const activeBorder =
    tint === "live" ? "rgba(239,68,68,0.4)" : "rgba(59,130,246,0.5)";
  const activeColor = tint === "live" ? "#f87171" : "#93c5fd";
  return (
    <button
      onClick={onClick}
      className="cursor-pointer transition-all"
      style={{
        padding: "5px 12px",
        borderRadius: "100px",
        fontSize: "11.5px",
        fontWeight: 500,
        fontFamily: "'DM Sans', sans-serif",
        background: active ? activeBg : "rgba(255,255,255,0.03)",
        border: active ? `1px solid ${activeBorder}` : "1px solid rgba(255,255,255,0.08)",
        color: active ? activeColor : "rgba(255,255,255,0.55)",
      }}
    >
      {children}
    </button>
  );
}

function OpenToJoinToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="inline-flex items-center gap-3 cursor-pointer transition-all"
      style={{
        padding: "8px 14px 8px 10px",
        borderRadius: "999px",
        background: value
          ? "linear-gradient(135deg, rgba(88,214,141,0.12) 0%, rgba(88,214,141,0.03) 100%)"
          : "rgba(255,255,255,0.03)",
        border: value ? "1px solid rgba(88,214,141,0.45)" : "1px solid rgba(255,255,255,0.10)",
        boxShadow: value
          ? "0 0 16px rgba(88,214,141,0.15), inset 0 1px 0 rgba(255,255,255,0.05)"
          : "inset 0 1px 0 rgba(255,255,255,0.04)",
        color: "var(--text-primary)",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "12.5px",
        fontWeight: 600,
        letterSpacing: "-0.005em",
      }}
      aria-pressed={value}
    >
      <span
        style={{
          position: "relative",
          display: "inline-block",
          width: "30px",
          height: "16px",
          borderRadius: "999px",
          background: value
            ? "linear-gradient(135deg, rgba(88,214,141,0.55) 0%, rgba(88,214,141,0.35) 100%)"
            : "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.12)",
          transition: "all 0.2s ease",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "1px",
            left: value ? "15px" : "1px",
            width: "12px",
            height: "12px",
            borderRadius: "999px",
            background: "rgba(255,255,255,0.95)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
            transition: "left 0.2s ease",
          }}
        />
      </span>
      <span>Open to join</span>
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h3 className="text-xl mb-2" style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
        {title}
      </h3>
      <p className="text-sm max-w-md" style={{ color: "var(--text-muted)" }}>{body}</p>
    </div>
  );
}

function CategoryPill({
  label,
  emoji,
  active,
  onClick,
  liveCount,
}: {
  label: string;
  emoji: string;
  active: boolean;
  onClick: () => void;
  liveCount: number;
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 cursor-pointer transition-all"
      style={{ padding: 0, border: "none", borderRadius: "999px", background: "transparent" }}
    >
      <div
        className="flex flex-col items-start justify-center gap-1"
        style={{
          padding: "10px 18px",
          minWidth: "110px",
          borderRadius: "12px",
          background: active ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.04)",
          border: active ? "1px solid rgba(59,130,246,0.4)" : "1px solid var(--border)",
          transition: "all 0.2s ease",
        }}
      >
        <span
          className="whitespace-nowrap"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: active ? "var(--text-primary)" : "var(--text-muted)",
            lineHeight: 1,
          }}
        >
          {emoji} {label}
        </span>
        <span
          className="whitespace-nowrap"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "10px",
            color: "var(--text-dim)",
            lineHeight: 1,
          }}
        >
          {liveCount > 0 ? `${liveCount} live` : "no live"}
          {liveCount > 0 && (
            <span
              className="inline-block rounded-full ml-1"
              style={{
                width: "4px",
                height: "4px",
                background: "#e84040",
                animation: "pulse-live 1.5s ease-in-out infinite",
                verticalAlign: "middle",
              }}
            />
          )}
        </span>
      </div>
    </button>
  );
}
