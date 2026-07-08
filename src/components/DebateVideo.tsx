"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  useParticipants,
  AudioTrack,
  useLocalParticipant,
  useRoomContext,
  type TrackReference,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track, RoomEvent, type Participant } from "livekit-client";
import type { DebateParticipant } from "@/types/database";
import { uniqueViewerCount } from "@/lib/viewerCount";

type ParticipantWithUser = DebateParticipant & {
  user: { username: string; avatar_url: string | null };
};

/** Live connection/VAD state for a debater tile. */
type TilePresence = "speaking" | "silent" | "disconnected";

interface Props {
  token: string;
  serverUrl: string;
  isDebater: boolean;
  hostId: string;
  currentUserId: string;
  proDebater?: ParticipantWithUser;
  conDebater?: ParticipantWithUser;
  spectators: ParticipantWithUser[];
  timeLimitSeconds: number | null;
  /** My hand_raised_at (null = lowered). DB-backed via the room page. */
  myHandRaisedAt: string | null;
  onToggleHand: () => void;
  /** True while the debate is live — activity monitoring only runs then. */
  roomLive: boolean;
  /** Reports my own VAD/mic state every second (page throttles DB writes). */
  onSelfActivity: (speaking: boolean, micMuted: boolean) => void;
  /** Asks the server-authoritative RPC to close the room for inactivity. */
  onRequestClose: () => void;
  /** Host-only: persists LiveKit's connected count to the room row. */
  onReportViewerCount: (count: number) => void;
  onLeaveStage: () => void;
  onToggleChat: () => void;
  onToggleNotes: () => void;
  chatOpen: boolean;
  notesOpen: boolean;
}

export default function DebateVideo({
  token,
  serverUrl,
  isDebater,
  hostId,
  currentUserId,
  proDebater,
  conDebater,
  spectators,
  timeLimitSeconds,
  myHandRaisedAt,
  onToggleHand,
  roomLive,
  onSelfActivity,
  onRequestClose,
  onReportViewerCount,
  onLeaveStage,
  onToggleChat,
  onToggleNotes,
  chatOpen,
  notesOpen,
}: Props) {
  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      video={isDebater}
      audio={isDebater}
      className="stage-body"
      data-lk-theme="default"
    >
      <DebateStage
        proDebater={proDebater}
        conDebater={conDebater}
        hostId={hostId}
        currentUserId={currentUserId}
        isDebater={isDebater}
        spectators={spectators}
        timeLimitSeconds={timeLimitSeconds}
        myHandRaisedAt={myHandRaisedAt}
        onToggleHand={onToggleHand}
        roomLive={roomLive}
        onSelfActivity={onSelfActivity}
        onRequestClose={onRequestClose}
        onReportViewerCount={onReportViewerCount}
        onLeaveStage={onLeaveStage}
        onToggleChat={onToggleChat}
        onToggleNotes={onToggleNotes}
        chatOpen={chatOpen}
        notesOpen={notesOpen}
      />
    </LiveKitRoom>
  );
}

