"use client";

/* The Agora — amphitheater view of a live debate. This is where "Watch"
   lands: a spectator-first, top-down theater with the two sides seated in
   wedges, the debaters on stage, and chat/Q&A in the right rail. The classic
   room page (/rooms/[id]) is untouched and will become the "speaker view"
   this page's center button eventually toggles to. */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type { DebateRoom, DebateParticipant } from "@/types/database";
import { TOPICS } from "@/types/database";
import Amphitheater from "@/components/agora/Amphitheater";
import type { AgoraView } from "@/components/agora/AgoraScene3D";
import AgoraSidebar from "@/components/agora/AgoraSidebar";
import type { User } from "@supabase/supabase-js";
import "../agora.css";

type ParticipantWithUser = DebateParticipant & {
  user: { username: string; avatar_url: string | null };
};

function fmtElapsed(fromIso: string | null): string {
  if (!fromIso) return "00:00:00";
  const ms = Date.now() - new Date(fromIso).getTime();
  if (ms < 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function AgoraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: roomId } = use(params);
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [room, setRoom] = useState<DebateRoom | null>(null);
  const [participants, setParticipants] = useState<ParticipantWithUser[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [following, setFollowing] = useState(false);
  const [elapsed, setElapsed] = useState("00:00:00");
  const [view, setView] = useState<AgoraView>("audience");

  const fetchAll = useCallback(async () => {
    try {
      const [{ data: roomData }, { data: partData }] = await Promise.all([
        supabase.from("debate_rooms").select("*").eq("id", roomId).maybeSingle(),
        supabase
          .from("debate_participants")
          .select("*, user:users(username, avatar_url)")
          .eq("room_id", roomId)
          .is("left_at", null),
      ]);
      if (!roomData) {
        router.replace("/");
        return;
      }
      setRoom(roomData);
      if (partData) setParticipants(partData as ParticipantWithUser[]);
    } catch (e) {
      console.error("agora load failed", e);
    } finally {
      setLoaded(true);
    }
  }, [roomId, router, supabase]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        setCurrentUser(data.user);
      } catch {
        /* signed-out guests are fine */
      }
    })();
    fetchAll();

    const channel = supabase
      .channel(`agora-room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "debate_rooms", filter: `id=eq.${roomId}` },
        fetchAll
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "debate_participants", filter: `room_id=eq.${roomId}` },
        fetchAll
      )
      .subscribe();
    const heartbeat = setInterval(fetchAll, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(heartbeat);
    };
  }, [fetchAll, roomId, supabase]);

  /* Elapsed ticker */
  useEffect(() => {
    if (!room) return;
    const from = room.started_at ?? room.created_at;
    setElapsed(fmtElapsed(from));
    const t = setInterval(() => setElapsed(fmtElapsed(from)), 1000);
    return () => clearInterval(t);
  }, [room]);

  const { proSpeakers, conSpeakers, audience } = useMemo(() => {
    const debaters = participants.filter((p) => p.role === "debater");
    const specs = participants.filter((p) => p.role === "spectator");
    const toStage = (p: ParticipantWithUser) => ({
      id: p.user_id,
      username: p.user?.username ?? "?",
      avatarUrl: p.user?.avatar_url ?? null,
      speaking: !p.mic_muted,
    });
    return {
      proSpeakers: debaters.filter((p) => p.stance === "PRO").map(toStage),
      conSpeakers: debaters.filter((p) => p.stance === "CON").map(toStage),
      audience: specs.map((p) => ({
        id: p.user_id,
        username: p.user?.username ?? "?",
        avatarUrl: p.user?.avatar_url ?? null,
      })),
    };
  }, [participants]);

  const topic = TOPICS.find((t) => t.key === room?.topic_key);
  const audienceCount = Math.max(room?.viewer_count ?? 0, audience.length);

  if (!loaded || !room) {
    return (
      <div className="ag-root ag-loading">
        <div className="ag-spinner" />
        <span>Entering the Agora…</span>
      </div>
    );
  }

  return (
    <div className="ag-root">
      <div className="ag-main">
        {/* ── Top bar ── */}
        <header className="ag-topbar">
          <button className="ag-back" onClick={() => router.push("/")} title="Back to home">
            ←
          </button>
          <div className="ag-topbar-info">
            <div className="ag-live-tag">
              <span className={`ag-live-dot ${room.status === "live" ? "" : "idle"}`} />
              {room.status === "live" ? "LIVE DEBATE" : room.status === "created" ? "STARTING SOON" : "DEBATE"}
            </div>
            <h1 className="ag-motion">{room.motion}</h1>
            <div className="ag-topbar-meta">
              <span title="Elapsed">🕐 {elapsed} elapsed</span>
              <span title="Audience">👥 {audienceCount} in audience</span>
              {topic && (
                <span title="Topic">
                  {topic.emoji} {topic.label}
                </span>
              )}
            </div>
          </div>
          <div className="ag-topbar-actions">
            <button
              className={`ag-follow ${following ? "on" : ""}`}
              onClick={() => setFollowing((f) => !f)}
            >
              {following ? "Following ✓" : "Follow"}
            </button>
            <button className="ag-more" title="More options">
              ⋯
            </button>
          </div>
        </header>

        {/* ── Amphitheater ── */}
        <Amphitheater
          roomId={roomId}
          proSpeakers={proSpeakers}
          conSpeakers={conSpeakers}
          audience={audience}
          viewerCount={room.viewer_count ?? 0}
          view={view}
          onSwitchView={() => setView((v) => (v === "audience" ? "speaker" : "audience"))}
        />

        {/* ── Bottom control bar ── */}
        <footer className="ag-controls">
          <button className="ag-ctl" title="Raise hand — coming soon" disabled>
            ✋ <span>Raise Hand</span>
          </button>
          <button className="ag-ctl" title="React — coming soon" disabled>
            😊 <span>React</span>
          </button>
          <button className="ag-ctl" title="Mic — join as a debater to speak" disabled>
            🎙️ <span>Mic</span>
          </button>
          <button className="ag-ctl" title="Camera — join as a debater to stream" disabled>
            📹 <span>Camera</span>
          </button>
          <button className="ag-ctl ag-ctl--leave" onClick={() => router.push("/")}>
            📞 <span>Leave</span>
          </button>
        </footer>
      </div>

      <AgoraSidebar roomId={roomId} currentUser={currentUser} />
    </div>
  );
}
