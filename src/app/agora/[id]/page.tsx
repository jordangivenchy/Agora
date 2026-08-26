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
import { useAgoraCall, tileKey } from "@/components/agora/useAgoraCall";
import { CallGallery, CallMultiSpeaker, type LayoutTile } from "@/components/agora/CallLayouts";
import HostControls from "@/components/agora/HostControls";
import HlsPlayer, { HlsBroadcastSurface } from "@/components/agora/HlsPlayer";
import DebateReplay from "@/components/agora/DebateReplay";
import { roomPath } from "@/lib/urls";
import InvitePrompt from "@/components/agora/InvitePrompt";
import ReportModal, { type ReportTarget } from "@/components/ReportModal";
import { type StageParticipant, deriveStageRole, isHostRole, onStage, sortRequests } from "@/components/agora/stage";
import type { User } from "@supabase/supabase-js";
import { Icon } from "@/components/icons";
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
  /* Status the room had when this visitor first loaded it — 'ended' here
     means they arrived after the close and should get the replay. */
  const [firstStatus, setFirstStatus] = useState<string | null>(null);
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
  /* Queue-matched 1v1 ("duel"): pro_size/con_size of 1 are written only
     by queue_for_topic — the create modal passes 10/10 under the hood.
     Duels eliminate the amphitheater vantage for everyone in the room:
     no view toggle, no layout switch — just the two speaker screens
     (gallery layout, which renders exactly two face-to-face panes). */
  const duel = !broadcastCreds && room?.pro_size === 1 && room?.con_size === 1;
  /* ── Call layout: the viewer's own arrangement of the live pictures.
     Orthogonal to the 3D vantage: "stage" is today's behavior; "gallery"
     and "multi" are flat overlays above the scene. Local-only — nothing
     changes on the wire — and remembered across visits. */
  const [layout, setLayout] = useState<"stage" | "gallery" | "multi">("stage");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("agora:call-layout");
      if (saved === "gallery" || saved === "multi" || saved === "stage") setLayout(saved);
    } catch {
      /* private mode — default stands */
    }
  }, []);
  const pickLayout = useCallback((l: "stage" | "gallery" | "multi") => {
    setLayout(l);
    try {
      localStorage.setItem("agora:call-layout", l);
    } catch {
      /* best effort */
    }
  }, []);
  /* The viewer's pin, held as a tile key and resolved against the live
     list every render — a feed that ends simply stops matching and the
     multi layout falls back to its recent-speakers logic. */
  const [layoutPin, setLayoutPin] = useState<string | null>(null);
  /* `g` cycles layouts, Zoom-fashion — unless something is being typed. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "g" && e.key !== "G") return;
      if (duel) return; // duels are locked to the two-pane gallery
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      setLayout((prev) => {
        const next = prev === "stage" ? "gallery" : prev === "gallery" ? "multi" : "stage";
        try {
          localStorage.setItem("agora:call-layout", next);
        } catch {
          /* best effort */
        }
        return next;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duel]);
  /* Duel rooms land everyone in the two-pane view. setLayout directly
     (not pickLayout) so the viewer's saved layout preference for normal
     rooms is left alone. */
  useEffect(() => {
    if (!duel) return;
    setView("speaker");
    setLayout("gallery");
  }, [duel]);
  /* Unpinning the near-fullscreen screen share in a duel snaps back to
     the two-pane gallery instead of stranding the pair in multi view. */
  useEffect(() => {
    if (duel && layout === "multi" && !layoutPin) setLayout("gallery");
  }, [duel, layout, layoutPin]);
  /* The DOM stage holds back until the camera glide lands on the current
     vantage — fading panes in mid-flight read as riding the camera. */
  const [viewSettled, setViewSettled] = useState(false);
  /* Chat rail collapsed → the stage runs the full width of the page, for
     watching without the chat in frame. Lives here rather than in the
     rail because the collapsed class drives layout on .ag-root. */
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* Audience overflow: watch the composited HLS stream instead of WebRTC. */
  const [hlsOpen, setHlsOpen] = useState(false);
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  useEffect(() => {
    setViewSettled(false);
  }, [view]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [handBusy, setHandBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const [topMenuOpen, setTopMenuOpen] = useState(false);

  const [camMenuOpen, setCamMenuOpen] = useState(false);
  const camMenuRef = useRef<HTMLDivElement | null>(null);
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const micMenuRef = useRef<HTMLDivElement | null>(null);
  const topMenuRef = useRef<HTMLDivElement | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteDone, setNoteDone] = useState(false);
  const moreWrapRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  /* Community-hosted rooms carry the community's name in the topbar. */
  const [communityName, setCommunityName] = useState<string | null>(null);

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
      setFirstStatus((prev) => prev ?? roomData.status);
      if (partData) setParticipants(partData as StageParticipant[]);
      if (roomData.community_id) {
        const { data: comm } = await supabase
          .from("communities")
          .select("name")
          .eq("id", roomData.community_id)
          .maybeSingle();
        setCommunityName(comm?.name ?? null);
      } else {
        setCommunityName(null);
      }
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
  useEscapeClose(topMenuOpen, () => setTopMenuOpen(false));
  useEscapeClose(camMenuOpen, () => setCamMenuOpen(false));
  useEscapeClose(micMenuOpen, () => setMicMenuOpen(false));
  useEffect(() => {
    if (!micMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!micMenuRef.current?.contains(e.target as Node)) setMicMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [micMenuOpen]);
  useEscapeClose(settingsOpen, () => setSettingsOpen(false));
  useEffect(() => {
    if (!camMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!camMenuRef.current?.contains(e.target as Node)) setCamMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [camMenuOpen]);
  useEscapeClose(noteOpen, () => setNoteOpen(false));
  useEffect(() => {
    if (!topMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!topMenuRef.current?.contains(e.target as Node)) setTopMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [topMenuOpen]);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!moreWrapRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [moreOpen]);

  /* Host toggle for Agora's Live Moderator mode (agora_moderator column). */
  const toggleModerator = useCallback(
    async (on: boolean) => {
      if (!currentUser || !room || currentUser.id !== room.host_id) return;
      setRoom((r) => (r ? { ...r, agora_moderator: on } : r));
      const { error } = await supabase
        .from("debate_rooms")
        .update({ agora_moderator: on })
        .eq("id", room.id);
      if (error) {
        console.error("moderator toggle failed", error);
        setRoom((r) => (r ? { ...r, agora_moderator: !on } : r));
      }
    },
    [currentUser, room, supabase]
  );

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
  /* Tile count fed back into the call's quality hint (set post-render). */
  const [liveTileCount, setLiveTileCount] = useState(0);
  const call = useAgoraCall({
    roomId,
    userId: currentUser?.id ?? null,
    username: myUsername,
    canPublish: onStage(myRole),
    ready: loaded && !!room && !gated,
    /* Big tiles deserve the high simulcast layer: the close-up 3D
       vantage as before, multi-speaker always (its featured tiles are
       large), and gallery when tiles are few enough to render big.
       liveTileCount lags one render behind the call — harmless, it only
       retunes subscription quality. */
    highQuality:
      layout === "multi"
        ? liveTileCount > 0
        : layout === "gallery"
          ? liveTileCount > 0 && liveTileCount <= 4
          : view === "speaker",
    external: broadcastCreds,
  });
  useEffect(() => {
    setLiveTileCount(call.videoTiles.length);
  }, [call.videoTiles.length]);

  /* ── HLS audience mode ─────────────────────────────────────────────
     Over the spectator ceiling the token API answers "watch the
     broadcast" instead of minting a WebRTC token: the stage surface
     renders the composited HLS stream and the publish controls hide.
     Chat, Q&A and hand-raise are Supabase-driven and keep working.
     Promotion is seamless: an approved raise-hand updates our
     participants row, onStage(myRole) flips, and the call hook's
     connect effect re-requests a token with the new role — the server
     sees the stage row and hands out WebRTC. */
  const hlsAudience = !broadcast && !!call.hlsMode;
  const { hlsMode, retryConnect } = call;
  useEffect(() => {
    /* Egress died mid-watch (hls_url nulled via realtime): fall back to
       requesting a WebRTC token — with no stream the threshold check
       lets everyone in. */
    if (!hlsMode || broadcast || !room) return;
    if (room.status === "live" && !room.hls_url) retryConnect();
  }, [hlsMode, broadcast, room, retryConnect]);

  /* Raised-hand fast lane, waiting side: a broadcast viewer whose hand is
     up but who was beyond the fast-lane cap re-asks the token API each
     time the line moves forward (someone ahead was brought up or gave
     up) — the server re-ranks and may now grant the real-time WebRTC
     seat. Deliberately narrow deps + a decrease check: hlsMode is a
     fresh object per token answer, so keying on it would loop. */
  const prevQueuePosRef = useRef<number | null>(null);

  /* Tiles dressed for the flat layouts: display names and mute state
     from the seated rows; the local mute state from the call itself. */
  /* Every on-stage participant gets a tile — live camera when they have
     one, avatar placeholder otherwise — matching what the stage/dock show.
     Screen shares ride along as extra tiles. */
  const layoutTiles = useMemo<LayoutTile[]>(() => {
    const tiles: LayoutTile[] = call.videoTiles.map((t) => {
      const p = participants.find((pp) => pp.user_id === t.identity);
      return {
        key: tileKey(t),
        identity: t.identity,
        username: (p?.user ? displayName(p.user) : "") || t.username,
        handle: p?.user?.username,
        local: t.local,
        source: t.source,
        track: t.track,
        micMuted: t.local ? !call.micOn : !!p?.mic_muted,
        avatarUrl: p?.user?.avatar_url ?? null,
      };
    });
    const haveCamera = new Set(
      tiles.filter((t) => t.source === "camera").map((t) => t.identity)
    );
    for (const p of participants) {
      if (!room || !onStage(deriveStageRole(p, room))) continue;
      if (p.left_at || haveCamera.has(p.user_id)) continue;
      tiles.push({
        key: `${p.user_id}:off`,
        identity: p.user_id,
        username: (p.user ? displayName(p.user) : "") || p.user?.username || "Speaker",
        handle: p.user?.username,
        local: p.user_id === userId,
        source: "camera",
        track: null,
        micMuted: p.user_id === userId ? !call.micOn : !!p.mic_muted,
        avatarUrl: p.user?.avatar_url ?? null,
        avatarSeed: p.user_id,
      });
    }
    return tiles;
  }, [call.videoTiles, call.micOn, participants, room, userId]);

  useEffect(() => {
    if (!avDebugOn) return;
    const t = setInterval(() => setAvDebug(call.debugSnapshot()), 1000);
    return () => clearInterval(t);
  }, [avDebugOn, call]);

  useEffect(() => {
    if (!broadcast) return;
    setView("speaker");
  }, [broadcast]);

  /* ── Default recording: every live debate streams to HLS/R2 so the
        replay always exists and overflow viewers can watch. The host's
        client starts it once connected; harmless if already running
        (the egress route reuses an active stream) and best-effort —
        the debate never blocks on it. Cron/close-stage stop it. ── */
  const autoHlsRef = useRef(false);
  useEffect(() => {
    if (broadcast || autoHlsRef.current) return;
    if (!room || room.status !== "live" || room.hls_url) return;
    if (!currentUser || currentUser.id !== room.host_id || !call.connected) return;
    autoHlsRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/egress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId: room.id, action: "start_hls" }),
        });
        if (!res.ok) {
          const txt = await res.text();
          /* Host turned VODs off, or their storage allowance is full —
             a choice, not a fault: stay quiet and don't retry. */
          if (/recording_disabled|storage_full/.test(txt)) return;
          console.warn("[agora] auto HLS start failed:", txt);
          autoHlsRef.current = false; // allow a retry on the next state change
        }
      } catch (e) {
        console.warn("[agora] auto HLS start failed:", e);
        autoHlsRef.current = false;
      }
    })();
  }, [broadcast, room, currentUser, call.connected]);

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
      micMuted: p.user_id === currentUser?.id ? !call.micOn : !!p.mic_muted,
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

  useEffect(() => {
    const prev = prevQueuePosRef.current;
    prevQueuePosRef.current = myQueuePos;
    if (!hlsAudience || myQueuePos == null) return;
    if (prev != null && myQueuePos < prev) retryConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires only when the line moves; see prevQueuePosRef comment
  }, [myQueuePos]);

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

  const { stagePanes, paneStrip } = useMemo(() => {
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
            micMuted: sp.micMuted,
            tile: cams.find((t) => t.identity === sp.id) ?? null,
          }
        : null;
    const overflow = [...stageStrip];
    const pro = proSpeakers[0] ?? overflow.shift();
    const con = conSpeakers[0] ?? overflow.shift();
    return {
      stagePanes: { pro: mk(pro), con: mk(con) },
      paneStrip: overflow,
    };
  }, [call.videoTiles, proSpeakers, conSpeakers, stageStrip, currentUser]);

  /* The dock keeps only what the stage doesn't already show at size.
     The stage shows in audience view (anchored fixture) and in settled
     speaker view; while the camera is still gliding in speaker view every
     camera docks as a small tile so nobody's picture is lost. While the
     stage is up, pane holders leave the dock, and a live share empties it
     entirely. Labels prefer the seated row's display name; the raw handle
     rides along for the user context menu. */
  const stageUp = view === "speaker" && viewSettled;
  const dockTiles = useMemo(() => {
    if (stageUp && call.videoTiles.some((t) => t.source === "screen")) return [];
    const paneIds = stageUp
      ? new Set([stagePanes.pro?.id, stagePanes.con?.id].filter(Boolean))
      : new Set<string | undefined>();
    return call.videoTiles
      /* Stage down → everything docks, shares included (small, but not
         invisible; speaker view gives them the big surface). Stage up →
         cameras only, minus the pane holders. */
      .filter((t) => (stageUp ? t.source === "camera" && !paneIds.has(t.identity) : true))
      .map((t) => {
        const u = participants.find((p) => p.user_id === t.identity)?.user;
        return u ? { ...t, username: displayName(u) || t.username, handle: u.username } : t;
      });
  }, [call.videoTiles, stagePanes, participants, stageUp]);

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

  /* …but a closed tab CAN stamp out: sendBeacon outlives the page. On
     pagehide (with beforeunload as the fallback for browsers that skip
     it) the beacon hits /api/rooms/leave, which sets our left_at — and,
     for a live host, starts the 90-second host_left_at grace so a plain
     refresh doesn't kill the room (the room-lifecycle cron ends it only
     if we never come back; the LiveKit webhook is the belt to this
     brace). Ref-read so the handler never holds a stale seat. */
  const seatedRef = useRef(false);
  useEffect(() => {
    seatedRef.current = !!(currentUser && myParticipation && !myParticipation.left_at);
  }, [currentUser, myParticipation]);
  useEffect(() => {
    if (broadcast) return; // the egress compositor is not a participant
    const beacon = () => {
      if (!seatedRef.current) return;
      seatedRef.current = false; // pagehide + beforeunload can both fire
      try {
        navigator.sendBeacon("/api/rooms/leave", JSON.stringify({ roomId }));
      } catch {
        /* best effort — the webhook sweep catches what the beacon misses */
      }
    };
    window.addEventListener("pagehide", beacon);
    window.addEventListener("beforeunload", beacon);
    return () => {
      window.removeEventListener("pagehide", beacon);
      window.removeEventListener("beforeunload", beacon);
    };
  }, [roomId, broadcast]);

  /* Host is back: cancel the grace timer. The participant_joined webhook
     normally clears host_left_at; this covers the race where the page
     loads before (or without) LiveKit reconnecting. Falls back to a
     direct update if the RPC isn't migrated yet. */
  useEffect(() => {
    if (!currentUser || !room?.host_left_at || room.host_id !== currentUser.id) return;
    supabase.rpc("clear_host_left", { p_room: roomId }).then(({ error }) => {
      if (error) {
        supabase
          .from("debate_rooms")
          .update({ host_left_at: null })
          .eq("id", roomId)
          .eq("host_id", currentUser.id)
          .then(undefined, () => {});
      }
    });
  }, [currentUser, room?.host_left_at, room?.host_id, roomId, supabase]);

  /* Ended rooms are replays, not dead ends. A visitor who arrives after
     the end goes straight to the replay; someone who was in the room when
     the host closed the stage gets a hand-off card instead (the VOD
     playlist finalizes a few seconds after egress stops). */
  const arrivedEnded = firstStatus === "ended";
  const [showReplay, setShowReplay] = useState(false);

  /* ── Raise / lower hand ────────────────────────────────────────────
     Signed-in listeners only. Landing in the Agora doesn't create a
     participant row, so the first raise seats you in the room (upsert,
     mirroring the classic room page's rejoin-safe flow). */
  const handRaised = !!myParticipation?.hand_raised_at;
  /* True while this viewer holds a raised-hand fast-lane WebRTC seat they
     hopped into from the HLS broadcast — lowering the hand gives it back. */
  const handFastLaneRef = useRef(false);
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
      /* Fast-lane hop: raising while watching the ~10s-behind broadcast
         immediately re-asks the token API — near the front of the queue
         it now mints a real-time WebRTC seat, so a viewer who might be
         brought up is already at the live edge. Lowering re-asks too,
         which hands the seat back (the server answers HLS again). */
      if (!handRaised && call.hlsMode) {
        handFastLaneRef.current = true;
        retryConnect();
      } else if (handRaised && handFastLaneRef.current) {
        handFastLaneRef.current = false;
        retryConnect();
      }
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

  if ((arrivedEnded || showReplay) && !broadcast) {
    return <DebateReplay roomId={roomId} initialRoom={room} />;
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
          SCHEDULED DISCUSSION
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
        {(broadcast || duel) && (
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
              if (isHostRole(myRole) && !duel && room.status !== "ended") setLeavePrompt(true);
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
              {room.status === "live" ? "LIVE DISCUSSION" : room.status === "created" ? "STARTING SOON" : "DISCUSSION"}
            </div>
            <h1 className="ag-motion">{room.motion}</h1>
            <div className="ag-topbar-meta">
              <span title="Elapsed"><Icon name="clock" size={13} /> {elapsed} elapsed</span>
              <span title="Audience"><Icon name="users" size={13} /> {audienceCount} in audience</span>
              {topic && (
                <span title="Topic">
                  {topic.emoji} {topic.label}
                </span>
              )}
              {communityName && (
                <span title="Hosted by this community" style={{ color: "#c9b06a" }}>
                  <Icon name="landmark" size={13} /> {communityName}
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
            <div className="ag-react-wrap" ref={topMenuRef}>
              {topMenuOpen && (
                <div className="ag-more-menu ag-more-menu--down" role="menu" aria-label="Room options">
                  <button
                    className="ag-more-item"
                    role="menuitem"
                    onClick={() => {
                      setTopMenuOpen(false);
                      if (!room) return;
                      const host = participants.find((pp) => pp.user_id === room.host_id);
                      setReportTarget({
                        userId: room.host_id,
                        username: host?.user?.username ?? "host",
                        context: "room",
                        roomId,
                      });
                    }}
                  >
                    Report stream
                  </button>
                  <button
                    className="ag-more-item"
                    role="menuitem"
                    onClick={() => {
                      setTopMenuOpen(false);
                      if (!room) return;
                      const host = participants.find((pp) => pp.user_id === room.host_id);
                      setReportTarget({
                        userId: room.host_id,
                        username: host?.user?.username ?? "host",
                        context: "room",
                        roomId,
                      });
                    }}
                  >
                    Report something else
                  </button>
                  <button
                    className="ag-more-item"
                    role="menuitem"
                    onClick={() => {
                      setTopMenuOpen(false);
                      setNoteText("");
                      setNoteDone(false);
                      setNoteOpen(true);
                    }}
                  >
                    Request a community note
                  </button>
                </div>
              )}
              <button
                className="ag-more"
                title="Room options"
                aria-haspopup="menu"
                aria-expanded={topMenuOpen}
                onClick={() => setTopMenuOpen((v) => !v)}
              >
                ⋯
              </button>
            </div>
          </div>
        </header>
        )}

        {/* ── Amphitheater ── */}
        <Amphitheater
        performanceMode={broadcast}
          roomId={roomId}
          /* Flat layouts (gallery / multi) carry every picture themselves —
             the scene's 3D speaker panels and mic medallion would peek
             around the tile band as duplicate mini-cards, so they clear
             the stage while a flat layout is up. */
          proSpeakers={view === "speaker" && layout !== "stage" ? [] : proSpeakers}
          conSpeakers={view === "speaker" && layout !== "stage" ? [] : conSpeakers}
          stageStrip={view === "speaker" && layout !== "stage" ? [] : paneStrip}
          audience={audience}
          viewerCount={room.viewer_count ?? 0}
          view={view}
          onSwitchView={() => setView((v) => (v === "audience" ? "speaker" : "audience"))}
          onViewSettled={() => setViewSettled(true)}
          speakerQueue={speakerQueue}
          micHolder={view === "speaker" && layout !== "stage" ? null : micHolder}
          micLive={!!(room.mic_user_id && call.speakingIds.has(room.mic_user_id))}
        />

        {/* ── Host controls (hosts and co-hosts only) ── */}
        {/* Duels have no host: the "host" seat is just whoever waited
            longer — nobody gets power over their opponent. */}
        {currentUser && isHostRole(myRole) && !duel && (
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
        {room?.status === "ended" && !broadcast && (
          <div className="ag-ended-card" role="dialog" aria-label="Discussion ended">
            <h2>Discussion ended</h2>
            <p>
              The host closed the stage.
              {room.recording_url
                ? " The replay will be available shortly — the recording finalizes a few seconds after the stream stops."
                : " The transcript and discussion are open now."}
            </p>
            <div className="ag-ended-actions">
              <button
                className="ag-invite-join"
                onClick={() => {
                  vacateSeat();
                  window.history.replaceState(null, "", roomPath({ id: room.id, motion: room.motion }));
                  setShowReplay(true);
                }}
              >
                {room.recording_url ? "Open the replay" : "Transcript & discussion"}
              </button>
              <button
                className="ag-invite-decline"
                onClick={() => {
                  vacateSeat();
                  router.push("/");
                }}
              >
                Back to home
              </button>
            </div>
          </div>
        )}

        <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />

        {noteOpen && room && (
          <div className="ag-invite" role="dialog" aria-label="Request a community note">
            {noteDone ? (
              <span className="ag-invite-text">
                Request sent — reviewers will see it with this room attached.
              </span>
            ) : (
              <>
                <span className="ag-invite-text">
                  <strong>Request a community note.</strong> What should it address?
                </span>
                <textarea
                  className="ag-note-input"
                  value={noteText}
                  maxLength={800}
                  rows={2}
                  placeholder="A claim made in this discussion that needs context…"
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <div className="ag-invite-actions">
                  <button className="ag-invite-decline" disabled={noteBusy} onClick={() => setNoteOpen(false)}>
                    Cancel
                  </button>
                  <button
                    className="ag-invite-join"
                    disabled={noteBusy || !noteText.trim()}
                    onClick={async () => {
                      setNoteBusy(true);
                      const { error } = await supabase.rpc("submit_report", {
                        p_reported: room.host_id,
                        p_reason: "other",
                        p_description: `[Community note request] ${noteText.trim()}`,
                        p_context: "room",
                        p_room: roomId,
                        p_message: null,
                      });
                      setNoteBusy(false);
                      if (!error) setNoteDone(true);
                    }}
                  >
                    {noteBusy ? "Sending…" : "Send request"}
                  </button>
                </div>
              </>
            )}
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
        {/* Camera surfaces exist in settled speaker view only — audience
              view keeps the open amphitheater, pictures riding the dock. */}
        {view === "speaker" && viewSettled && (
          hlsAudience ? (
            /* HLS audience mode: the broadcast IS the stage — one feed,
               same slot and lifecycle as AgoraStage. */
            <div className="ag-cast" role="region" aria-label="Broadcast view">
              <HlsBroadcastSurface src={call.hlsMode!.url} />
            </div>
          ) : layout === "stage" ? (
            <AgoraStage
              tiles={call.videoTiles}
              panes={stagePanes}
              view={view}
              speaking={call.speakingIds}
            />
          ) : (
            /* Gallery / multi-speaker take the stage's exact spot and
               lifecycle: same glide-in wait in speaker view, same anchored
               placement in audience view, vantage toggle untouched. */
            <div
              className="ag-cast ag-layout-flat"
              role="region"
              aria-label="Call layout"
            >
              {layout === "gallery" ? (
                <CallGallery
                  tiles={layoutTiles}
                  speaking={call.speakingIds}
                  onPin={(key) => {
                    /* Duels stay in the two-pane gallery — EXCEPT a
                       screen share, which pins near-fullscreen. */
                    if (duel && !key.endsWith(":screen")) return;
                    setLayoutPin(key);
                    pickLayout("multi");
                  }}
                />
              ) : (
                <CallMultiSpeaker
                  tiles={layoutTiles}
                  speaking={call.speakingIds}
                  pinnedKey={layoutPin}
                  onPin={setLayoutPin}
                />
              )}
            </div>
          )
        )}

        {/* ── Live camera tiles + floating reactions ── */}
        {hlsAudience && view === "audience" && (
          /* Audience vantage in HLS mode: the broadcast rides where the
             video dock sits — small, corner, the amphitheater stays the
             show. */
          <div
            style={{
              position: "absolute",
              right: 16,
              bottom: 96,
              width: 300,
              aspectRatio: "16 / 9",
              zIndex: 18,
            }}
          >
            <HlsBroadcastSurface src={call.hlsMode!.url} compact />
          </div>
        )}
        {!hlsAudience && (layout === "stage" || view === "audience") && (
          <AgoraVideoDock tiles={dockTiles} />
        )}
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
              <><Icon name="mic" size={14} /> You have the mic</>
            ) : myQueuePos === 1 ? (
              <><Icon name="sparkles" size={14} /> YOU&apos;RE NEXT</>
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
              <Icon name="volume-2" size={14} /> Your browser muted the room — <strong>tap to listen</strong>
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
          {/* HLS audience mode has no WebRTC leg — mic/cam/share can't
              exist, so the controls hide rather than sit dead. */}
          {!hlsAudience && (
          <>
          <div className="ag-react-wrap ag-cam-wrap" ref={micMenuRef}>
            {micMenuOpen && (
              <div className="ag-more-menu ag-cam-menu" role="menu" aria-label="Audio">
                <div className="ag-cam-menu-title">Select a microphone</div>
                {call.mics.length === 0 && (
                  <div className="ag-cam-menu-empty">Unmute once to let the browser name your microphones.</div>
                )}
                {call.mics.map((d, i) => {
                  const active = d.deviceId === call.activeMicId;
                  return (
                    <button
                      key={d.deviceId || i}
                      className={`ag-cam-item${active ? " is-active" : ""}`}
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        call.switchMic(d.deviceId);
                        setMicMenuOpen(false);
                      }}
                    >
                      <span className="ag-cam-check" aria-hidden>{active ? "✓" : ""}</span>
                      <span className="ag-cam-name">{d.label || `Microphone ${i + 1}`}</span>
                    </button>
                  );
                })}
                <div className="ag-cam-menu-sep" />
                <div className="ag-cam-menu-title">Select a speaker</div>
                {call.speakers.length === 0 && (
                  <div className="ag-cam-menu-empty">System default</div>
                )}
                {call.speakers.map((d, i) => {
                  const active = d.deviceId === call.activeSpeakerId;
                  return (
                    <button
                      key={d.deviceId || i}
                      className={`ag-cam-item${active ? " is-active" : ""}`}
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        call.switchSpeaker(d.deviceId);
                        setMicMenuOpen(false);
                      }}
                    >
                      <span className="ag-cam-check" aria-hidden>{active ? "✓" : ""}</span>
                      <span className="ag-cam-name">{d.label || `Speaker ${i + 1}`}</span>
                    </button>
                  );
                })}
                <div className="ag-cam-menu-sep" />
                <button
                  className="ag-cam-item"
                  role="menuitem"
                  onClick={() => {
                    setMicMenuOpen(false);
                    setSettingsOpen(true);
                    setRailCollapsed(false);
                  }}
                >
                  <span className="ag-cam-check" />
                  <span className="ag-cam-name">Audio settings</span>
                </button>
              </div>
            )}
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
              <span className="ag-ctl-ico">{call.micOn ? <Icon name="mic" size={19} /> : <Icon name="mic-off" size={19} />}</span>
              <span className="ag-ctl-label">{call.micOn ? "Mute" : "Mic"}</span>
            </button>
            {onStage(myRole) && call.connected && (
              <button
                className={`ag-ctl-caret${micMenuOpen ? " is-open" : ""}`}
                title="Audio options"
                aria-haspopup="menu"
                aria-expanded={micMenuOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setMicMenuOpen((v) => !v);
                }}
              >
                <Icon name="chevron-up" size={12} />
              </button>
            )}
          </div>

          <div className="ag-react-wrap ag-cam-wrap" ref={camMenuRef}>
            {camMenuOpen && (
              <div className="ag-more-menu ag-cam-menu" role="menu" aria-label="Camera">
                <div className="ag-cam-menu-title">Select a camera</div>
                {call.cameras.length === 0 && (
                  <div className="ag-cam-menu-empty">
                    No cameras found — turn your video on once to let the browser name them.
                  </div>
                )}
                {call.cameras.map((cam, i) => {
                  const active = cam.deviceId === call.activeCameraId;
                  return (
                    <button
                      key={cam.deviceId || i}
                      className={`ag-cam-item${active ? " is-active" : ""}`}
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        call.switchCamera(cam.deviceId);
                        setCamMenuOpen(false);
                      }}
                    >
                      <span className="ag-cam-check" aria-hidden>{active ? "✓" : ""}</span>
                      <span className="ag-cam-name">{cam.label || `Camera ${i + 1}`}</span>
                    </button>
                  );
                })}
                <div className="ag-cam-menu-sep" />

                <button className="ag-cam-item" disabled title="Not built yet">
                  <span className="ag-cam-check" />
                  <span className="ag-cam-name">Blur my background</span>
                  <span className="ag-tool-soon ag-cam-soon">Soon</span>
                </button>
                <button
                    className="ag-cam-item"
                    role="menuitem"
                    title="Call settings"
                    onClick={() => {
                      setMoreOpen(false);
                      setCamMenuOpen(false);
                      setSettingsOpen(true);
                      setRailCollapsed(false);
                    }}
                  >
                  <span className="ag-cam-check" />
                  <span className="ag-cam-name">Video &amp; audio settings</span>
                </button>
              </div>
            )}
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
              <span className="ag-ctl-ico">{call.camOn ? <Icon name="video" size={19} /> : <Icon name="video-off" size={19} />}</span>
              <span className="ag-ctl-label">{call.mediaBusy ? "…" : call.camOn ? "Stop video" : "Video"}</span>
            </button>

            {onStage(myRole) && call.connected && (
              <button
                className={`ag-ctl-caret${camMenuOpen ? " is-open" : ""}`}
                title="Camera options"
                aria-haspopup="menu"
                aria-expanded={camMenuOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setCamMenuOpen((v) => !v);
                }}
              >
                <Icon name="chevron-up" size={12} />
              </button>
            )}
          </div>
          </>
          )}

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
              title={call.connected || hlsAudience ? "Send a reaction" : "Connecting…"}
              disabled={!call.connected && !hlsAudience}
              onClick={() => setReactOpen((v) => !v)}
            >
              <span className="ag-ctl-ico"><Icon name="smile" size={19} /></span>
              <span className="ag-ctl-label">React</span>
            </button>
          </div>

          {/* ── Raise hand (or step down, when you hold the mic) ── */}
          {amMicHolder ? (
            <button className="ag-ctl ag-ctl--live" title="Give up the mic" onClick={stepDownFromMic}>
              <span className="ag-ctl-ico"><Icon name="mic" size={19} /></span>
              <span className="ag-ctl-label">Step down</span>
            </button>
          ) : (
            <button
              className={`ag-ctl ${handRaised ? "ag-ctl--active" : ""}`}
              title={raiseTitle}
              disabled={!canRaise || requestsLocked || handBusy}
              onClick={toggleHand}
            >
              <span className="ag-ctl-ico"><Icon name="hand" size={19} /></span>
              <span className="ag-ctl-label">{handRaised ? "Lower hand" : "Raise hand"}</span>
            </button>
          )}

          {/* ── Share screen ── */}
          {!hlsAudience && (
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
            <span className="ag-ctl-ico"><Icon name="monitor-up" size={19} /></span>
            <span className="ag-ctl-label">{call.screenOn ? "Stop share" : "Share"}</span>
          </button>
          )}

          {/* ── Layout switcher: how *you* see the room. Local only —
                every viewer arranges their own pictures. `g` cycles.
                Hidden in HLS mode — the broadcast is a single feed. ── */}
          {!hlsAudience && !duel && (
          <div className="ag-layout-switch" role="group" aria-label="Call layout">
            {(
              [
                { id: "stage", icon: "person-standing", label: "Stage view" },
                { id: "gallery", icon: "layout-grid", label: "Gallery view" },
                { id: "multi", icon: "users", label: "Multi-speaker view" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                className={`ag-layout-seg${layout === opt.id ? " is-active" : ""}`}
                title={`${opt.label} (g cycles)`}
                aria-label={opt.label}
                aria-pressed={layout === opt.id}
                onClick={() => pickLayout(opt.id)}
              >
                <Icon name={opt.icon} size={17} />
              </button>
            ))}
          </div>
          )}

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
                    <span className="ag-tool-ico"><Icon name="monitor" size={23} /></span>
                    <span className="ag-tool-label">Whiteboard</span>
                    <span className="ag-tool-soon">Soon</span>
                  </button>

                  <button className="ag-tool" role="menuitem" disabled title="Notepad — not built yet">
                    <span className="ag-tool-ico"><Icon name="clipboard-list" size={23} /></span>
                    <span className="ag-tool-label">Notepad</span>
                    <span className="ag-tool-soon">Soon</span>
                  </button>

                  <button className="ag-tool" role="menuitem" disabled title="Documents — not built yet">
                    <span className="ag-tool-ico"><Icon name="file-text" size={23} /></span>
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
                  <button
                    className="ag-tool"
                    role="menuitem"
                    title="Call settings"
                    onClick={() => {
                      setMoreOpen(false);
                      setCamMenuOpen(false);
                      setSettingsOpen(true);
                      setRailCollapsed(false);
                    }}
                  >
                    <span className="ag-tool-ico"><Icon name="settings" size={23} /></span>
                    <span className="ag-tool-label">Settings</span>
                  </button>
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
              <span className="ag-ctl-ico"><Icon name="more-vertical" size={19} /></span>
              <span className="ag-ctl-label">More</span>
            </button>
          </div>

          {/* ── Leave ── */}
          <button
            className="ag-ctl ag-ctl--leave"
            title="Leave the room"
            onClick={() => {
              if (isHostRole(myRole) && !duel) {
                setLeavePrompt(true);
              } else {
                vacateSeat();
                router.push("/");
              }
            }}
          >
            <span className="ag-ctl-ico"><Icon name="phone-off" size={19} /></span>
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
          settings={
            settingsOpen
              ? {
                  cameras: call.cameras,
                  activeCameraId: call.activeCameraId,
                  onSwitchCamera: call.switchCamera,
                  mics: call.mics,
                  activeMicId: call.activeMicId,
                  onSwitchMic: call.switchMic,
                  speakers: call.speakers,
                  activeSpeakerId: call.activeSpeakerId,
                  onSwitchSpeaker: call.switchSpeaker,
                  outputVolume: call.outputVolume,
                  onOutputVolume: call.setOutputVolume,
                  getMicStreamTrack: call.getMicStreamTrack,
                  onClose: () => setSettingsOpen(false),
                }
              : null
          }
        />
      )}

      {/* Agora AI assistant — the full pipeline (Gemini + retrieval + history)
          lives behind /api/agora; this is its surface in the amphitheater,
          which is where every room entry routes now. */}
      {!broadcast && (
        <AgoraAssistant
          motion={room.motion}
          roomId={roomId}
          topicKey={room.topic_key}
          /* Background "Hey Agora" listening + transcription for anyone on
             stage with a mic while the room is live (host, co-host, speakers). */
          liveListening={
            room.status === "live" &&
            call.connected &&
            myRole !== "audience" &&
            !myParticipation?.left_at
          }
          moderatorOn={!!room.agora_moderator}
          canModerate={!!currentUser && currentUser.id === room.host_id}
          onToggleModerator={toggleModerator}
        />
      )}
    </div>
  );
}
