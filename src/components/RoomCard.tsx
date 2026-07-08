"use client";

import Link from "next/link";
import { TOPICS } from "@/types/database";
import type { DebateRoom, DebateParticipant } from "@/types/database";

interface Props {
  room: DebateRoom & {
    participants: (DebateParticipant & { user: { username: string; avatar_url: string | null } })[];
    vote_counts: { pro: number; con: number };
  };
}

export default function RoomCard({ room }: Props) {
  const topic = TOPICS.find((t) => t.key === room.topic_key);
  const debaters = room.participants.filter((p) => p.role === "debater" && !p.left_at);
  const proDebater = debaters.find((d) => d.stance === "PRO");
  const conDebater = debaters.find((d) => d.stance === "CON");
  const totalVotes = room.vote_counts.pro + room.vote_counts.con;
  const proPct = totalVotes > 0 ? Math.round((room.vote_counts.pro / totalVotes) * 100) : 50;

  const isLive = room.status === "live";
  const isScheduled =
    room.status === "created" &&
    !!room.scheduled_start &&
    new Date(room.scheduled_start).getTime() > Date.now();

  const scheduledLabel = (() => {
    if (!room.scheduled_start) return "";
    const d = new Date(room.scheduled_start);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (sameDay) return `Today · ${time}`;
    const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${dateStr} · ${time}`;
  })();

  return (
    <Link
      href={isLive ? `/rooms/${room.id}?spectate=1` : `/rooms/${room.id}`}
      className="room-card block cursor-pointer transition-all"
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "16px",
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border-hover)";
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 12px 40px rgba(0,0,0,0.45)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Thumbnail */}
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          height: "120px",
          background: topic
            ? `radial-gradient(ellipse at 50% 120%, ${topic.color}2e 0%, ${topic.color}0a 55%, transparent 100%), var(--bg-tertiary)`
            : "var(--bg-tertiary)",
        }}
      >
        <span className="text-[34px] opacity-40 z-[1]">{topic?.emoji || "⚖️"}</span>

        {/* Hover CTA — live rooms are spectator-only, make that the whole pitch */}
        {isLive && (
          <div className="rc-thumb-cta">
            <span className="rc-cta-btn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Join as Spectator
            </span>
          </div>
        )}

        {/* Live badge */}
        {isLive && (
          <div
            className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-[2]"
            style={{
              background: "#ef4444",
              color: "white",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "10px",
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: "6px",
              letterSpacing: "0.06em",
            }}
          >
            <span
              className="rounded-full bg-white animate-[pulse-live_1.5s_ease-in-out_infinite]"
              style={{ width: "5px", height: "5px" }}
            />
            LIVE
          </div>
        )}

        {!isLive && isScheduled && (
          <div
            className="absolute top-2.5 left-2.5 flex items-center gap-1 z-[2]"
            style={{
              background: "rgba(226,185,107,0.92)",
              color: "#1a0c00",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "10px",
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: "6px",
              letterSpacing: "0.06em",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            SCHEDULED
          </div>
        )}

        {!isLive && !isScheduled && (
          <div
            className="absolute top-2.5 left-2.5 flex items-center gap-1 z-[2]"
            style={{
              background: "rgba(59,130,246,0.85)",
              color: "white",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "10px",
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: "6px",
              letterSpacing: "0.06em",
            }}
          >
            WAITING
          </div>
        )}

        {/* Viewers */}
        <div
          className="absolute top-2.5 right-2.5 flex items-center gap-1 z-[2]"
          style={{
            background: "rgba(0,0,0,0.6)",
            color: "rgba(255,255,255,0.85)",
            fontSize: "10.5px",
            fontWeight: 600,
            padding: "3px 9px",
            borderRadius: "6px",
            backdropFilter: "blur(6px)",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {room.viewer_count}
        </div>

        {/* Private badge (spectator-only room) */}
        {room.is_private && (
          <div
            className="absolute z-[2] flex items-center gap-1"
            style={{
              bottom: "8px",
              left: "10px",
              background: "rgba(226,185,107,0.15)",
              border: "1px solid rgba(226,185,107,0.4)",
              color: "#ffdd85",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "9.5px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              padding: "3px 8px",
              borderRadius: "6px",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            PRIVATE
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "12px" }}>
        {/* Topic tag */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <span style={{ fontSize: "10px", color: topic?.color || "var(--text-dim)" }}>
            {topic?.emoji} {topic?.label}
          </span>
        </div>

        {/* Motion */}
        <h3
          className="line-clamp-2"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "13.5px",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--text-primary)",
            lineHeight: 1.4,
            marginBottom: "8px",
            minHeight: "38px",
          }}
        >
          {room.motion}
        </h3>

        {/* Debaters row */}
        <div className="flex items-center gap-1.5 mb-2">
          <MiniAvatar
            name={proDebater?.user?.username}
            color={topic?.color || "#00b894"}
          />
          <span
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "11px",
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: 1,
            }}
          >
            {proDebater?.user?.username || "Waiting"} vs {conDebater?.user?.username || "Waiting"}
          </span>
        </div>

        {/* Vote bar */}
        <div className="flex justify-between items-center mb-1" style={{ fontSize: "9px" }}>
          <span style={{ color: "rgba(0,184,148,0.7)" }}>PRO {proPct}%</span>
          <span style={{ color: "rgba(232,64,64,0.7)" }}>CON {100 - proPct}%</span>
        </div>
        <div
          className="flex overflow-hidden"
          style={{ height: "3px", borderRadius: "100px" }}
        >
          <div
            style={{
              background: "var(--pro-color)",
              width: `${proPct}%`,
              transition: "width 0.6s cubic-bezier(0.25,0.46,0.45,0.94)",
            }}
          />
          <div
            style={{
              background: "var(--con-color)",
              flex: 1,
              transition: "width 0.6s cubic-bezier(0.25,0.46,0.45,0.94)",
            }}
          />
        </div>

        {/* Footer meta */}
        <div
          className="flex items-center justify-between mt-2 pt-2"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.05)",
            fontSize: "10px",
            color: "var(--text-dim)",
          }}
        >
          {isScheduled ? (
            <span style={{ color: "#e2b96b", fontWeight: 600 }}>
              {scheduledLabel}
            </span>
          ) : (
            <span className="capitalize">{room.format}</span>
          )}
          <span>{room.language === "en" ? "English" : room.language}</span>
        </div>
      </div>
    </Link>
  );
}

function MiniAvatar({ name, color }: { name?: string; color: string }) {
  return (
    <div
      className="rounded-full flex items-center justify-center text-white shrink-0"
      style={{
        width: "20px",
        height: "20px",
        background: name ? color : "var(--bg-tertiary)",
        fontFamily: "'Syne', sans-serif",
        fontSize: "8px",
        fontWeight: 700,
      }}
    >
      {name ? name[0].toUpperCase() : "?"}
    </div>
  );
}
