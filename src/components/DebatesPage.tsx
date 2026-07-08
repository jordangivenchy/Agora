"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS } from "@/types/database";

interface Props {
  open: boolean;
  onClose: () => void;
}

/* ── Types ─────────────────────────────────────────────────────────────── */

interface HistoryRow {
  room_id: string;
  motion: string;
  topic_key: string;
  status: string;
  role: string;
  stance: string | null;
  joined_at: string;
  ended_at: string | null;
  started_at: string | null;
  pro_votes: number;
  con_votes: number;
  winning_stance: string | null;
  outcome: "won" | "lost" | "tied" | null;
}

interface LiveOrScheduledRow {
  room_id: string;
  motion: string;
  topic_key: string;
  status: string;
  stance: string | null;
  started_at: string | null;
  scheduled_start: string | null;
  is_scheduled: boolean;
  is_private: boolean;
  host_id: string | null;
}

type FilterKey = "all" | "won" | "lost" | "spectated" | "ongoing";

/* ── Helpers ───────────────────────────────────────────────────────────── */

function topicLabel(key: string) {
  return TOPICS.find((t) => t.key === key)?.label ?? key;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatScheduled(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today · ${time}`;
  const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${dateStr} · ${time}`;
}

/* ═══════════════════════════════════════════════════════════════════════ */

export default function DebatesPage({ open, onClose }: Props) {
  const supabase = createClient();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [scheduled, setScheduled] = useState<LiveOrScheduledRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: u } = await supabase.auth.getUser();
    const signedIn = !!u.user;
    setIsSignedIn(signedIn);
    setMeId(u.user?.id ?? null);

    if (!signedIn || !u.user) {
      setRows([]);
      setScheduled([]);
      setLoading(false);
      return;
    }

    const [histRes, schedRes] = await Promise.all([
      supabase.rpc("get_user_history", { p_user: null }),
      supabase.rpc("get_user_live_and_scheduled", { p_user: u.user.id }),
    ]);

    if (histRes.error) {
      setError(histRes.error.message || "Could not load debates");
      setRows([]);
    } else {
      setRows((histRes.data as HistoryRow[]) || []);
    }

    if (!schedRes.error && schedRes.data) {
      setScheduled((schedRes.data as LiveOrScheduledRow[]) || []);
    } else {
      setScheduled([]);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const cancelRoom = useCallback(async (roomId: string) => {
    const ok = typeof window !== "undefined"
      ? window.confirm("Cancel this scheduled debate? This can't be undone.")
      : false;
    if (!ok) return;
    setCancelBusyId(roomId);
    const { error: rpcErr } = await supabase.rpc("cancel_room", { p_room: roomId });
    if (rpcErr) {
      setError(rpcErr.message || "Could not cancel debate");
      setCancelBusyId(null);
      return;
    }
    // Optimistic: drop the cancelled row locally
    setScheduled((prev) => prev.filter((r) => r.room_id !== roomId));
    setCancelBusyId(null);
    // Refetch for authoritative state (updates "max 3 scheduled" count upstream)
    load();
  }, [supabase, load]);

  // ESC
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Past debates = everything except not-yet-started scheduled ones (those are
  // shown in the Upcoming section).
  const pastRows = useMemo(() => {
    return rows.filter((r) => {
      const scheduledOnly = r.status === "created" && !r.started_at;
      return !scheduledOnly;
    });
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pastRows.filter((r) => {
      if (filter === "won" && r.outcome !== "won") return false;
      if (filter === "lost" && r.outcome !== "lost") return false;
      if (filter === "spectated" && r.role !== "spectator") return false;
      if (filter === "ongoing" && (r.status === "ended" || r.status === "cancelled")) return false;
      if (q && !r.motion.toLowerCase().includes(q) && !topicLabel(r.topic_key).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [pastRows, filter, query]);

  const stats = useMemo(() => {
    const total = pastRows.length;
    const wins = pastRows.filter((r) => r.outcome === "won").length;
    const losses = pastRows.filter((r) => r.outcome === "lost").length;
    const ties = pastRows.filter((r) => r.outcome === "tied").length;
    const winrate = wins + losses === 0 ? 0 : Math.round((wins / (wins + losses)) * 100);
    return { total, wins, losses, ties, winrate };
  }, [pastRows]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[960] overflow-y-auto"
      style={{
        background: "radial-gradient(ellipse at top, rgba(25,118,210,0.08) 0%, rgba(8,8,14,0.97) 60%)",
        backdropFilter: "blur(6px)",
        animation: "modalIn 0.25s ease",
      }}
    >
      {/* Back button */}
      <button
        onClick={onClose}
        className="fixed top-5 left-5 cursor-pointer flex items-center gap-2 transition-all z-20"
        style={{
          padding: "8px 14px",
          borderRadius: 12,
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.82)",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        ← Back
      </button>

      <div
        className="mx-auto"
        style={{
          maxWidth: 1100,
          padding: "80px 28px 80px",
          animation: "modalPanelIn 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
      >
        {/* Header */}
        <div className="text-center mb-10">
          <h1
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 28,
              fontWeight: 700,
              color: "var(--text-primary)",
              marginBottom: 6,
            }}
          >
            ⚔️ Debates
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Your upcoming debates and every past round you&apos;ve taken part in.
          </p>
        </div>

        {/* ── Scheduled / upcoming ──────────────────────────────────── */}
        {isSignedIn && scheduled.length > 0 && (
          <section className="mb-10">
            <SectionHeading title="Upcoming" count={scheduled.length} />
            <div className="flex flex-col gap-2">
              {scheduled.map((r) => (
                <ScheduledRowCard
                  key={r.room_id}
                  row={r}
                  canCancel={!!meId && r.host_id === meId && r.is_scheduled}
                  busy={cancelBusyId === r.room_id}
                  onCancel={() => cancelRoom(r.room_id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Past debates header & stats ───────────────────────────── */}
        <SectionHeading title="Past debates" count={pastRows.length} />

        <div
          className="grid mb-6"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          <StatCard label="Total" value={String(stats.total)} />
          <StatCard label="Wins" value={String(stats.wins)} color="#22c55e" />
          <StatCard label="Losses" value={String(stats.losses)} color="#e84040" />
          <StatCard label="Win rate" value={`${stats.winrate}%`} color="#e2b96b" />
        </div>

        {/* Search + filter */}
        <div
          className="mb-4 flex flex-wrap gap-3 items-center"
          style={{
            padding: 14,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 16,
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search motions, topics…"
            className="outline-none"
            style={{
              flex: 1,
              minWidth: 220,
              height: 36,
              padding: "0 14px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              color: "var(--text-primary)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
            }}
          />
          <div className="flex gap-1.5 flex-wrap">
            {([
              ["all", "All"],
              ["won", "Won"],
              ["lost", "Lost"],
              ["spectated", "Spectated"],
              ["ongoing", "Ongoing"],
            ] as [FilterKey, string][]).map(([key, label]) => {
              const active = filter === key;
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className="cursor-pointer transition-all"
                  style={{
                    padding: "7px 12px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    background: active
                      ? "linear-gradient(135deg, rgba(226,185,107,0.15) 0%, rgba(108,92,231,0.1) 100%)"
                      : "rgba(255,255,255,0.04)",
                    border: active
                      ? "1px solid rgba(226,185,107,0.45)"
                      : "1px solid rgba(255,255,255,0.08)",
                    color: active ? "#e2b96b" : "rgba(255,255,255,0.6)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        {isSignedIn === false && (
          <EmptyState
            title={<><a href="/login" style={{ color: "var(--accent-blue)", fontWeight: 700 }}>Sign in</a> to view your debates</>}
            sub="We only track debates for signed-in users."
          />
        )}

        {isSignedIn && loading && <EmptyState title="Loading debates…" sub="" />}

        {isSignedIn && !loading && error && (
          <EmptyState title="Could not load debates" sub={error} />
        )}

        {isSignedIn && !loading && !error && pastRows.length === 0 && scheduled.length === 0 && (
          <EmptyState
            title="No debates yet"
            sub="Join a debate or host one and it'll show up here with your stance and result."
          />
        )}

        {isSignedIn && !loading && !error && pastRows.length > 0 && filtered.length === 0 && (
          <EmptyState title="No past debates match those filters" sub="Try clearing the search or switching tabs." />
        )}

        {isSignedIn && !loading && !error && filtered.length > 0 && (
          <div className="flex flex-col gap-2">
            {filtered.map((r) => (
              <HistoryRowCard key={r.room_id} row={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div
        style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: 16,
          fontWeight: 700,
          color: "var(--text-primary)",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: "var(--text-dim)",
          padding: "2px 8px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {count}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        padding: 16,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 16,
      }}
    >
      <div
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: 24,
          fontWeight: 700,
          color: color ?? "var(--text-primary)",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState({ title, sub }: { title: ReactNode; sub: string }) {
  return (
    <div
      className="text-center"
      style={{
        padding: "60px 20px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 20,
      }}
    >
      <div
        style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: 15,
          fontWeight: 600,
          color: "var(--text-primary)",
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {sub && (
        <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{sub}</div>
      )}
    </div>
  );
}

function ScheduledRowCard({
  row,
  canCancel,
  busy,
  onCancel,
}: {
  row: LiveOrScheduledRow;
  canCancel: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  const isLive = row.status === "live" && !row.is_scheduled;
  const stance = row.stance;
  const stanceColor =
    stance === "PRO" ? "#22c55e" :
    stance === "CON" ? "#e84040" :
    "rgba(180,170,255,0.9)";

  const timeLabel = row.is_scheduled && row.scheduled_start
    ? formatScheduled(row.scheduled_start)
    : isLive
    ? "LIVE NOW"
    : "";

  const accentColor = isLive ? "#e84040" : "#e2b96b";

  return (
    <div
      className="flex items-center gap-3 w-full text-left"
      style={{
        padding: "12px 14px",
        background: isLive
          ? "rgba(232,64,64,0.05)"
          : "rgba(226,185,107,0.05)",
        border: isLive
          ? "1px solid rgba(232,64,64,0.22)"
          : "1px solid rgba(226,185,107,0.22)",
        borderRadius: 14,
      }}
    >
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 40,
          height: 40,
          borderRadius: 11,
          background: isLive ? "rgba(232,64,64,0.1)" : "rgba(226,185,107,0.1)",
          border: `1px solid ${accentColor}44`,
          fontSize: 18,
        }}
      >
        {isLive ? "🔴" : "📅"}
      </div>

      <div className="flex-1 min-w-0">
        <div
          className="truncate"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            fontWeight: 500,
            color: "rgba(255,255,255,0.92)",
          }}
        >
          {row.motion}
        </div>
        <div
          className="flex items-center gap-2 truncate"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11.5,
            color: "rgba(255,255,255,0.44)",
            marginTop: 3,
          }}
        >
          <span>{topicLabel(row.topic_key)}</span>
          <span>·</span>
          <span style={{ color: accentColor, fontWeight: 600 }}>{timeLabel}</span>
        </div>
      </div>

      {stance && (
        <span
          className="shrink-0"
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.08em",
            padding: "4px 10px",
            borderRadius: 999,
            border: `1px solid ${stanceColor}`,
            color: stanceColor,
          }}
        >
          {stance}
        </span>
      )}

      {canCancel && (
        <button
          onClick={onCancel}
          disabled={busy}
          className="shrink-0 cursor-pointer transition-all"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            padding: "6px 12px",
            borderRadius: 999,
            background: busy ? "rgba(232,64,64,0.04)" : "rgba(232,64,64,0.1)",
            border: "1px solid rgba(232,64,64,0.4)",
            color: "#e84040",
            opacity: busy ? 0.6 : 1,
          }}
          aria-label="Cancel scheduled debate"
        >
          {busy ? "Cancelling…" : "Cancel"}
        </button>
      )}
    </div>
  );
}

function HistoryRowCard({ row }: { row: HistoryRow }) {
  const isDebater = row.role === "debater";
  const outcome = row.outcome;

  const outcomeColor =
    outcome === "won"  ? "#22c55e" :
    outcome === "lost" ? "#e84040" :
    outcome === "tied" ? "#e2b96b" :
                         "rgba(255,255,255,0.4)";

  const outcomeLabel =
    outcome === "won"  ? "Won" :
    outcome === "lost" ? "Lost" :
    outcome === "tied" ? "Tied" :
    row.status === "ended"     ? "Ended" :
    row.status === "live"      ? "Live"  :
    row.status === "cancelled" ? "Cancelled" :
                                 "Ongoing";

  const icon = outcome === "won" ? "🏆" : outcome === "lost" ? "❌" : outcome === "tied" ? "🤝" : isDebater ? "⚔️" : "👁️";

  const stance = row.stance;
  const stanceColor =
    stance === "PRO" ? "#22c55e" :
    stance === "CON" ? "#e84040" :
    "rgba(180,170,255,0.9)";

  const dateLabel = formatDate(row.ended_at ?? row.started_at ?? row.joined_at);

  return (
    <div
      className="flex items-center gap-3 w-full text-left"
      style={{
        padding: "12px 14px",
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 14,
      }}
    >
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 40,
          height: 40,
          borderRadius: 11,
          background:
            outcome === "won" ? "rgba(34,197,94,0.08)" :
            outcome === "lost" ? "rgba(232,64,64,0.08)" :
            "rgba(255,255,255,0.04)",
          border:
            outcome === "won" ? "1px solid rgba(34,197,94,0.22)" :
            outcome === "lost" ? "1px solid rgba(232,64,64,0.22)" :
            "1px solid rgba(255,255,255,0.08)",
          fontSize: 18,
        }}
      >
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <div
          className="truncate"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            fontWeight: 500,
            color: "rgba(255,255,255,0.92)",
          }}
        >
          {row.motion}
        </div>
        <div
          className="flex items-center gap-2 truncate"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 11.5,
            color: "rgba(255,255,255,0.44)",
            marginTop: 3,
          }}
        >
          <span>{topicLabel(row.topic_key)}</span>
          <span>·</span>
          <span>{dateLabel}</span>
          <span>·</span>
          <span>
            {isDebater ? (stance ? `${stance} stance` : "Debater") : "Spectator"}
          </span>
          {(row.pro_votes > 0 || row.con_votes > 0) && (
            <>
              <span>·</span>
              <span>PRO {row.pro_votes} / CON {row.con_votes}</span>
            </>
          )}
        </div>
      </div>

      {isDebater && stance && (
        <span
          className="shrink-0"
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.08em",
            padding: "4px 10px",
            borderRadius: 999,
            border: `1px solid ${stanceColor}`,
            color: stanceColor,
          }}
        >
          {stance}
        </span>
      )}

      <span
        className="shrink-0"
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          padding: "4px 10px",
          borderRadius: 999,
          background:
            outcome === "won"  ? "rgba(34,197,94,0.1)" :
            outcome === "lost" ? "rgba(232,64,64,0.1)" :
            outcome === "tied" ? "rgba(226,185,107,0.1)" :
            "rgba(255,255,255,0.05)",
          border: `1px solid ${outcomeColor}44`,
          color: outcomeColor,
          whiteSpace: "nowrap",
        }}
      >
        {outcomeLabel}
      </span>
    </div>
  );
}