const AVATAR_COLORS = [
  "av-c1", "av-c2", "av-c3", "av-c4", "av-c5",
  "av-c6", "av-c7", "av-c8", "av-c9", "av-c10",
];

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  const parts = name.split(/[\s_-]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function formatTime(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

// ─── Data channel message shape ───────────────────────────
type DataMsg =
  | { type: "turn"; turn: "PRO" | "CON"; startedAt: number }
  | { type: "reset" }
  | { type: "hand"; userId: string; raised: boolean }
  | { type: "stateRequest" }
  | { type: "stateSync"; turn: "PRO" | "CON" | null; startedAt: number | null; raisedHands: string[] };

function DebateStage({
  proDebater,
  conDebater,
  hostId,
  currentUserId,
  isDebater,
  spectators,
  timeLimitSeconds,
  myHandRaisedAt,
  onToggleHand,
  roomLive,
  onSelfActivity,
  onRequestClose,
  onReportViewerCount,
  onLeaveStage,
  onToggleChat,
  onToggleNotes,
  chatOpen,
  notesOpen,
}: {
  proDebater?: ParticipantWithUser;
  conDebater?: ParticipantWithUser;
  hostId: string;
  currentUserId: string;
  isDebater: boolean;
  spectators: ParticipantWithUser[];
  timeLimitSeconds: number | null;
  myHandRaisedAt: string | null;
  onToggleHand: () => void;
  roomLive: boolean;
  onSelfActivity: (speaking: boolean, micMuted: boolean) => void;
  onRequestClose: () => void;
  onReportViewerCount: (count: number) => void;
  onLeaveStage: () => void;
  onToggleChat: () => void;
  onToggleNotes: () => void;
  chatOpen: boolean;
  notesOpen: boolean;
}) {
  const room = useRoomContext();
  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.Microphone],
    { onlySubscribed: false }
  );
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  // ─── Shared debate state (synced via LiveKit data channel) ───────
  const hasTimer = !!(timeLimitSeconds && timeLimitSeconds > 0);
  const bothPresent = !!(proDebater && conDebater);
  const isHost = currentUserId === hostId;

  const [currentTurn, setCurrentTurn] = useState<"PRO" | "CON" | null>(null);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(timeLimitSeconds ?? 0);
  const [toast, setToast] = useState<string>("");

  // Latest state refs — so handlers called from LiveKit events see up-to-date values
  const currentTurnRef = useRef<"PRO" | "CON" | null>(null);
  const turnStartedAtRef = useRef<number | null>(null);

  // Track bothPresent transitions & the turn that was active when someone left.
  // When both are present again, the OPPOSITE side goes first with a fresh timer.
  const prevBothPresentRef = useRef(false);
  const lastInterruptedTurnRef = useRef<"PRO" | "CON" | null>(null);

  useEffect(() => { currentTurnRef.current = currentTurn; }, [currentTurn]);
  useEffect(() => { turnStartedAtRef.current = turnStartedAt; }, [turnStartedAt]);

  const myStance: "PRO" | "CON" | null =
    proDebater?.user_id === currentUserId ? "PRO" :
    conDebater?.user_id === currentUserId ? "CON" : null;
  const isMyTurn = !!myStance && myStance === currentTurn;

  // ─── Data channel helpers ────────────────────────────────────────
  const broadcast = useCallback((msg: DataMsg) => {
    if (!room || !room.localParticipant) return;
    try {
      const payload = new TextEncoder().encode(JSON.stringify(msg));
      room.localParticipant.publishData(payload, { reliable: true });
    } catch {
      /* swallow — will be retried by caller if needed */
    }
  }, [room]);

  const showToast = useCallback((text: string, duration = 3000) => {
    setToast(text);
    setTimeout(() => setToast(""), duration);
  }, []);

  // Listen for incoming data messages
  useEffect(() => {
    if (!room) return;
    const handler = (payload: Uint8Array) => {
      let data: DataMsg;
      try { data = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }

      if (data.type === "turn") {
        const prev = currentTurnRef.current;
        setCurrentTurn(data.turn);
        setTurnStartedAt(data.startedAt);
        if (prev && prev !== data.turn) {
          showToast(`${data.turn}'s turn`);
        } else if (!prev) {
          showToast(`${data.turn}'s turn`);
        }
      } else if (data.type === "reset") {
        setCurrentTurn(null);
        setTurnStartedAt(null);
      } else if (data.type === "hand") {
        // Legacy message from older clients — hands are DB-backed now; ignore.
      } else if (data.type === "stateRequest") {
        // Only host replies, to avoid duplicate responses
        if (isHost) {
          broadcast({
            type: "stateSync",
            turn: currentTurnRef.current,
            startedAt: turnStartedAtRef.current,
            raisedHands: [],
          });
        }
      } else if (data.type === "stateSync") {
        // Only apply if we don't already have state (late joiner case)
        if (!currentTurnRef.current) {
          if (data.turn) setCurrentTurn(data.turn);
          if (data.startedAt) setTurnStartedAt(data.startedAt);
        }
      }
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room, isHost, broadcast, showToast]);

  // Late-joiners: request current state on connect
  useEffect(() => {
    if (!room || isHost) return;
    const t = setTimeout(() => {
      if (!currentTurnRef.current) broadcast({ type: "stateRequest" });
    }, 800);
    return () => clearTimeout(t);
  }, [room, isHost, broadcast]);

  // Detect when both-present flips false (a debater left) — clear the live timer.
  // Remember the turn that was active so the opposite side can go first on restart.
  useEffect(() => {
    const wasBoth = prevBothPresentRef.current;
    prevBothPresentRef.current = bothPresent;
    if (wasBoth && !bothPresent) {
      if (currentTurnRef.current) {
        lastInterruptedTurnRef.current = currentTurnRef.current;
      }
      setCurrentTurn(null);
      setTurnStartedAt(null);
      if (isHost) broadcast({ type: "reset" });
    }
  }, [bothPresent, isHost, broadcast]);

  // Host starts the timer when both debaters are present and no turn is active.
  // On a fresh start PRO goes first. On restart-after-leave the OPPOSITE of the
  // interrupted turn goes first (e.g. CON left during CON's turn → PRO starts).
  useEffect(() => {
    if (!isHost || !hasTimer || !bothPresent || currentTurn) return;

    let firstTurn: "PRO" | "CON" = "PRO";
    if (lastInterruptedTurnRef.current) {
      firstTurn = lastInterruptedTurnRef.current === "PRO" ? "CON" : "PRO";
      lastInterruptedTurnRef.current = null;
    }

    const now = Date.now();
    setCurrentTurn(firstTurn);
    setTurnStartedAt(now);
    showToast(`${firstTurn}'s turn`);
    broadcast({ type: "turn", turn: firstTurn, startedAt: now });
  }, [isHost, hasTimer, bothPresent, currentTurn, broadcast, showToast]);

  // Tick: compute timeLeft from turnStartedAt every 250ms (all clients, so timers match)
  useEffect(() => {
    if (!hasTimer || !turnStartedAt || !timeLimitSeconds) return;
    const update = () => {
      const elapsed = (Date.now() - turnStartedAt) / 1000;
      const remaining = Math.max(0, timeLimitSeconds - elapsed);
      setTimeLeft(remaining);
    };
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [hasTimer, turnStartedAt, timeLimitSeconds]);

  // Host: detect time expiry and broadcast turn switch
  useEffect(() => {
    if (!isHost || !hasTimer || !currentTurn || !turnStartedAt || !timeLimitSeconds) return;
    if (timeLeft > 0) return;

    const nextTurn: "PRO" | "CON" = currentTurn === "PRO" ? "CON" : "PRO";
    const now = Date.now();
    const prevTurn = currentTurn;
    setCurrentTurn(nextTurn);
    setTurnStartedAt(now);
    showToast(`${prevTurn}'s time is up — ${nextTurn}'s turn`);
    broadcast({ type: "turn", turn: nextTurn, startedAt: now });
  }, [timeLeft, isHost, hasTimer, currentTurn, turnStartedAt, timeLimitSeconds, broadcast, showToast]);

  // Auto-mute / auto-unmute based on whose turn it is (local debater only)
  useEffect(() => {
    if (!isDebater || !myStance || !hasTimer || !currentTurn || !localParticipant) return;
    if (currentTurn === myStance) {
      localParticipant.setMicrophoneEnabled(true).catch(() => {});
    } else {
      localParticipant.setMicrophoneEnabled(false).catch(() => {});
    }
  }, [currentTurn, myStance, isDebater, hasTimer, localParticipant]);

  // ─── Derived track refs for each stance ──────────────────────────
  const videoTracks = tracks.filter((t) => t.source === Track.Source.Camera);
  const audioTracks = tracks.filter(
    (t) => t.source === Track.Source.Microphone && t.publication.kind === "audio"
  );

  const proTrack = videoTracks.find((t) => t.participant.identity === proDebater?.user_id);
  const conTrack = videoTracks.find((t) => t.participant.identity === conDebater?.user_id);

  const isMicOn = localParticipant?.isMicrophoneEnabled ?? false;
  const isCamOn = localParticipant?.isCameraEnabled ?? false;

  // Determine camera-off for each debater (works for both local and remote)
  const proCameraOff = computeCameraOff(proDebater, proTrack, currentUserId, isCamOn);
  const conCameraOff = computeCameraOff(conDebater, conTrack, currentUserId, isCamOn);

  async function toggleMic() {
    // Block unmuting when it's not your turn
    if (hasTimer && bothPresent && currentTurn && myStance && currentTurn !== myStance && !isMicOn) {
      showToast("🚫 Not your turn to speak", 2000);
      return;
    }
    await localParticipant?.setMicrophoneEnabled(!isMicOn);
  }

  async function toggleCam() {
    await localParticipant?.setCameraEnabled(!isCamOn);
  }

  function endMyTurn() {
    if (!isMyTurn || !currentTurn) return;
    const nextTurn: "PRO" | "CON" = currentTurn === "PRO" ? "CON" : "PRO";
    const now = Date.now();
    setCurrentTurn(nextTurn);
    setTurnStartedAt(now);
    showToast(`${nextTurn}'s turn`);
    broadcast({ type: "turn", turn: nextTurn, startedAt: now });
  }

  // ── Raise-hand queue (DB-backed, ordered oldest-raise-first) ──────
  const myHandRaised = !!myHandRaisedAt;

  // Only show audience members who are actually connected to the room right
  // now — if someone closes the tab, their hand disappears for everyone.
  const connectedIds = new Set(participants.map((p) => p.identity));
  const visibleSpectators = spectators.filter(
    (s) => connectedIds.has(s.user_id) || s.user_id === currentUserId
  );
  const raisedQueue = visibleSpectators.filter((s) => !!s.hand_raised_at);

  // Minute ticker so "waiting 3m" labels stay fresh without realtime events.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    if (raisedQueue.length === 0) return;
    const t = setInterval(() => setClockTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [raisedQueue.length]);

  // FLIP: animate audience avatars sliding to their new positions when the
  // queue reorders, instead of snapping.
  const audienceRef = useFlipList();

  // Host reports the real connected count (LiveKit's participant list is the
  // server's truth: dead sockets are dropped, duplicate identities replaced).
  // Debounced 2s to coalesce join/leave bursts; only written when changed.
  const lastReportedViewersRef = useRef(-1);
  useEffect(() => {
    if (!isHost) return;
    const count = uniqueViewerCount(participants.map((p) => p.identity));
    if (count === lastReportedViewersRef.current) return;
    const t = setTimeout(() => {
      lastReportedViewersRef.current = count;
      onReportViewerCount(count);
    }, 2000);
    return () => clearTimeout(t);
  }, [participants, isHost, onReportViewerCount]);

  /* ── Voice-activity & connection monitoring ────────────────────────
     A 1-second local loop reads LiveKit's server-side VAD
     (participant.isSpeaking) and connection state for both debaters.
     It drives the presence dots, the inactivity countdown, and the
     reconnect window — and asks the page to request an authoritative
     close when a rule trips. */
  const [presence, setPresence] = useState<{ pro: TilePresence; con: TilePresence }>({
    pro: "silent",
    con: "silent",
  });
  const [inactivityDeadline, setInactivityDeadline] = useState<number | null>(null);
  const [reconnect, setReconnect] = useState<{ stance: "PRO" | "CON"; deadline: number } | null>(null);

  const lastSpeechRef = useRef(Date.now());
  const absentSinceRef = useRef<{ pro: number | null; con: number | null }>({ pro: null, con: null });

  const proId = proDebater?.user_id;
  const conId = conDebater?.user_id;

  // Fresh silence clock whenever the pairing (re)forms or the room goes live.
  useEffect(() => {
    lastSpeechRef.current = Date.now();
    absentSinceRef.current = { pro: null, con: null };
  }, [proId, conId, roomLive]);

  // Cancel the countdown the instant LiveKit's VAD reports debater speech —
  // no waiting for the next 1s tick.
  useEffect(() => {
    if (!room) return;
    const onSpeakers = (speakers: Participant[]) => {
      if (speakers.some((s) => s.identity === proId || s.identity === conId)) {
        lastSpeechRef.current = Date.now();
        setInactivityDeadline(null);
      }
    };
    room.on(RoomEvent.ActiveSpeakersChanged, onSpeakers);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, onSpeakers);
    };
  }, [room, proId, conId]);

  useEffect(() => {
    if (!room || !roomLive) {
      setInactivityDeadline(null);
      setReconnect(null);
      return;
    }
    const iv = setInterval(() => {
      const now = Date.now();
      const findLk = (uid?: string): Participant | undefined => {
        if (!uid) return undefined;
        if (room.localParticipant?.identity === uid) return room.localParticipant;
        for (const p of room.remoteParticipants.values()) {
          if (p.identity === uid) return p;
        }
        return undefined;
      };
      const proLk = findLk(proId);
      const conLk = findLk(conId);

      if (proLk?.isSpeaking || conLk?.isSpeaking) lastSpeechRef.current = now;

      // Report my own VAD/mic state — the page throttles the DB writes.
      const me = room.localParticipant;
      if (me && isDebater) onSelfActivity(!!me.isSpeaking, !me.isMicrophoneEnabled);

      const tilePresence = (seated: boolean, lk?: Participant): TilePresence =>
        !seated || !lk ? "disconnected" : lk.isSpeaking ? "speaking" : "silent";
      setPresence({
        pro: tilePresence(!!proId, proLk),
        con: tilePresence(!!conId, conLk),
      });

      // Seat has a DB debater but no LiveKit connection → they dropped.
      const a = absentSinceRef.current;
      a.pro = proId && !proLk ? (a.pro ?? now) : null;
      a.con = conId && !conLk ? (a.con ?? now) : null;

      let deadline: number | null = null;
      let rec: { stance: "PRO" | "CON"; deadline: number } | null = null;

      if (proId && conId) {
        if (a.pro !== null && a.con !== null) {
          // Both debaters gone — close (10s grace for blips).
          if (now - Math.max(a.pro, a.con) > 10_000) onRequestClose();
        } else if (a.pro !== null || a.con !== null) {
          // One side dropped — 2-minute reconnect window.
          const since = (a.pro ?? a.con)!;
          rec = { stance: a.pro !== null ? "PRO" : "CON", deadline: since + 120_000 };
          if (now - since > 120_000) onRequestClose();
        } else {
          // Both connected — shared silence clock.
          const silence = now - lastSpeechRef.current;
          if (silence > 90_000) onRequestClose();
          else if (silence > 60_000) deadline = lastSpeechRef.current + 90_000;
        }
      }
      setInactivityDeadline(deadline);
      setReconnect(rec);
    }, 1000);
    return () => clearInterval(iv);
  }, [room, roomLive, proId, conId, isDebater, onSelfActivity, onRequestClose]);

  function promptLeave() { setShowLeaveModal(true); }
  function confirmLeave() { setShowLeaveModal(false); onLeaveStage(); }

  const timerIsLow = hasTimer && bothPresent && timeLeft <= 10 && timeLeft > 0;

  return (
    <>
      {/* Toast (turn changes, "not your turn" messages, etc.) */}
      {toast && <div className="turn-message-toast">{toast}</div>}

      {/* Inactivity countdown — cancelled the instant anyone speaks */}
      {roomLive && inactivityDeadline && !reconnect && (
        <div className="inactivity-banner">
          <span className="inactivity-dot" />
          No activity detected. This debate will end in{" "}
          <strong>{Math.max(0, Math.ceil((inactivityDeadline - Date.now()) / 1000))}s</strong>
          &nbsp;— say something to keep it going.
        </div>
      )}

      {/* Reconnect window when one debater drops */}
      {roomLive && reconnect && (
        <div className="inactivity-banner is-reconnect">
          <span className="inactivity-dot" />
          {reconnect.stance} debater disconnected — waiting{" "}
          <strong>{formatTime(Math.max(0, (reconnect.deadline - Date.now()) / 1000))}</strong>
          &nbsp;for them to reconnect.
        </div>
      )}

      {/* Shared floor timer — same values on every client */}
      {hasTimer && bothPresent && currentTurn && (
        <div className="floor-timer-bar">
          <div className={`floor-timer-turn turn-${currentTurn.toLowerCase()}`}>
            {currentTurn}&apos;s Turn
          </div>
          <div className={`floor-timer-time${timerIsLow ? " is-low" : ""}`}>
            {formatTime(timeLeft)}
          </div>
          {isDebater && isMyTurn && (
            <button className="end-turn-btn" onClick={endMyTurn}>
              End Turn
            </button>
          )}
        </div>
      )}

      {/* Host: raised-hand queue in priority order (longest wait first) */}
      {isHost && raisedQueue.length > 0 && (
        <div className="hand-queue-strip">
          <span className="hand-queue-label">✋ Raised ({raisedQueue.length})</span>
          {raisedQueue.map((s, i) => (
            <span key={s.id} className="hand-queue-chip">
              <span className="hand-queue-pos">#{i + 1}</span>
              {s.user?.username || "Spectator"}
              <span className="hand-queue-wait">{waitingLabel(s.hand_raised_at!)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Content row: speaker tiles */}
      <div className="content-row">
        <div className="speakers-grid">
          <SpeakerTile
            debater={proDebater}
            track={proTrack}
            stance="PRO"
            hostId={hostId}
            currentUserId={currentUserId}
            isMicOn={proDebater?.user_id === currentUserId ? isMicOn : true}
            cameraOff={proCameraOff}
            isActiveTurn={hasTimer && bothPresent && currentTurn === "PRO"}
            handRaised={!!proDebater?.hand_raised_at}
            presence={presence.pro}
          />
          <SpeakerTile
            debater={conDebater}
            track={conTrack}
            stance="CON"
            hostId={hostId}
            currentUserId={currentUserId}
            isMicOn={conDebater?.user_id === currentUserId ? isMicOn : true}
            cameraOff={conCameraOff}
            isActiveTurn={hasTimer && bothPresent && currentTurn === "CON"}
            handRaised={!!conDebater?.hand_raised_at}
            presence={presence.con}
          />
        </div>
      </div>

      {/* Audience bar — pinned above the controls, raised hands first */}
      <div className="audience-grid" ref={audienceRef}>
        <span className="audience-bar-label">
          Audience ({visibleSpectators.length})
        </span>
        {visibleSpectators.map((s) => (
          <div
            key={s.id}
            data-flip-key={s.id}
            className={`audience-avatar-wrap${s.hand_raised_at ? " is-raised" : ""}`}
            title={
              s.hand_raised_at
                ? `${s.user?.username || "Spectator"} — hand raised ${waitingLabel(s.hand_raised_at)}`
                : s.user?.username || "Spectator"
            }
          >
            <div className={`audience-avatar ${hashColor(s.user?.username || "")}`}>
              {getInitials(s.user?.username || "?")}
            </div>
            {s.hand_raised_at && <span className="audience-hand-badge">✋</span>}
          </div>
        ))}
        {participants.length > visibleSpectators.length + 2 && (
          <div className="audience-more">
            +{participants.length - visibleSpectators.length - 2}
          </div>
        )}
      </div>

      {/* Hidden audio */}
      {audioTracks.map((t) => (
        <AudioTrack key={t.participant.sid} trackRef={t} />
      ))}

      {/* Controls row */}
      <div className="controls-row">
        {isDebater && (
          <>
            <button
              className={`ctrl-btn ${isMicOn ? "state-on" : "state-off"}`}
              onClick={toggleMic}
              title={isMicOn ? "Mute" : "Unmute"}
            >
              <svg viewBox="0 0 24 24">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="9" y1="22" x2="15" y2="22" />
                {!isMicOn && <line x1="2" y1="2" x2="22" y2="22" />}
              </svg>
            </button>

            <button
              className={`ctrl-btn ${isCamOn ? "state-on" : "state-off"}`}
              onClick={toggleCam}
              title={isCamOn ? "Camera Off" : "Camera On"}
            >
              <svg viewBox="0 0 24 24">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" />
                {!isCamOn && <line x1="2" y1="2" x2="22" y2="22" />}
              </svg>
            </button>

          </>
        )}

        {/* Raise hand — everyone, spectators especially. Stays raised until
            the user explicitly lowers it. */}
        <button
          className={`ctrl-btn btn-hand ${myHandRaised ? "state-hand" : ""}`}
          onClick={onToggleHand}
          title={myHandRaised ? "Lower your hand" : "Raise your hand"}
          aria-pressed={myHandRaised}
        >
          ✋
          <span className="hand-btn-label">
            {myHandRaised ? "Lower hand" : "Raise hand"}
          </span>
        </button>

        <button
          className={`ctrl-btn ${notesOpen ? "state-notes-open" : ""}`}
          onClick={onToggleNotes}
          title={notesOpen ? "Close Notes" : "Debate Notes"}
        >
          <svg viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </button>

        <button
          className={`ctrl-btn ${chatOpen ? "state-chat-open" : ""}`}
          onClick={onToggleChat}
          title={chatOpen ? "Close Chat" : "Live Chat"}
        >
          <svg viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        <button className="ctrl-btn btn-leave" onClick={promptLeave} title="Leave Stage">
          <svg viewBox="0 0 24 24">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07C9.44 16.29 7.62 14.9 6.06 13.06a19.5 19.5 0 0 1-3-8.59A2 2 0 0 1 4.77 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
            <line x1="22" y1="2" x2="2" y2="22" />
          </svg>
        </button>
      </div>

      {showLeaveModal && (
        <div
          className="leave-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowLeaveModal(false); }}
        >
          <div className="leave-modal-box">
            <div className="leave-modal-title">
              {currentUserId === hostId ? "End Debate?" : "Leave Stage?"}
            </div>
            <div className="leave-modal-body">
              {currentUserId === hostId
                ? "You're the host — leaving will end the debate for everyone."
                : "Are you sure you want to leave? You'll be redirected to the home page."}
            </div>
            <div className="leave-modal-actions">
              <button className="modal-btn modal-btn-cancel" onClick={() => setShowLeaveModal(false)}>
                Cancel
              </button>
              <button className="modal-btn modal-btn-leave" onClick={confirmLeave}>
                {currentUserId === hostId ? "End Debate" : "Leave Stage"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** How long a hand has been up: "just now", "45s", "3m", "1h 12m". */
function waitingLabel(raisedAt: string): string {
  const secs = Math.floor((Date.now() - new Date(raisedAt).getTime()) / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * FLIP animation for a list container: when children with data-flip-key
 * change position between renders, slide them from their old spot to the
 * new one instead of snapping.
 */
function useFlipList() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const positions = useRef<Map<string, { left: number; top: number }>>(new Map());

  useLayoutEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const next = new Map<string, { left: number; top: number }>();
    for (const child of Array.from(c.children)) {
      const el = child as HTMLElement;
      const key = el.dataset.flipKey;
      if (!key) continue;
      const rect = el.getBoundingClientRect();
      next.set(key, { left: rect.left, top: rect.top });
      const prev = positions.current.get(key);
      if (prev && (prev.left !== rect.left || prev.top !== rect.top)) {
        const dx = prev.left - rect.left;
        const dy = prev.top - rect.top;
        el.style.transition = "none";
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
          el.style.transform = "";
        });
      }
    }
    positions.current = next;
  });

  return containerRef;
}

// Decide whether a debater's camera should be treated as off
function computeCameraOff(
  debater: ParticipantWithUser | undefined,
  track: TrackReference | undefined,
  currentUserId: string,
  localIsCamOn: boolean
): boolean {
  if (!debater) return false;
  if (debater.user_id === currentUserId) return !localIsCamOn;
  // Remote: no track = not publishing OR unpublished → treat as off.
  // Track present with isMuted = camera off.
  if (!track) return true;
  return track.publication?.isMuted === true;
}

function SpeakerTile({
  debater,
  track,
  stance,
  hostId,
  currentUserId,
  isMicOn,
  cameraOff,
  isActiveTurn,
  handRaised,
  presence,
}: {
  debater?: ParticipantWithUser;
  track?: TrackReference;
  stance: "PRO" | "CON";
  hostId: string;
  currentUserId: string;
  isMicOn: boolean;
  cameraOff: boolean;
  isActiveTurn: boolean;
  handRaised: boolean;
  presence: TilePresence;
}) {
  const isHost = debater?.user_id === hostId;
  const isLocal = debater?.user_id === currentUserId;
  const washClass = stance === "PRO" ? "wash-green" : "wash-red";
  const stanceClass = stance === "PRO" ? "stance-pro" : "stance-con";
  const username = debater?.user?.username || "";

  // Render video only if track exists AND publication is not muted
  const showVideo = !!track && track.publication?.isMuted !== true;

  const isSpeaking = !!debater && presence === "speaking";
  const isDisconnected = !!debater && presence === "disconnected";

  return (
    <div
      className={`speaker-tile${isLocal ? " is-local" : ""}${isActiveTurn ? " is-active-turn" : ""}${isSpeaking ? " speaking" : ""}`}
    >
      <div className={`tile-wash ${washClass}`} />
      <div className="tile-grid" />
      <div className={`tile-stance ${stanceClass}`}>{stance}</div>

      {isHost && <div className="tile-crown">👑</div>}

      {/* Raised-hand badge — visible to everyone */}
      {handRaised && debater && (
        <div className="tile-hand-raised" aria-label="Hand raised">
          ✋
        </div>
      )}

      {/* Video or placeholder */}
      {showVideo ? (
        <div className="tile-video-container">
          <VideoTrack trackRef={track!} />
        </div>
      ) : (
        <div className="tile-placeholder">
          <div className="tile-initials">
            {debater ? getInitials(username) : "?"}
          </div>
          {debater && cameraOff && (
            <div className="tile-cam-off-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
              Camera off
            </div>
          )}
        </div>
      )}

      <div className="tile-footer">
        <div className="tile-info">
          <span className="tile-name">
            {debater ? username : `Waiting for ${stance}...`}
            {isLocal && <span className="tile-you">You</span>}
          </span>
          <span className="tile-role">
            {debater && <span className={`presence-dot presence-${presence}`} />}
            {!debater
              ? "Empty"
              : isDisconnected
                ? "Disconnected"
                : isSpeaking
                  ? "Speaking"
                  : isHost
                    ? "Host · silent"
                    : "Silent"}
          </span>
        </div>
        {debater && !isMicOn && (
          <div className="tile-mic off">
            <svg
              viewBox="0 0 24 24"
              style={{ width: 11, height: 11 }}
              fill="none"
              stroke="rgba(255,110,110,0.95)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
