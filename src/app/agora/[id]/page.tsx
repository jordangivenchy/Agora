"use client";

/* The Agora — amphitheater view of a live discussion. This is where
   "Watch" lands. Host-curated conversation, not an open mic: the audience
   listens, raises hands, and only reaches the stage through a host —
   Audience → Raised Hand → Invited → Speaker → Audience (hosts may skip
   the raised-hand step). Hosts come from the room's configuration; the
   Host Controls panel is invisible to everyone else. */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useEscapeClose from "@/lib/useEscapeClose";
import { createClient } from "@/lib/supabase-browser";
import { parseRoomParam } from "@/lib/urls";
import type { DebateRoom } from "@/types/database";
import { TOPICS } from "@/types/database";
import Amphitheater from "@/components/agora/Amphitheater";
import type { AgoraView } from "@/components/agora/AgoraScene3D";
import AgoraSidebar from "@/components/agora/AgoraSidebar";
import AgoraAssistant from "@/components/AgoraAssistant";
import AgoraVideoDock from "@/components/agora/AgoraVideoDock";
import ReactionOverlay from "@/components/agora/ReactionOverlay";
import { useAgoraCall } from "@/components/agora/useAgoraCall";
import HostControls from "@/components/agora/HostControls";
import InvitePrompt from "@/components/agora/InvitePrompt";
import { type StageParticipant, deriveStageRole, isHostRole, onStage, sortRequests } from "@/components/agora/stage";
import type { User } from "@supabase/supabase-js";
import "../agora.css";

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

interface PendingInvite {
  id: string;
  inviterName: string;
}

/* Route param may be a full uuid (legacy links) or a slug ending in an
   8-char id prefix (pretty links) — resolve to the uuid, then render. */
export default function AgoraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawParam } = use(params);
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const parsed = useMemo(() => parseRoomParam(rawParam), [rawParam]);
  const [resolvedId, setResolvedId] = useState<string | null>(parsed.uuid ?? null);
  useEffect(() => {
    if (parsed.uuid || !parsed.prefix) {
      if (!parsed.uuid && !parsed.prefix) router.replace("/");
      return;
    }
    supabase.rpc("resolve_room_prefix", { p_prefix: parsed.prefix }).then(({ data }) => {
      if (data) setResolvedId(data as string);
      else router.replace("/");
    });
  }, [parsed, router, supabase]);

  if (!resolvedId) {
    return (
      <div className="ag-root ag-loading">
        <div className="ag-spinner" />
      </div>
    );
  }
  return <AgoraRoom roomId={resolvedId} />;
}

