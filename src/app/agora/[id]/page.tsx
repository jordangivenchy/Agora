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
import { displayName } from "@/lib/names";
import type { DebateRoom } from "@/types/database";
import { TOPICS } from "@/types/database";
import Amphitheater from "@/components/agora/Amphitheater";
import type { AgoraView } from "@/components/agora/AgoraScene3D";
import AgoraSidebar from "@/components/agora/AgoraSidebar";
import AgoraAssistant from "@/components/AgoraAssistant";
import AgoraVideoDock from "@/components/agora/AgoraVideoDock";
import AgoraStage from "@/components/agora/AgoraStage";
import ReactionOverlay from "@/components/agora/ReactionOverlay";
import { useAgoraCall } from "@/components/agora/useAgoraCall";
import HostControls from "@/components/agora/HostControls";
import HlsPlayer from "@/components/agora/HlsPlayer";
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
  /* ?avdebug=1 — live snapshot of the call plumbing for field debugging. */
  const [avDebug, setAvDebug] = useState<Record<string, unknown> | null>(null);
  const avDebugOn = useMemo(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("avdebug"),
    []
  );
  /* Egress compositor mode: LiveKit's headless browser loads this page with
     ?token&url appended — render the amphitheater alone (no chrome) and
     signal readiness so the restream starts filming. */
  const broadcastCreds = useMemo(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    const token = sp.get("token");
    const serverUrl = sp.get("url");
    return token && serverUrl ? { token, serverUrl } : null;
  }, []);
  const broadcast = !!broadcastCreds;
  const [closingStage, setClosingStage] = useState(false);
  const [elapsed, setElapsed] = useState("00:00:00");
  const [view, setView] = useState<AgoraView>("audience");
  /* The DOM stage holds back until the camera glide lands on the current
     vantage — fading panes in mid-flight read as riding the camera. */
  const [viewSettled, setViewSettled] = useState(false);
  /* Chat rail collapsed → the stage runs the full width of the page, for
     watching without the chat in frame. Lives here rather than in the
     rail because the collapsed class drives layout on .ag-root. */
  const [railCollapsed, setRailCollapsed] = useState(false);
  /* Audience overflow: watch the composited HLS stream instead of WebRTC. */
  const [hlsOpen, setHlsOpen] = useState(false);
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  useEffect(() => {
    setViewSettled(false);
  }, [view]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [handBusy, setHandBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreWrapRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [{ data: roomData }, { data: partData }] = await Promise.all([
        supabase.from("debate_rooms").select("*").eq("id", roomId).maybeSingle(),
        supabase
          .from("debate_participants")
          .select("*, user:users(username, display_name, avatar_url)")
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
          .select("username, display_name")
          .eq("id", inviterId)
          .maybeSingle();
        if (data) name = displayName(data) || name;
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

  /* The tool panel is large enough that leaving it open until the trigger
     is pressed again feels like a stuck overlay, so it takes the two
     dismissals people try by reflex. `pointerdown` rather than `click`:
     it fires before focus moves, so the panel is already gone by the time
     whatever was clicked underneath reacts. */
  useEscapeClose(moreOpen, () => setMoreOpen(false));
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!moreWrapRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [moreOpen]);

  const myRole = useMemo(() => {
    if (!room) return "audience" as const;
    if (myParticipation) return deriveStageRole(myParticipation, room);
    // Not seated yet: the room creator still holds host power.
    if (currentUser && currentUser.id === room.host_id) return "host" as const;
    return "audience" as const;
  }, [myParticipation, currentUser, room]);

  /* ── Scheduled-debate door ─────────────────────────────────────────
     A scheduled room opens 30 minutes before its start time. Until then
     only the host may enter (to set up); everyone else waits outside. */
  const opensAtMs = useMemo(() => {
    if (!room?.scheduled_start || room.status === "live" || room.status === "ended") return null;
    return new Date(room.scheduled_start).getTime() - 30 * 60 * 1000;
  }, [room?.scheduled_start, room?.status]);
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (opensAtMs === null || Date.now() >= opensAtMs) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [opensAtMs]);
  const gated = opensAtMs !== null && nowTs < opensAtMs && myRole !== "host" && !broadcast;

  /* ── Seat heartbeat ────────────────────────────────────────────────
     touch_seat stamps our participant row's last_seen_at; ghost seats
     are swept server-side after 5 minutes of silence. */
  const heartbeatOn =
    !!currentUser && !!room && room.status !== "ended" && !gated && !broadcast;
  useEffect(() => {
    if (!heartbeatOn) return;
    const beat = () => supabase.rpc("touch_seat", { p_room: roomId }).then(undefined, () => {});
    beat();
    const t = setInterval(beat, 60_000);
    return () => clearInterval(t);
  }, [heartbeatOn, roomId, supabase]);

  /* ── Live call (LiveKit) ───────────────────────────────────────────
     Everyone connects: on-stage roles with publish rights, listeners and
     guests subscribe-only. The buttons below drive this, and the active-
     speaker set feeds the stage rings with real voice activity. */
  const myUsername =
    displayName(myParticipation?.user) ||
    (currentUser?.email?.split("@")[0] ?? "Guest");
  const call = useAgoraCall({
    roomId,
    userId: currentUser?.id ?? null,
    username: myUsername,
    canPublish: onStage(myRole),
    ready: loaded && !!room && !gated,
    highQuality: view === "speaker",
    external: broadcastCreds,
  });

  useEffect(() => {
    if (!avDebugOn) return;
    const t = setInterval(() => setAvDebug(call.debugSnapshot()), 1000);
    return () => clearInterval(t);
  }, [avDebugOn, call]);

  useEffect(() => {
    if (!broadcast) return;
    setView("speaker");
  }, [broadcast]);

  const recordingSignaledRef = useRef(false);
  useEffect(() => {
    if (!broadcast || recordingSignaledRef.current) return;
    if (loaded && room && call.connected) {
      recordingSignaledRef.current = true;
      // LiveKit egress template contract: filming begins on this log line.
      console.log("START_RECORDING");
    }
  }, [broadcast, loaded, room, call.connected]);
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
      name: displayName(p.user) || "?",
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
          name: displayName(p.user) || "?",
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
      ? {
          id: p.user_id,
          username: p.user?.username ?? "?",
          name: displayName(p.user) || "?",
          avatarUrl: p.user?.avatar_url ?? null,
        }
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
      name: displayName(p.user) || "?",
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

  /* ── Stage panes ───────────────────────────────────────────────────
     The lead PRO/CON speakers own the two stage boxes — DOM now, drawn by
     AgoraStage over the scene where the WebGL panels used to stand. Each
     pane carries its holder's identity plus their live camera when it's
     on; camera off shows the profile card, no holder shows the open
     seat. */
  const stagePanes = useMemo(() => {
    const cams = call.videoTiles.filter((t) => t.source === "camera");
    const mk = (sp: (typeof proSpeakers)[number] | undefined) =>
      sp
        ? {
            id: sp.id,
            /* Display name on the tag; raw handle rides along for the menu. */
            username: sp.name || sp.username,
            handle: sp.username,
            avatarUrl: sp.avatarUrl,
            local: currentUser?.id === sp.id,
            tile: cams.find((t) => t.identity === sp.id) ?? null,
          }
        : null;
    return { pro: mk(proSpeakers[0]), con: mk(conSpeakers[0]) };
  }, [call.videoTiles, proSpeakers, conSpeakers, currentUser]);

  /* The dock keeps only what the stage doesn't already show at size:
     cameras from people who hold no pane (host, co-host, promoted
     speakers beyond the pair). During a share it empties entirely — the
     cast row is showing the room. Labels prefer the seated row's display
     name; the raw handle rides along for the user context menu. */
  const dockTiles = useMemo(() => {
    if (call.videoTiles.some((t) => t.source === "screen")) return [];
    const paneIds = new Set(
      [stagePanes.pro?.id, stagePanes.con?.id].filter(Boolean)
    );
    return call.videoTiles
      .filter((t) => t.source === "camera" && !paneIds.has(t.identity))
      .map((t) => {
        const u = participants.find((p) => p.user_id === t.identity)?.user;
        return u ? { ...t, username: displayName(u) || t.username, handle: u.username } : t;
      });
  }, [call.videoTiles, stagePanes, participants]);

  /* Walking in seats you: signed-in visitors get a spectator row right
     away, so you're visible in the crowd the moment you arrive — raising
     a hand is for speaking, not for existing. Returning visitors get
     their old row restored (left_at cleared) with role untouched, so a
     re-entering host or speaker lands back where they belong. */
  const seatAttemptedRef = useRef(false);
  useEffect(() => {
    if (seatAttemptedRef.current) return;
    if (!loaded || !currentUser || !room || room.status === "ended" || gated) return;
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
  }, [loaded, currentUser, room, myParticipation, roomId, supabase, fetchAll, gated]);

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

  if (gated && opensAtMs !== null) {
    const start = room.scheduled_start ? new Date(room.scheduled_start) : null;
    const opens = new Date(opensAtMs);
    const minsLeft = Math.max(1, Math.ceil((opensAtMs - nowTs) / 60000));
    const countdown =
      minsLeft >= 1440
        ? `${Math.floor(minsLeft / 1440)}d ${Math.floor((minsLeft % 1440) / 60)}h`
        : minsLeft >= 60
          ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`
          : `${minsLeft}m`;
    return (
      <div
        className="ag-root ag-loading"
        style={{ textAlign: "center", padding: "0 24px", flexDirection: "column", gap: 0, alignItems: "center", justifyContent: "center" }}
      >
        <p className="m-0 text-[11px]" style={{ color: "#c9a6f0", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, letterSpacing: "0.08em" }}>
          SCHEDULED DEBATE
        </p>
        <h1 className="m-0 mt-2 text-[22px]" style={{ color: "#f5f5f0", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, maxWidth: 640 }}>
          {room.motion}
        </h1>
        {start && (
          <p className="m-0 mt-3 text-[13px]" style={{ color: "#c0c0c8" }}>
            Starts {start.toLocaleDateString([], { month: "short", day: "numeric" })} at{" "}
            {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        )}
        <p className="m-0 mt-1.5 text-[12px]" style={{ color: "#8b8b94" }}>
          Doors open 30 minutes before start — come back at{" "}
          {opens.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (in {countdown}).
        </p>
        <button
          onClick={() => router.push("/")}
          className="cursor-pointer text-[12px] px-4 py-2 rounded-lg mt-5"
          style={{ background: "rgba(255,255,255,0.07)", border: "0.5px solid #3a3a42", color: "#e0e0e6", fontFamily: "inherit" }}
        >
          ← Back to home
        </button>
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
    <div className={`ag-root${railCollapsed ? " rail-collapsed" : ""}`}>
      <div className="ag-main">
        {/* ── Top bar ── */}
        {broadcast && (
          <style>{`.ag-switch-view { display: none !important; }`}</style>
        )}
        {broadcast && (
          <div
            style={{
              position: "absolute",
              bottom: 14,
              right: 16,
              zIndex: 60,
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: 15,
              color: "rgba(255,255,255,0.85)",
              textShadow: "0 1px 8px rgba(0,0,0,0.8)",
              pointerEvents: "none",
            }}
          >
            Agora<span style={{ color: "#3b6cf6" }}>Sphere</span> · agorasphere.net
          </div>
        )}
        {!broadcast && (
        <header className="ag-topbar">
          <button
            className="ag-back"
            onClick={() => {
              /* The stage lives and dies with its host: hosts confirm the
                 close; everyone else just walks out. */
              if (isHostRole(myRole) && room.status !== "ended") setLeavePrompt(true);
              else {
                vacateSeat();
                router.push("/");
              }
            }}
            title="Back to home"
          >
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
            {room.hls_url && !onStage(myRole) && (
              <button
                className="ag-follow"
                title="Watch the broadcast stream instead of the live call"
                onClick={() => setHlsOpen(true)}
              >
                Watch stream
              </button>
            )}
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
        )}

        {/* ── Amphitheater ── */}
        <Amphitheater
        performanceMode={broadcast}
          roomId={roomId}
          proSpeakers={proSpeakers}
          conSpeakers={conSpeakers}
          stageStrip={stageStrip}
          audience={audience}
          viewerCount={room.viewer_count ?? 0}
          view={view}
          onSwitchView={() => setView((v) => (v === "audience" ? "speaker" : "audience"))}
          onViewSettled={() => setViewSettled(true)}
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

        {/* ── Host leave prompt: the stage lives and dies with its host —
              leaving always closes the room, so this is just a confirm. ── */}
        {leavePrompt && room?.status !== "ended" && (
          <div className="ag-invite" role="dialog" aria-label="Close stage confirmation">
            <span className="ag-invite-text">
              You&apos;re the <strong>host</strong> — leaving closes the stage for everyone. Close it?
            </span>
            <div className="ag-invite-actions">
              <button
                className="ag-invite-decline"
                disabled={closingStage}
                onClick={() => setLeavePrompt(false)}
              >
                Stay
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
                  /* Kill any restream with the stage — an egress left running
                     films a black page and bills LiveKit minutes. */
                  fetch("/api/egress", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ roomId, action: "stop_all" }),
                  }).catch(() => {});
                  router.push("/");
                }}
              >
                {closingStage ? "Closing…" : "Close stage"}
              </button>
            </div>
          </div>
        )}

        {hlsOpen && room.hls_url && (
          <HlsPlayer src={room.hls_url} onClose={() => setHlsOpen(false)} />
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

        {/* ── The stage: debater boxes, and the share when one is live.
              In speaker view it waits for the camera to land among the
              stars before fading in; audience view shows it as soon as a
              picture is live (no glide to wait out). ── */}
        {(view === "audience" || viewSettled) && (
          <AgoraStage tiles={call.videoTiles} panes={stagePanes} view={view} speaking={call.speakingIds} />
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

        {avDebugOn && avDebug && (
          <pre
            style={{
              position: "absolute",
              top: 90,
              left: 12,
              zIndex: 80,
              maxWidth: 380,
              maxHeight: "50vh",
              overflow: "auto",
              background: "rgba(0,0,0,0.85)",
              border: "1px solid #444",
              borderRadius: 10,
              color: "#8f8",
              fontSize: 11,
              padding: 10,
              margin: 0,
            }}
          >
            {JSON.stringify(avDebug, null, 1)}
          </pre>
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
        {!broadcast && (
        <footer className="ag-controls">
          {/* Order is deliberate, and groups by how often a hand reaches
              for it: mic and camera leftmost, then the two you use while
              someone else holds the floor (react, raise hand), then screen
              share — rare enough to sit out by More, which keeps the frequent
              controls at the positions muscle memory already knows. Leave
              stays far right, where a destructive control belongs.

              Fill colour carries state: solid green = you are transmitting
              (mic, camera), solid white = your screen is on the wall, solid
              yellow = the reaction tray is open. Everything idle is black
              glass. Leave is the only control that is coloured at rest. */}

          {/* ── Mic ── */}
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
            <span className="ag-ctl-ico">{call.micOn ? (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>) : (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>)}</span>
            <span className="ag-ctl-label">{call.micOn ? "Mute" : "Mic"}</span>
          </button>

          {/* ── Video ── */}
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
            <span className="ag-ctl-ico">{call.camOn ? (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m23 7-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>) : (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="2" y1="2" x2="22" y2="22"/><path d="M16 16v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m4 0h5a2 2 0 0 1 2 2v3l5-3v9"/></svg>)}</span>
            <span className="ag-ctl-label">{call.mediaBusy ? "…" : call.camOn ? "Stop video" : "Video"}</span>
          </button>

          {/* ── React ── */}
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
              className={`ag-ctl ${reactOpen ? "ag-ctl--reacting" : ""}`}
              title={call.connected ? "Send a reaction" : "Connecting…"}
              disabled={!call.connected}
              onClick={() => setReactOpen((v) => !v)}
            >
              <span className="ag-ctl-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></span>
              <span className="ag-ctl-label">React</span>
            </button>
          </div>

          {/* ── Raise hand (or step down, when you hold the mic) ── */}
          {amMicHolder ? (
            <button className="ag-ctl ag-ctl--live" title="Give up the mic" onClick={stepDownFromMic}>
              <span className="ag-ctl-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg></span>
              <span className="ag-ctl-label">Step down</span>
            </button>
          ) : (
            <button
              className={`ag-ctl ${handRaised ? "ag-ctl--active" : ""}`}
              title={raiseTitle}
              disabled={!canRaise || requestsLocked || handBusy}
              onClick={toggleHand}
            >
              <span className="ag-ctl-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg></span>
              <span className="ag-ctl-label">{handRaised ? "Lower hand" : "Raise hand"}</span>
            </button>
          )}

          {/* ── Share screen ── */}
          <button
            className={`ag-ctl ${call.screenOn ? "ag-ctl--sharing" : ""}`}
            title={
              !onStage(myRole)
                ? "Screen share — speakers only"
                : !call.connected
                  ? "Connecting…"
                  : call.screenOn
                    ? "Stop sharing your screen"
                    : "Share your screen"
            }
            disabled={!onStage(myRole) || !call.connected || call.mediaBusy}
            onClick={call.toggleScreenShare}
          >
            <span className="ag-ctl-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m9 10 3-3 3 3M12 7v6"/></svg></span>
            <span className="ag-ctl-label">{call.screenOn ? "Stop share" : "Share"}</span>
          </button>

          {/* ── More: the room's tool drawer ──
              Four quadrants rather than a list. The tools are peers, not a
              ranked menu, and a square of equal tiles says that where a
              stack of rows would imply an order that doesn't exist.

              Whiteboard, Notepad and Documents have no backend yet, so they
              are marked and disabled rather than rendered as live buttons —
              the same reasoning as the media-error toast above: a control
              that looks ready and does nothing is worse than one that says
              it isn't ready. Settings is real and goes to /settings. */}
          <div className="ag-react-wrap" ref={moreWrapRef}>
            {moreOpen && (
              <div className="ag-more-menu" role="menu" aria-label="Room tools">
                <div className="ag-tool-grid">
                  <button className="ag-tool" role="menuitem" disabled title="Whiteboard — not built yet">
                    <span className="ag-tool-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M12 16.5v4M8.5 20.5h7"/><path d="M6.5 12.5c2-3.5 4-3.5 5.5-1s3.5 2 5.5-2"/></svg></span>
                    <span className="ag-tool-label">Whiteboard</span>
                    <span className="ag-tool-soon">Soon</span>
                  </button>

                  <button className="ag-tool" role="menuitem" disabled title="Notepad — not built yet">
                    <span className="ag-tool-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5.5 3.5h13a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></svg></span>
                    <span className="ag-tool-label">Notepad</span>
                    <span className="ag-tool-soon">Soon</span>
                  </button>

                  <button className="ag-tool" role="menuitem" disabled title="Documents — not built yet">
                    <span className="ag-tool-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M8 2.5h6l4.5 4.5v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M14 2.5V7h4.5"/><path d="M4.5 6v14a1.5 1.5 0 0 0 1.5 1.5h9"/></svg></span>
                    <span className="ag-tool-label">Documents</span>
                    <span className="ag-tool-soon">Soon</span>
                  </button>

                  {/* An anchor, not a button calling window.open: a real
                      link with target=_blank is a native user navigation
                      that popup blockers never intercept, where window.open
                      can be silently swallowed and leave a dead tile. New
                      tab either way — navigating this one would tear down
                      the LiveKit connection and drop you out of a live room
                      to change a preference. */}
                  <a
                    className="ag-tool"
                    role="menuitem"
                    href="/settings"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Settings — opens in a new tab so the room keeps running"
                    onClick={() => setMoreOpen(false)}
                  >
                    <span className="ag-tool-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
                    <span className="ag-tool-label">Settings</span>
                  </a>
                </div>

                {/* Kept from the old list: it is the only secondary action in
                    this room that already works, and it isn't a tool, so it
                    rides under the quadrants rather than taking one. */}
                <button
                  className="ag-more-item"
                  role="menuitem"
                  onClick={() => {
                    /* The panel deliberately stays open: the label itself is
                       the confirmation, and closing it would hide the only
                       feedback that the copy worked. */
                    navigator.clipboard
                      ?.writeText(window.location.href)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1600);
                      })
                      .catch(() => setCopied(false));
                  }}
                >
                  {copied ? "Copied" : "Copy room link"}
                </button>
              </div>
            )}
            <button
              className={`ag-ctl ${moreOpen ? "ag-ctl--active" : ""}`}
              title="More options"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <span className="ag-ctl-ico"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></span>
              <span className="ag-ctl-label">More</span>
            </button>
          </div>

          {/* ── Leave ── */}
          <button
            className="ag-ctl ag-ctl--leave"
            title="Leave the room"
            onClick={() => {
              if (isHostRole(myRole)) {
                setLeavePrompt(true);
              } else {
                vacateSeat();
                router.push("/");
              }
            }}
          >
            <span className="ag-ctl-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg></span>
            <span className="ag-ctl-label">Leave</span>
          </button>
        </footer>
        )}
      </div>

      {!broadcast && (
        <AgoraSidebar
          roomId={roomId}
          currentUser={currentUser}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((v) => !v)}
        />
      )}

      {/* Agora AI assistant — the full pipeline (Gemini + retrieval + history)
          lives behind /api/agora; this is its surface in the amphitheater,
          which is where every room entry routes now. */}
      {!broadcast && <AgoraAssistant motion={room.motion} roomId={roomId} topicKey={room.topic_key} />}
    </div>
  );
}
