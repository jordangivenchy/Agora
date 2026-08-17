"use client";

/* Post-debate results. Shown in place of the room UI once status flips
   to "ended" — previously every client was bounced straight to "/" and
   the collected votes were never seen by anyone.

   Self-contained: fetches the final tally and debater roster itself so
   the page only has to decide *when* to show it. Works for late
   visitors opening an already-ended room URL. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { useUserMenu } from "./userMenuContext";
import { displayName } from "@/lib/names";
import UserAvatar from "./UserAvatar";
import type { DebateRoom, Stance } from "@/types/database";

/* `username` stays the raw handle (context-menu plumbing); `name` is what renders. */
type Debater = { id: string | null; username: string; name: string; avatarUrl: string | null; stance: Stance | null };

export default function ResultsScreen({ room }: { room: DebateRoom }) {
  const { openUserMenu } = useUserMenu();
  const supabase = createClient();
  const router = useRouter();
  const [votes, setVotes] = useState<{ pro: number; con: number } | null>(null);
  const [debaters, setDebaters] = useState<Debater[]>([]);

  useEffect(() => {
    (async () => {
      const [voteRes, partRes] = await Promise.all([
        supabase.from("debate_votes").select("stance").eq("room_id", room.id),
        supabase
          .from("debate_participants")
          .select("stance, role, user:users(id, username, display_name, avatar_url)")
          .eq("room_id", room.id)
          .eq("role", "debater"),
      ]);
      const rows = voteRes.data ?? [];
      setVotes({
        pro: rows.filter((v) => v.stance === "PRO").length,
        con: rows.filter((v) => v.stance === "CON").length,
      });
      setDebaters(
        (partRes.data ?? []).map((p) => {
          const u = p.user as unknown as
            | { id: string; username: string; display_name?: string | null; avatar_url: string | null }
            | null;
          return {
            stance: p.stance as Stance | null,
            id: u?.id ?? null,
            avatarUrl: u?.avatar_url ?? null,
            username: u?.username ?? "unknown",
            name: displayName(u) || "unknown",
          };
        })
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  const total = (votes?.pro ?? 0) + (votes?.con ?? 0);
  const proPct = total ? Math.round(((votes?.pro ?? 0) / total) * 100) : 50;
  const conPct = total ? 100 - proPct : 50;
  const verdict =
    !votes || total === 0
      ? "No audience votes were cast"
      : votes.pro === votes.con
        ? "The audience was split evenly"
        : votes.pro > votes.con
          ? "The audience sided PRO"
          : "The audience sided CON";

  const duration = (() => {
    if (!room.started_at || !room.ended_at) return null;
    const mins = Math.max(
      1,
      Math.round((+new Date(room.ended_at) - +new Date(room.started_at)) / 60_000)
    );
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
  })();

  const names = (side: Stance) => {
    const list = debaters.filter((d) => d.stance === side);
    if (!list.length) return "—";
    return list.map((d, i) => (
      <span key={`${d.username}-${i}`}>
        {i > 0 && ", "}
        <span
          className="inline-flex items-center gap-1"
          style={d.id ? { cursor: "pointer", textDecoration: "underline dotted rgba(255,255,255,0.25)", textUnderlineOffset: 2 } : undefined}
          onClick={d.id ? (e) => openUserMenu({ x: e.clientX, y: e.clientY }, { userId: d.id!, username: d.username }) : undefined}
        >
          <UserAvatar size={16} username={d.name} avatarUrl={d.avatarUrl} seed={d.id ?? d.username} />
          {d.name}
        </span>
      </span>
    ));
  };

  const hairline = "1px solid rgba(255,255,255,0.07)";

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-primary, #0a0a0a)",
        padding: 24,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520, textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 11, letterSpacing: 2, color: "rgba(255,255,255,0.35)" }}>
          DISCUSSION ENDED{duration ? ` · ${duration}` : ""}
        </p>
        <h1
          style={{
            margin: "14px 0 6px",
            fontSize: 22,
            lineHeight: 1.35,
            color: "var(--text-primary, #f5f5f0)",
            fontWeight: 600,
          }}
        >
          &ldquo;{room.motion}&rdquo;
        </h1>
        <p style={{ margin: "0 0 28px", fontSize: 14, color: "#e2b96b" }}>{verdict}</p>

        {/* Tally bar */}
        <div
          style={{
            display: "flex",
            height: 34,
            borderRadius: 10,
            overflow: "hidden",
            border: hairline,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              width: `${proPct}%`,
              minWidth: total ? 42 : undefined,
              background: "rgba(74,158,255,0.28)",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              paddingLeft: 12,
              fontSize: 12,
              fontWeight: 600,
              color: "#9cc4f0",
              transition: "width 0.6s ease",
            }}
          >
            {proPct}%
          </div>
          <div
            style={{
              flex: 1,
              background: "rgba(226,92,92,0.22)",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              paddingRight: 12,
              fontSize: 12,
              fontWeight: 600,
              color: "#f0a8a8",
            }}
          >
            {conPct}%
          </div>
        </div>

        {/* Sides */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 28 }}>
          <div style={{ textAlign: "left" }}>
            <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
              PRO · {votes?.pro ?? 0} vote{(votes?.pro ?? 0) === 1 ? "" : "s"}
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--text-primary, #f5f5f0)" }}>
              {names("PRO")}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
              CON · {votes?.con ?? 0} vote{(votes?.con ?? 0) === 1 ? "" : "s"}
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--text-primary, #f5f5f0)" }}>
              {names("CON")}
            </p>
          </div>
        </div>

        <button
          onClick={() => router.push("/")}
          style={{
            padding: "11px 26px",
            borderRadius: 10,
            background: "transparent",
            border: "1px solid rgba(226,185,107,0.45)",
            color: "#e2b96b",
            cursor: "pointer",
            fontSize: 14,
            fontFamily: "inherit",
          }}
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