function AgoraRoom({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [room, setRoom] = useState<
    | (DebateRoom & {
        speaker_requests_locked?: boolean;
        queue_auto_advance?: boolean;
        mic_user_id?: string | null;
      })
    | null
  >(null);
  const [participants, setParticipants] = useState<StageParticipant[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [following, setFollowing] = useState(false);
  /* Host leave flow: leaving as host asks whether to close the stage. */
  const [leavePrompt, setLeavePrompt] = useState(false);
  const [closingStage, setClosingStage] = useState(false);
  const [elapsed, setElapsed] = useState("00:00:00");
  const [view, setView] = useState<AgoraView>("audience");
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [handBusy, setHandBusy] = useState(false);

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
      if (partData) setParticipants(partData as StageParticipant[]);
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

  /* ── Invite listener: the consent moment arrives live ─────────────
     A pending invite for me (existing on load, or inserted while I'm
     here) raises the "«host» has invited you" prompt. Fails silent
     when the stage migration isn't applied yet. */
  const userId = currentUser?.id;
  useEffect(() => {
    if (!userId) return;

    const surface = async (inviteId: string, inviterId: string) => {
      let name = "The host";
      try {
        const { data } = await supabase
          .from("users")
          .select("username")
          .eq("id", inviterId)
          .maybeSingle();
        if (data?.username) name = data.username;
      } catch {
        /* name is cosmetic */
      }
      setInvite({ id: inviteId, inviterName: name });
    };

    (async () => {
      try {
        const { data } = await supabase
          .from("stage_invites")
          .select("id, inviter_id")
          .eq("room_id", roomId)
          .eq("invitee_id", userId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1);
        if (data?.[0]) surface(data[0].id, data[0].inviter_id);
      } catch {
        /* table not migrated yet */
      }
    })();

    const channel = supabase
      .channel(`agora-invites-${roomId}-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "stage_invites",
          filter: `invitee_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; room_id: string; inviter_id: string; status: string };
          if (row.room_id === roomId && row.status === "pending") surface(row.id, row.inviter_id);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, roomId, supabase]);

  /* Elapsed ticker */
  useEffect(() => {
    if (!room) return;
    const from = room.started_at ?? room.created_at;
    setElapsed(fmtElapsed(from));
    const t = setInterval(() => setElapsed(fmtElapsed(from)), 1000);
    return () => clearInterval(t);
  }, [room]);

  const myParticipation = useMemo(
    () => (currentUser ? participants.find((p) => p.user_id === currentUser.id) ?? null : null),
    [participants, currentUser]
  );
  useEscapeClose(leavePrompt, () => setLeavePrompt(false));

  const myRole = useMemo(() => {
    if (!room) return "audience" as const;
    if (myParticipation) return deriveStageRole(myParticipation, room);
    // Not seated yet: the room creator still holds host power.
    if (currentUser && currentUser.id === room.host_id) return "host" as const;
    return "audience" as const;
  }, [myParticipation, currentUser, room]);

  /* ── Live call (LiveKit) ───────────────────────────────────────────
     Everyone connects: on-stage roles with publish rights, listeners and
     guests subscribe-only. The buttons below drive this, and the active-
     speaker set feeds the stage rings with real voice activity. */
  const myUsername =
    myParticipation?.user?.username ??
    currentUser?.email?.split("@")[0] ??
    "Guest";
  const call = useAgoraCall({
    roomId,
    userId: currentUser?.id ?? null,
    username: myUsername,
    canPublish: onStage(myRole),
    ready: loaded && !!room,
    highQuality: view === "speaker",
  });
  const [reactOpen, setReactOpen] = useState(false);

  /* ── Stage composition ─────────────────────────────────────────────
     Debaters keep their PRO/CON panels. Everyone else on stage (hosts,
     co-hosts, promoted speakers) forms the discussion strip. The
     audience visualization excludes people who are on stage — their
     seat empties when they come up. */
  const { proSpeakers, conSpeakers, stageStrip, audience } = useMemo(() => {
    if (!room) return { proSpeakers: [], conSpeakers: [], stageStrip: [], audience: [] };
    const withRoles = participants.map((p) => ({ p, stageRole: deriveStageRole(p, room) }));
    const debaters = withRoles.filter(({ p }) => p.role === "debater");
    const toStage = ({ p, stageRole }: (typeof withRoles)[number]) => ({
      id: p.user_id,
      username: p.user?.username ?? "?",
      avatarUrl: p.user?.avatar_url ?? null,
      /* Real voice activity once the call is up; DB heartbeat otherwise. */
      speaking: call.connected ? call.speakingIds.has(p.user_id) : !p.mic_muted,
      stageRole,
    });
    return {
      proSpeakers: debaters.filter(({ p }) => p.stance === "PRO").map(toStage),
      conSpeakers: debaters.filter(({ p }) => p.stance === "CON").map(toStage),
      stageStrip: withRoles
        .filter(({ p, stageRole }) => p.role !== "debater" && stageRole !== "audience")
        .sort((a, b) => rank(a.stageRole) - rank(b.stageRole))
        .map(toStage),
      audience: withRoles
        .filter(
          ({ p, stageRole }) =>
            p.role === "spectator" &&
            stageRole === "audience" &&
            /* Queue members and the mic holder leave their seats — they
               stand in the center aisle / at the medallion instead. */
            !p.hand_raised_at &&
            p.user_id !== room.mic_user_id
        )
        .map(({ p }) => ({
          id: p.user_id,
          username: p.user?.username ?? "?",
          avatarUrl: p.user?.avatar_url ?? null,
        })),
    };
  }, [participants, room, call.connected, call.speakingIds]);

  function rank(role: string) {
    return role === "host" ? 0 : role === "cohost" ? 1 : 2;
  }

  /* ── Speaker queue (derived — the DB timestamps ARE the queue) ─────
     Order: hand_raised_at asc, user_id tiebreak — identical to the
     advance_speaker_queue RPC, so every client sees the same line. */
  const micHolder = useMemo(() => {
    const uid = room?.mic_user_id;
    if (!uid) return null;
    const p = participants.find((x) => x.user_id === uid && !x.left_at);
    return p
      ? { id: p.user_id, username: p.user?.username ?? "?", avatarUrl: p.user?.avatar_url ?? null }
      : null;
  }, [room?.mic_user_id, participants]);

  const speakerQueue = useMemo(() => {
    if (!room) return [];
    return sortRequests(
      participants.filter(
        (p) =>
          !p.left_at &&
          p.hand_raised_at &&
          p.user_id !== room.mic_user_id &&
          !isHostRole(deriveStageRole(p, room))
      )
    ).map((p) => ({
      id: p.user_id,
      username: p.user?.username ?? "?",
      avatarUrl: p.user?.avatar_url ?? null,
    }));
  }, [participants, room]);

  const amMicHolder = !!currentUser && room?.mic_user_id === currentUser.id;
  const myQueuePos = useMemo(() => {
    if (!currentUser) return null;
    const idx = speakerQueue.findIndex((p) => p.id === currentUser.id);
    return idx < 0 ? null : idx + 1;
  }, [speakerQueue, currentUser]);

  /* Auto-advance driver: in open-mic mode the host's client brings up the
     front of the line whenever the mic is free. Host-gated server-side too. */
  const advanceGuardRef = useRef(0);
  useEffect(() => {
    if (!room || !currentUser || !isHostRole(myRole)) return;
    if (!room.queue_auto_advance || room.mic_user_id || room.status !== "live") return;
    if (speakerQueue.length === 0) return;
    const now = Date.now();
    if (now - advanceGuardRef.current < 2000) return;
    advanceGuardRef.current = now;
    supabase
      .rpc("advance_speaker_queue", { p_room: roomId })
      .then(({ error }) => {
        if (error) console.warn("auto-advance failed", error.message);
        fetchAll();
      });
  }, [room, currentUser, myRole, speakerQueue.length, roomId, supabase, fetchAll]);

  async function stepDownFromMic() {
    try {
      await supabase.rpc("step_down_from_mic", { p_room: roomId });
      fetchAll();
    } catch (e) {
      console.warn("step down failed", e);
    }
  }

  /* ── Stage screen routing ──────────────────────────────────────────
     Live cameras land on the holo screens over the stage: PRO's camera
     on the frame-left screen, CON's on the right. Non-debater cameras
     (host, co-host, promoted speakers) fill whichever screen is free. */
  const screenFeeds = useMemo(() => {
    const tiles = call.videoTiles;
    if (tiles.length === 0) return undefined;
    const keyOf = (t: (typeof tiles)[number]) => `${t.identity}:${t.local ? "l" : "r"}`;
    const proIds = new Set(proSpeakers.map((s) => s.id));
    const conIds = new Set(conSpeakers.map((s) => s.id));
    const pro = tiles.find((t) => proIds.has(t.identity)) ?? null;
    const con = tiles.find((t) => t !== pro && conIds.has(t.identity)) ?? null;
    const rest = tiles.filter((t) => t !== pro && t !== con);
    const proFeed = pro ?? rest.shift() ?? null;
    const conFeed = con ?? rest.shift() ?? null;
    return {
      pro: proFeed ? { key: keyOf(proFeed), track: proFeed.track } : null,
      con: conFeed ? { key: keyOf(conFeed), track: conFeed.track } : null,
    };
  }, [call.videoTiles, proSpeakers, conSpeakers]);

  /* Self-preview only while the camera is warming up: once your own feed
     lands on a stage screen the whole amphitheater is watching it, and the
     little dock tile is a redundant duplicate. Others' tiles stay. */
  const dockTiles = useMemo(() => {
    const onScreen = new Set(
      [screenFeeds?.pro?.key, screenFeeds?.con?.key].filter(Boolean)
    );
    return call.videoTiles.filter(
      (t) => !(t.local && onScreen.has(`${t.identity}:l`))
    );
  }, [call.videoTiles, screenFeeds]);

  /* Walking in seats you: signed-in visitors get a spectator row right
     away, so you're visible in the crowd the moment you arrive — raising
     a hand is for speaking, not for existing. Returning visitors get
     their old row restored (left_at cleared) with role untouched, so a
     re-entering host or speaker lands back where they belong. */
  const seatAttemptedRef = useRef(false);
  useEffect(() => {
    if (seatAttemptedRef.current) return;
    if (!loaded || !currentUser || !room || room.status === "ended") return;
    if (myParticipation) {
      seatAttemptedRef.current = true;
      return;
    }
    seatAttemptedRef.current = true;
    (async () => {
      try {
        const { data: existing } = await supabase
          .from("debate_participants")
          .select("id, left_at")
          .eq("room_id", roomId)
          .eq("user_id", currentUser.id)
          .maybeSingle();
        if (!existing) {
          await supabase
            .from("debate_participants")
            .insert({ room_id: roomId, user_id: currentUser.id, role: "spectator", stance: null });
        } else if (existing.left_at) {
          await supabase
            .from("debate_participants")
            .update({ left_at: null, joined_at: new Date().toISOString() })
            .eq("id", existing.id);
        }
        fetchAll();
      } catch {
        /* seating is cosmetic — the room still works unlisted */
      }
    })();
  }, [loaded, currentUser, room, myParticipation, roomId, supabase, fetchAll]);

  /* Leaving vacates the seat (best effort — a closed tab can't stamp out). */
  const vacateSeat = useCallback(() => {
    if (!currentUser || !myParticipation) return;
    supabase
      .from("debate_participants")
      .update({ left_at: new Date().toISOString(), hand_raised_at: null })
      .eq("id", myParticipation.id)
      .then(undefined, () => {});
  }, [currentUser, myParticipation, supabase]);

  /* Stage closed (by the host, here or elsewhere): give the banner a
     beat to read, then walk everyone out. Also catches visitors landing
     on an already-ended room link. */
  useEffect(() => {
    if (!loaded || room?.status !== "ended") return;
    const t = setTimeout(() => router.push("/"), 2600);
    return () => clearTimeout(t);
  }, [loaded, room?.status, router]);

  /* ── Raise / lower hand ────────────────────────────────────────────
     Signed-in listeners only. Landing in the Agora doesn't create a
     participant row, so the first raise seats you in the room (upsert,
     mirroring the classic room page's rejoin-safe flow). */
  const handRaised = !!myParticipation?.hand_raised_at;
  const requestsLocked = !!room?.speaker_requests_locked;
  const canRaise = !!currentUser && room?.status === "live" && !isHostRole(myRole) && myRole !== "speaker";

  async function toggleHand() {
    if (!currentUser || !room || handBusy) return;
    setHandBusy(true);
    try {
      /* Server-stamped raise (Postgres now() is the one true clock, so the
         queue order is identical on every client). Falls back to the
         legacy client-side write if the RPC isn't migrated yet. */
      const { error } = await supabase.rpc("raise_hand", {
        p_room: roomId,
        p_raised: !handRaised,
      });
      if (error) {
        if (!/function|schema/i.test(error.message)) throw new Error(error.message);
        const ts = handRaised ? null : new Date().toISOString();
        if (myParticipation) {
          await supabase
            .from("debate_participants")
            .update({ hand_raised_at: ts })
            .eq("id", myParticipation.id);
        } else {
          const { data: existing } = await supabase
            .from("debate_participants")
            .select("id")
            .eq("room_id", roomId)
            .eq("user_id", currentUser.id)
            .maybeSingle();
          if (existing) {
            await supabase
              .from("debate_participants")
              .update({ role: "spectator", stance: null, left_at: null, joined_at: new Date().toISOString(), hand_raised_at: ts })
              .eq("id", existing.id);
          } else {
            await supabase
              .from("debate_participants")
              .insert({ room_id: roomId, user_id: currentUser.id, role: "spectator", stance: null, hand_raised_at: ts });
          }
        }
      }
      fetchAll();
    } catch (e) {
      console.error("raise hand failed", e);
    } finally {
      setHandBusy(false);
    }
  }

  /* ── Invite responses ── */
  async function respondToInvite(accept: boolean) {
    if (!invite || !currentUser) return;
    setInviteBusy(true);
    try {
      await supabase
        .from("stage_invites")
        .update({ status: accept ? "accepted" : "declined", responded_at: new Date().toISOString() })
        .eq("id", invite.id);
      if (accept) {
        if (myParticipation) {
          await supabase
            .from("debate_participants")
            .update({ stage_role: "speaker", hand_raised_at: null })
            .eq("id", myParticipation.id);
        } else {
          await supabase
            .from("debate_participants")
            .insert({ room_id: roomId, user_id: currentUser.id, role: "spectator", stance: null, stage_role: "speaker" });
        }
        fetchAll();
      }
      setInvite(null);
    } catch (e) {
      console.error("invite response failed", e);
      setInvite(null);
    } finally {
      setInviteBusy(false);
    }
  }

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

  const raiseTitle = !currentUser
    ? "Sign in to raise your hand"
    : requestsLocked
      ? "Speaker requests are locked"
      : handRaised
        ? "Lower your hand"
        : "Raise your hand to request to speak";

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
          stageStrip={stageStrip}
          audience={audience}
          viewerCount={room.viewer_count ?? 0}
          view={view}
          onSwitchView={() => setView((v) => (v === "audience" ? "speaker" : "audience"))}
          screenFeeds={screenFeeds}
          speakerQueue={speakerQueue}
          micHolder={micHolder}
          micLive={!!(room.mic_user_id && call.speakingIds.has(room.mic_user_id))}
        />

        {/* ── Host controls (hosts and co-hosts only) ── */}
        {currentUser && isHostRole(myRole) && (
          <HostControls
            room={room}
            participants={participants}
            currentUser={currentUser}
            myRole={myRole}
            onChanged={fetchAll}
          />
        )}

        {/* ── Host leave prompt: close the stage or just step out ── */}
        {leavePrompt && room?.status !== "ended" && (
          <div className="ag-invite" role="dialog" aria-label="Leave options">
            <span className="ag-invite-text">
              You&apos;re the <strong>host</strong> — close the stage for everyone, or just step out?
            </span>
            <div className="ag-invite-actions">
              <button
                className="ag-invite-decline"
                disabled={closingStage}
                onClick={() => {
                  vacateSeat();
                  router.push("/");
                }}
              >
                Just leave
              </button>
              <button
                className="ag-invite-join"
                style={{ background: "#c0392b" }}
                disabled={closingStage}
                onClick={async () => {
                  setClosingStage(true);
                  await supabase
                    .from("debate_rooms")
                    .update({ status: "ended", ended_at: new Date().toISOString() })
                    .eq("id", roomId);
                  router.push("/");
                }}
              >
                {closingStage ? "Closing…" : "Close stage"}
              </button>
            </div>
          </div>
        )}

        {/* ── Stage closed: everyone gets walked out ── */}
        {room?.status === "ended" && (
          <div className="ag-invite" role="status">
            <span className="ag-invite-text">The host closed the stage — taking you back home.</span>
          </div>
        )}

        {/* ── Invite prompt ── */}
        {invite && (
          <InvitePrompt
            inviterName={invite.inviterName}
            busy={inviteBusy}
            onJoin={() => respondToInvite(true)}
            onDecline={() => respondToInvite(false)}
          />
        )}

        {/* ── Live camera tiles + floating reactions ── */}
        <AgoraVideoDock tiles={dockTiles} />
        <ReactionOverlay reactions={call.reactions} />

        {/* ── Queue position pill: the number reinforces what the 3D line
              already shows — your character physically nearing the mic ── */}
        {currentUser && (amMicHolder || myQueuePos !== null) && (
          <div
            className={`ag-queue-pill ${
              amMicHolder ? "is-mic" : myQueuePos === 1 ? "is-next" : ""
            }`}
          >
            {amMicHolder ? (
              <>🎤 You have the mic</>
            ) : myQueuePos === 1 ? (
              <>✨ YOU&apos;RE NEXT</>
            ) : (
              <>
                #{myQueuePos} in queue · {myQueuePos! - 1} ahead of you
              </>
            )}
          </div>
        )}

        {/* ── Autoplay-blocked prompt: without this, listeners sit in
              silence with no idea the browser muted the room ── */}
        {call.audioBlocked && (
          <button
            className="ag-invite cursor-pointer"
            style={{ border: "1px solid #f4d47c", bottom: 140 }}
            onClick={call.enableAudio}
          >
            <span className="ag-invite-text">
              🔊 Your browser muted the room — <strong>tap to listen</strong>
            </span>
          </button>
        )}

        {/* ── Mic/camera failure toast — a silent dead button is worse ── */}
        {call.mediaError && (
          <div className="ag-media-error" role="alert">
            <span>{call.mediaError}</span>
            <button onClick={call.clearMediaError} aria-label="Dismiss">×</button>
          </div>
        )}

        {/* ── Bottom control bar ── */}
        <footer className="ag-controls">
          {amMicHolder ? (
            <button className="ag-ctl ag-ctl--live" title="Give up the mic" onClick={stepDownFromMic}>
              🎤 <span>Step Down</span>
            </button>
          ) : (
            <button
              className={`ag-ctl ${handRaised ? "ag-ctl--active" : ""}`}
              title={raiseTitle}
              disabled={!canRaise || requestsLocked || handBusy}
              onClick={toggleHand}
            >
              ✋ <span>{handRaised ? "Lower Hand" : "Raise Hand"}</span>
            </button>
          )}
          <div className="ag-react-wrap">
            {reactOpen && (
              <div className="ag-react-picker">
                {["👏", "❤️", "😂", "🔥", "👍", "🤯"].map((e) => (
                  <button
                    key={e}
                    className="ag-react-emoji"
                    onClick={() => {
                      call.sendReaction(e);
                      setReactOpen(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
            <button
              className={`ag-ctl ${reactOpen ? "ag-ctl--active" : ""}`}
              title={call.connected ? "Send a reaction" : "Connecting…"}
              disabled={!call.connected}
              onClick={() => setReactOpen((v) => !v)}
            >
              😊 <span>React</span>
            </button>
          </div>
          <button
            className={`ag-ctl ${call.micOn ? "ag-ctl--live" : ""}`}
            title={
              !onStage(myRole)
                ? "Mic — speakers only"
                : !call.connected
                  ? "Connecting…"
                  : call.micOn
                    ? "Mute your mic"
                    : "Unmute your mic"
            }
            disabled={!onStage(myRole) || !call.connected || call.mediaBusy}
            onClick={call.toggleMic}
          >
            🎙️ <span>{call.micOn ? "Mute" : "Mic"}</span>
          </button>
          <button
            className={`ag-ctl ${call.camOn ? "ag-ctl--live" : ""}`}
            title={
              !onStage(myRole)
                ? "Camera — speakers only"
                : !call.connected
                  ? "Connecting…"
                  : call.camOn
                    ? "Turn camera off"
                    : "Turn camera on"
            }
            disabled={!onStage(myRole) || !call.connected || call.mediaBusy}
            onClick={call.toggleCam}
          >
            📹 <span>{call.mediaBusy ? "…" : "Camera"}</span>
          </button>
          <button
            className="ag-ctl ag-ctl--leave"
            onClick={() => {
              if (isHostRole(myRole)) {
                setLeavePrompt(true);
              } else {
                vacateSeat();
                router.push("/");
              }
            }}
          >
            📞 <span>Leave</span>
          </button>
        </footer>
      </div>

      <AgoraSidebar roomId={roomId} currentUser={currentUser} />

      {/* Agora AI assistant — the full pipeline (Gemini + retrieval + history)
          lives behind /api/agora; this is its surface in the amphitheater,
          which is where every room entry routes now. */}
      <AgoraAssistant motion={room.motion} roomId={roomId} topicKey={room.topic_key} />
    </div>
  );
}
