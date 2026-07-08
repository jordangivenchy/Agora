"use client";

import { useEffect, useState, useCallback, useMemo, useRef, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { TOPICS } from "@/types/database";
import type { DebateRoom, DebateParticipant, Stance, QueueEntry } from "@/types/database";
import DebateVideo from "@/components/DebateVideo";
import SentimentBar from "@/components/SidePickerPanel";
import ChatPanel from "@/components/ChatPanel";
import NotesPopout from "@/components/NotesPanel";
import type { User } from "@supabase/supabase-js";

type ParticipantWithUser = DebateParticipant & {
  user: { username: string; avatar_url: string | null };
};

type QueueWithUser = QueueEntry & {
  user: { username: string; avatar_url: string | null };
};

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: roomId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const cameFromInvite = searchParams?.get("via") === "invite";
  const wantsSpectate = searchParams?.get("spectate") === "1";
  const supabase = createClient();

  // Auto-join-as-spectator flow (?spectate=1 from a room card). Holds the
  // loading gate closed until the join completes so the join screen never
  // flashes between navigation and entering the room.
  const [autoSpectate, setAutoSpectate] = useState<"pending" | "joining" | "done">(
    wantsSpectate ? "pending" : "done"
  );

  const [room, setRoom] = useState<DebateRoom | null>(null);
  const [participants, setParticipants] = useState<ParticipantWithUser[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueWithUser[]>([]);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [isLeaving, setIsLeaving] = useState(false);
  const [userLoaded, setUserLoaded] = useState(false);
  const [participantsLoaded, setParticipantsLoaded] = useState(false);
  const [queueSearch, setQueueSearch] = useState("");

  // Panel state
  const [chatOpen, setChatOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  // Derive my participation directly from the participants array — single source of truth
  const myParticipation = useMemo(() => {
    if (!currentUser) return null;
    return participants.find((p) => p.user_id === currentUser.id) ?? null;
  }, [currentUser, participants]);

  // My waiting queue row, if any (non-host debaters go through the queue).
  const myQueueEntry = useMemo(() => {
    if (!currentUser) return null;
    return queue.find((q) => q.user_id === currentUser.id) ?? null;
  }, [currentUser, queue]);

  // 1-based position in the waiting queue, sorted by entered_at.
  const myQueuePosition = useMemo(() => {
    if (!myQueueEntry) return null;
    const idx = queue.findIndex((q) => q.id === myQueueEntry.id);
    return idx < 0 ? null : idx + 1;
  }, [myQueueEntry, queue]);

  const fetchRoom = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("debate_rooms")
        .select("*")
        .eq("id", roomId)
        .maybeSingle();

      // RLS will return no row (and no error) when the caller isn't allowed to see
      // a fully-private room. Treat that as "not found" and bounce home.
      if (error || !data) {
        setIsLeaving(true);
        router.replace("/");
        return;
      }

      setRoom(data);
      if (data.status === "ended") {
        setIsLeaving(true);
        router.push("/");
      }
    } catch (e) {
      console.error("fetchRoom failed", e);
      setError("Could not load room. Please refresh.");
    }
  }, [roomId, router]);

  const fetchParticipants = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("debate_participants")
        .select("*, user:users(username, avatar_url)")
        .eq("room_id", roomId)
        .is("left_at", null);
      if (data) setParticipants(data as ParticipantWithUser[]);
    } catch (e) {
      console.error("fetchParticipants failed", e);
    } finally {
      // Always flip the flag so the page's render gate can resolve, even if
      // the query blew up — otherwise we'd be stuck on the spinner forever.
      setParticipantsLoaded(true);
    }
  }, [roomId]);

  const fetchQueue = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("debate_queue")
        .select("*, user:users(username, avatar_url)")
        .eq("room_id", roomId)
        .eq("status", "waiting")
        .order("entered_at", { ascending: true });
      if (data) setQueue(data as QueueWithUser[]);
    } catch (e) {
      console.error("fetchQueue failed", e);
    }
  }, [roomId]);

  // Initial load — guarantee `userLoaded` flips to true even if getUser rejects,
  // so the render gate doesn't hang forever on a network/auth hiccup.
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUser(user);
      } catch (e) {
        console.error("getUser failed", e);
      } finally {
        setUserLoaded(true);
      }
    })();
    fetchRoom();
    fetchParticipants();
    fetchQueue();
  }, [fetchRoom, fetchParticipants, fetchQueue]);

  // Fetch LiveKit token whenever myParticipation is established
  useEffect(() => {
    if (!myParticipation || !currentUser || livekitToken) return;
    getLiveKitToken(myParticipation.role);
  }, [myParticipation, currentUser, livekitToken]);

  /* ── Private-room access control ──────────────────────────────
     - Private + no spectators: user must have come via invite code OR already be a participant.
       Otherwise bounce to home.
     - Private + spectators allowed: if visitor is not the host and not already in the room,
       force them in as a spectator (they can never become a debater without the invite code). */
  useEffect(() => {
    if (!room || !userLoaded || !participantsLoaded) return;
    if (!room.is_private) return;
    if (!currentUser) return;                  // unauthenticated — render will block with a message
    if (currentUser.id === room.host_id) return;
    if (myParticipation) return;               // already in

    if (!room.allow_spectators && !cameFromInvite) {
      setIsLeaving(true);
      router.replace("/");
      return;
    }

    if (room.allow_spectators && !cameFromInvite) {
      // Auto-enroll as a spectator; no queue option will be shown.
      upsertParticipation("spectator", null).then(() => {
        fetchParticipants();
      });
    }
  }, [
    room, userLoaded, participantsLoaded, currentUser,
    myParticipation, cameFromInvite, router,
  ]);

  /* ── Auto-spectate (?spectate=1) ──────────────────────────────
     Coming from a "Join as Spectator" card: enroll directly as a spectator
     without showing the join screen. Private rooms are excluded — the
     private-room effect above already handles their spectator flow. */
  useEffect(() => {
    if (autoSpectate !== "pending") return;
    if (!room || !userLoaded || !participantsLoaded) return;

    // Signed out, already in the room, or private room → nothing to auto-do.
    if (!currentUser || myParticipation || room.is_private) {
      setAutoSpectate("done");
      return;
    }

    setAutoSpectate("joining");
    upsertParticipation("spectator", null)
      .then(() => fetchParticipants())
      .catch((e) => {
        console.error("auto-spectate failed", e);
        setError("Could not join as spectator. Please try again.");
      })
      .finally(() => setAutoSpectate("done"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSpectate, room, userLoaded, participantsLoaded, currentUser, myParticipation]);

  // Real-time subscriptions
  useEffect(() => {
    const channel = supabase
      .channel(`room-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_rooms", filter: `id=eq.${roomId}` }, (payload) => {
        if (payload.new && (payload.new as DebateRoom).status === "ended") {
          setIsLeaving(true);
          router.push("/");
          return;
        }
        fetchRoom();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_participants", filter: `room_id=eq.${roomId}` }, () => {
        fetchParticipants();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_queue", filter: `room_id=eq.${roomId}` }, () => {
        fetchQueue();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [roomId, fetchRoom, fetchParticipants, fetchQueue, router]);

  async function getLiveKitToken(role: string) {
    if (!currentUser) return;
    try {
      const { data: profile } = await supabase.from("users").select("username").eq("id", currentUser.id).single();

      const res = await fetch("/api/livekit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          userId: currentUser.id,
          username: profile?.username || currentUser.email?.split("@")[0],
          role,
        }),
      });

      if (!res.ok) throw new Error(`livekit ${res.status}`);
      const data = await res.json();
      if (data.token) setLivekitToken(data.token);
      else throw new Error("no token in response");
    } catch (e) {
      // Don't leave the render gate spinning forever — surface the error so
      // the user sees a message and a Leave button instead of a dead spinner.
      console.error("getLiveKitToken failed", e);
      setError("Could not connect to video. Please refresh or leave the room.");
    }
  }

  async function joinRoom(role: "debater" | "spectator", stance?: Stance) {
    if (!currentUser) {
      setError("You must be signed in to join");
      return;
    }

    // Once a debate is live, only the host may (re)take a debater seat.
    // Everyone else joins as a spectator so the debate isn't interrupted.
    if (role === "debater" && room?.status === "live" && currentUser.id !== room.host_id) {
      setError("This debate is already live — you can join as a spectator.");
      return;
    }

    setJoining(true);
    setError("");

    try {
      // Spectators bypass the queue entirely.
      if (role === "spectator") {
        await upsertParticipation("spectator", null);
        fetchParticipants();
        return;
      }

      // Debaters: host direct-inserts (they're pre-seated on room creation and
      // don't need their own approval). Everyone else is queued.
      if (role === "debater" && stance && room) {
        const isHostJoining = currentUser.id === room.host_id;

        if (isHostJoining) {
          // Host can flip stance or resume their stance directly.
          const hostCurrent = participants.find(
            (p) => p.user_id === room.host_id && p.role === "debater" && !p.left_at,
          );
          if (hostCurrent && hostCurrent.stance !== stance) {
            // Host switching stance — only allowed if the opposite slot isn't
            // already taken by a different active debater.
            const blocker = participants.find(
              (p) =>
                p.role === "debater" &&
                p.stance === stance &&
                !p.left_at &&
                p.user_id !== currentUser.id,
            );
            if (blocker) {
              setError(`The ${stance} slot is already taken.`);
              return;
            }
          }
          await upsertParticipation("debater", stance);
          fetchParticipants();
          return;
        }

        // Non-host debaters → queue. Dedupe prior waiting rows first.
        const { data: existingQueueEntry } = await supabase
          .from("debate_queue")
          .select("id, stance")
          .eq("room_id", roomId)
          .eq("user_id", currentUser.id)
          .eq("status", "waiting")
          .maybeSingle();

        if (existingQueueEntry) {
          if (existingQueueEntry.stance === stance) {
            setError("You're already in the queue for this stance.");
            return;
          }
          // Switching stance while still waiting: cancel the old row, enqueue a new one.
          await supabase
            .from("debate_queue")
            .update({ status: "cancelled" })
            .eq("id", existingQueueEntry.id);
        }

        await supabase.from("debate_queue").insert({
          room_id: roomId,
          user_id: currentUser.id,
          stance,
          status: "waiting",
        });

        // Enroll as spectator so they can watch while they wait.
        await upsertParticipation("spectator", null);
        fetchQueue();
        fetchParticipants();
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to join room";
      setError(message);
    } finally {
      setJoining(false);
    }
  }

  // Insert OR update existing participation row (fixes rejoin after leaving)
  async function upsertParticipation(role: "debater" | "spectator", stance: Stance | null) {
    if (!currentUser) return;

    // Is there an existing row (active or left)?
    const { data: existing } = await supabase
      .from("debate_participants")
      .select("id")
      .eq("room_id", roomId)
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (existing) {
      const { error: updateErr } = await supabase
        .from("debate_participants")
        .update({
          role,
          stance,
          left_at: null,
          joined_at: new Date().toISOString(),
          // Fresh session, fresh hand — a rejoin/reconnect never carries a
          // stale queue position.
          hand_raised_at: null,
        })
        .eq("id", existing.id);
      if (updateErr) throw updateErr;
    } else {
      const { error: insertErr } = await supabase
        .from("debate_participants")
        .insert({ room_id: roomId, user_id: currentUser.id, role, stance });
      if (insertErr) throw insertErr;
    }
  }

  /* ── Activity heartbeat + authoritative inactivity close ──────────
     DebateVideo's 1s monitoring loop calls reportSelfActivity with my
     LiveKit VAD state. Writes are throttled (~15s heartbeat, ~10s while
     speaking) so realtime traffic stays light no matter how long the
     debate runs. requestInactiveClose asks the close_inactive_room RPC
     to end the room — the RPC re-validates the DB timestamps itself,
     so a client can only *suggest* closure, never force it. */
  const selfActivityRef = useRef({ lastBeat: 0, lastSpokeWrite: 0, lastMuted: null as boolean | null });
  const reportSelfActivity = useCallback(
    async (speaking: boolean, micMuted: boolean) => {
      if (!currentUser || !myParticipation || myParticipation.role !== "debater") return;
      const now = Date.now();
      const s = selfActivityRef.current;
      const needBeat = now - s.lastBeat > 15_000 || s.lastMuted !== micMuted;
      const needSpeak = speaking && now - s.lastSpokeWrite > 10_000;
      if (!needBeat && !needSpeak) return;
      s.lastBeat = now;
      s.lastMuted = micMuted;
      if (speaking) s.lastSpokeWrite = now;

      const patch: Record<string, unknown> = {
        last_seen_at: new Date().toISOString(),
        mic_muted: micMuted,
      };
      if (speaking) patch.last_spoke_at = new Date().toISOString();
      const { error: hbErr } = await supabase
        .from("debate_participants")
        .update(patch)
        .eq("id", myParticipation.id);
      if (hbErr) console.warn("activity heartbeat failed", hbErr);
    },
    [currentUser, myParticipation, supabase]
  );

  // Host-only: persist LiveKit's real connected count so room cards show
  // live viewer numbers. RLS ("Hosts can update their rooms") means only
  // the host's client can write it — other clients can't fake counts.
  const reportViewerCount = useCallback(
    async (count: number) => {
      if (!currentUser || !room || currentUser.id !== room.host_id) return;
      const { error: vcErr } = await supabase
        .from("debate_rooms")
        .update({ viewer_count: count })
        .eq("id", roomId);
      if (vcErr) console.warn("viewer_count update failed", vcErr);
    },
    [currentUser, room, roomId, supabase]
  );

  const closeAttemptRef = useRef(0);
  const requestInactiveClose = useCallback(async () => {
    const now = Date.now();
    if (now - closeAttemptRef.current < 10_000) return; // retry at most every 10s
    closeAttemptRef.current = now;
    const { data, error: closeErr } = await supabase.rpc("close_inactive_room", {
      p_room: roomId,
    });
    if (closeErr) console.warn("close_inactive_room failed", closeErr);
    // If it closed, the rooms realtime subscription redirects everyone home.
    else if (data) fetchRoom();
  }, [roomId, supabase, fetchRoom]);

  // Toggle my raised hand. Optimistic local flip for instant feedback; the
  // DB write follows and the realtime subscription reconciles every client.
  async function toggleHand() {
    if (!currentUser || !myParticipation) return;
    const raising = !myParticipation.hand_raised_at;
    const ts = raising ? new Date().toISOString() : null;

    setParticipants((prev) =>
      prev.map((p) => (p.id === myParticipation.id ? { ...p, hand_raised_at: ts } : p))
    );

    const { error: updErr } = await supabase
      .from("debate_participants")
      .update({ hand_raised_at: ts })
      .eq("id", myParticipation.id);
    if (updErr) {
      console.error("toggleHand failed", updErr);
      fetchParticipants(); // roll back the optimistic flip
    }
  }

  async function leaveStage() {
    if (!currentUser || !myParticipation) return;

    // Host leaving ends the debate
    if (currentUser.id === room?.host_id) {
      await endRoom();
      return;
    }

    setIsLeaving(true);

    await supabase
      .from("debate_participants")
      .update({ left_at: new Date().toISOString(), hand_raised_at: null })
      .eq("id", myParticipation.id);

    await supabase
      .from("debate_queue")
      .delete()
      .eq("room_id", roomId)
      .eq("user_id", currentUser.id);

    router.push("/");
  }

  async function endRoom() {
    setIsLeaving(true);
    await supabase
      .from("debate_rooms")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", roomId);
    router.push("/");
  }

  async function startRoom() {
    if (!currentUser || currentUser.id !== room?.host_id) return;
    await supabase
      .from("debate_rooms")
      .update({
        status: "live",
        started_at: new Date().toISOString(),
      })
      .eq("id", roomId);
    // Realtime subscription picks up the change; optimistic setRoom keeps UI snappy.
    setRoom((r) =>
      r ? { ...r, status: "live", started_at: new Date().toISOString() } : r
    );
  }

  async function approveFromQueue(entry: QueueWithUser) {
    if (!currentUser || currentUser.id !== room?.host_id) return;

    const { error: rpcErr } = await supabase.rpc("approve_queue_entry", { p_entry: entry.id });
    if (rpcErr) {
      const msg = rpcErr.message || "";
      if (msg.includes("pro_slot_full") || msg.includes("con_slot_full")) {
        setError(`The ${entry.stance} slot is already full.`);
      } else {
        setError("Could not approve — " + msg);
      }
      return;
    }

    fetchParticipants();
    fetchQueue();
  }

  async function declineFromQueue(entry: QueueWithUser) {
    if (!currentUser || currentUser.id !== room?.host_id) return;
    const { error: rpcErr } = await supabase.rpc("decline_queue_entry", { p_entry: entry.id });
    if (rpcErr) {
      setError("Could not decline — " + (rpcErr.message || ""));
      return;
    }
    fetchQueue();
  }

  // ── Unified loading state ─────────────────────────────────
  // We show the spinner until we know *everything* needed to render correctly:
  //   - room is loaded
  //   - auth is resolved
  //   - participants are loaded (so we know if user is in room)
  //   - if they ARE in the room, until the livekit token arrives
  // This prevents the join-screen flash on room creation / rejoining.
  const isInRoom = !!myParticipation;
  const ready =
    !!room &&
    userLoaded &&
    participantsLoaded &&
    autoSpectate === "done" &&
    (!isInRoom || !!livekitToken);

  // If something blew up before we became `ready`, surface the error with a
  // visible escape hatch instead of spinning forever. The normal in-flight
  // case still renders the spinner.
  if (!ready && error && !isLeaving) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "#0a0a0a",
          padding: 24,
          textAlign: "center",
        }}
      >
        <p style={{ color: "var(--text-primary)", fontSize: 15, maxWidth: 420 }}>{error}</p>
        <button
          onClick={() => router.replace("/")}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            background: "var(--accent-purple)",
            color: "white",
            border: "none",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Leave room
        </button>
      </div>
    );
  }

  if (isLeaving || !ready) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          background: "var(--bg-primary)",
        }}
      >
        <div
          className="animate-spin"
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "2px solid var(--accent-blue)",
            borderTopColor: "transparent",
          }}
        />
        {wantsSpectate && !isLeaving && (
          <span
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text-muted)",
              animation: "fadeSlideIn 0.3s ease",
            }}
          >
            Joining as spectator…
          </span>
        )}
      </div>
    );
  }

  const topic = TOPICS.find((t) => t.key === room!.topic_key);
  const debaters = participants.filter((p) => p.role === "debater");
  // Audience queue: raised hands first (oldest raise first — fairest), then
  // everyone else in join order.
  const spectators = participants
    .filter((p) => p.role === "spectator")
    .sort((a, b) => {
      if (a.hand_raised_at && b.hand_raised_at)
        return a.hand_raised_at.localeCompare(b.hand_raised_at);
      if (a.hand_raised_at) return -1;
      if (b.hand_raised_at) return 1;
      return (a.joined_at || "").localeCompare(b.joined_at || "");
    });
  const proDebater = debaters.find((d) => d.stance === "PRO");
  const conDebater = debaters.find((d) => d.stance === "CON");
  const isHost = currentUser?.id === room!.host_id;

  // Slot-fullness (used to disable host Approve on full sides).
  const proCount = debaters.filter((d) => d.stance === "PRO").length;
  const conCount = debaters.filter((d) => d.stance === "CON").length;
  const proFull = proCount >= (room!.pro_size ?? 1);
  const conFull = conCount >= (room!.con_size ?? 1);

  // Stances still available for new debaters
  const takenStances = debaters.map((d) => d.stance);
  const availableStances = (["PRO", "CON"] as Stance[]).filter((s) => !takenStances.includes(s));

  const filteredQueue = queue.filter((entry) =>
    queueSearch.trim() === "" ||
    (entry.user?.username || "").toLowerCase().includes(queueSearch.trim().toLowerCase())
  );

  const isScheduled =
    room!.status === "created" &&
    !!room!.scheduled_start &&
    new Date(room!.scheduled_start).getTime() > Date.now();

  const scheduledLabel = (() => {
    if (!room!.scheduled_start) return "";
    const d = new Date(room!.scheduled_start);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (sameDay) return `Today · ${time}`;
    const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return `${dateStr} · ${time}`;
  })();

  return (
    <div className="stage-shell">
      <div className="stage-container">
        {/* Header — back arrow removed; leave via disconnect button */}
        <div className="stage-header">
          <h1 className="stage-title">{room!.motion}</h1>
          <div className="stage-meta">
            {room!.status === "live" && <span className="live-badge-stage">LIVE</span>}
            {isScheduled && (
              <span
                style={{
                  background: "rgba(226,185,107,0.15)",
                  color: "#e2b96b",
                  border: "1px solid rgba(226,185,107,0.4)",
                  fontFamily: "'Syne', sans-serif",
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "3px 10px",
                  borderRadius: 999,
                }}
              >
                📅 Scheduled
              </span>
            )}
            <div className="dot" />
            <span>{participants.length} Listening</span>
            {topic && (
              <>
                <div className="dot" />
                <span>{topic.emoji} {topic.label}</span>
              </>
            )}
          </div>

          {/* Scheduled banner */}
          {isScheduled && (
            <div
              style={{
                marginTop: 12,
                padding: "12px 16px",
                borderRadius: 12,
                background: "rgba(226,185,107,0.06)",
                border: "1px solid rgba(226,185,107,0.25)",
                color: "#e2b96b",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>
                <strong style={{ fontWeight: 700 }}>Scheduled for {scheduledLabel}.</strong>
                {" "}
                {isHost
                  ? "Start the debate whenever you're ready — it'll go live for everyone."
                  : "The host will start the debate at the scheduled time."}
              </span>
              {isHost && (
                <button
                  onClick={startRoom}
                  className="cursor-pointer transition-all"
                  style={{
                    padding: "8px 16px",
                    borderRadius: 10,
                    background:
                      "linear-gradient(135deg, rgba(34,197,94,0.2) 0%, rgba(34,197,94,0.08) 100%)",
                    border: "1px solid rgba(34,197,94,0.45)",
                    color: "#22c55e",
                    fontFamily: "'Syne', sans-serif",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  ▶ Start Debate
                </button>
              )}
            </div>
          )}

          {/* Host controls for not-yet-live, not-scheduled rooms (waiting room) */}
          {isHost && room!.status === "created" && !isScheduled && (
            <button
              className="end-debate-btn"
              onClick={startRoom}
              style={{
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.2) 0%, rgba(34,197,94,0.08) 100%)",
                border: "1px solid rgba(34,197,94,0.45)",
                color: "#22c55e",
              }}
            >
              ▶ Start Debate
            </button>
          )}

          {isHost && room!.status === "live" && (
            <button className="end-debate-btn" onClick={endRoom}>
              End Debate
            </button>
          )}
        </div>

        {/* Sentiment bar */}
        <SentimentBar roomId={roomId} currentUser={currentUser} />

        {/* Queue position banner (non-host, waiting in queue) */}
        {!isHost && myQueueEntry && (myParticipation?.role !== "debater") && (
          <div
            style={{
              margin: "10px 0",
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(226,185,107,0.08)",
              border: "1px solid rgba(226,185,107,0.3)",
              color: "#e2b96b",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 12.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>
              ⏳ Waiting for host to approve you as{" "}
              <strong style={{ fontWeight: 700 }}>{myQueueEntry.stance}</strong>
              {myQueuePosition ? (
                <>
                  {" "}— you&apos;re <strong style={{ fontWeight: 700 }}>#{myQueuePosition}</strong> in line.
                </>
              ) : "…"}
            </span>
            <button
              onClick={async () => {
                if (!currentUser) return;
                await supabase
                  .from("debate_queue")
                  .update({ status: "cancelled" })
                  .eq("id", myQueueEntry.id);
                fetchQueue();
              }}
              className="cursor-pointer"
              style={{
                padding: "4px 10px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.14)",
                color: "rgba(255,255,255,0.78)",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Leave queue
            </button>
          </div>
        )}

        {/* Queue strip (host only) */}
        {isHost && queue.length > 0 && (
          <div
            className="queue-strip"
            style={{
              overflowX: "auto",
              flexWrap: "nowrap",
              whiteSpace: "nowrap",
            }}
          >
            <span className="queue-label">Queue ({queue.length})</span>

            {queue.length > 3 && (
              <input
                type="text"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Search..."
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "6px",
                  color: "rgba(238,238,245,0.8)",
                  fontSize: "10px",
                  padding: "2px 8px",
                  outline: "none",
                  width: "90px",
                  fontFamily: "'DM Sans', sans-serif",
                  flexShrink: 0,
                }}
              />
            )}

            {filteredQueue.map((entry) => {
              const slotFull = entry.stance === "PRO" ? proFull : conFull;
              return (
                <div key={entry.id} className="queue-entry" style={{ flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: "11px",
                      color: entry.stance === "PRO" ? "#23a559" : "#ed4245",
                      fontWeight: 600,
                    }}
                  >
                    {entry.user?.username || "User"} · {entry.stance}
                  </span>
                  <button
                    className="queue-approve-btn"
                    onClick={() => approveFromQueue(entry)}
                    disabled={slotFull}
                    title={slotFull ? `${entry.stance} slot full` : "Approve"}
                    style={slotFull ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => declineFromQueue(entry)}
                    className="cursor-pointer"
                    style={{
                      padding: "3px 8px",
                      marginLeft: 6,
                      borderRadius: 6,
                      background: "rgba(232,64,64,0.1)",
                      border: "1px solid rgba(232,64,64,0.4)",
                      color: "#e84040",
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                    }}
                    aria-label="Decline"
                    title="Decline"
                  >
                    Decline
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Stage body — video or join screen */}
        {isInRoom && livekitToken ? (
          <DebateVideo
            token={livekitToken}
            serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL!}
            isDebater={myParticipation?.role === "debater"}
            hostId={room!.host_id}
            currentUserId={currentUser?.id || ""}
            proDebater={proDebater}
            conDebater={conDebater}
            spectators={spectators}
            timeLimitSeconds={room!.time_limit_seconds}
            roomLive={room!.status === "live"}
            myHandRaisedAt={myParticipation?.hand_raised_at ?? null}
            onToggleHand={toggleHand}
            onSelfActivity={reportSelfActivity}
            onRequestClose={requestInactiveClose}
            onReportViewerCount={reportViewerCount}
            onLeaveStage={leaveStage}
            onToggleChat={() => setChatOpen(!chatOpen)}
            onToggleNotes={() => setNotesOpen(!notesOpen)}
            chatOpen={chatOpen}
            notesOpen={notesOpen}
          />
        ) : (
          <div className="join-screen">
            <h2 className="join-title">{room!.motion}</h2>
            <p className="join-meta">
              {topic?.emoji} {topic?.label} · {room!.language === "en" ? "English" : room!.language}
            </p>

            {error && <div className="join-error">{error}</div>}

            {!currentUser ? (
              <p style={{ fontSize: "12px", color: "rgba(238,238,245,0.25)" }}>
                Sign in to join this debate
              </p>
            ) : room!.status === "live" && !isHost ? (
              /* Debate in progress — spectator-only entry */
              <>
                <div
                  className="flex items-center gap-2"
                  style={{
                    padding: "8px 16px",
                    borderRadius: 100,
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    animation: "fadeSlideIn 0.25s ease",
                  }}
                >
                  <span
                    className="rounded-full animate-[pulse-live_1.5s_ease-in-out_infinite]"
                    style={{ width: 6, height: 6, background: "#ef4444" }}
                  />
                  <span
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#fca5a5",
                    }}
                  >
                    Debate in progress — join as a spectator
                  </span>
                </div>

                <button
                  disabled={joining}
                  onClick={() => joinRoom("spectator")}
                  className="flex items-center gap-2 cursor-pointer transition-all disabled:opacity-60"
                  style={{
                    padding: "12px 26px",
                    borderRadius: 100,
                    background: "var(--accent-blue)",
                    border: "none",
                    color: "#fff",
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                  onMouseEnter={(e) => {
                    if (!joining)
                      e.currentTarget.style.background = "var(--accent-purple-light)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--accent-blue)";
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  {joining ? "Joining…" : "Join as Spectator"}
                </button>
              </>
            ) : (
              <>
                {availableStances.length > 0 && (
                  <div className="join-buttons">
                    {availableStances.map((s) => (
                      <button
                        key={s}
                        className={`join-btn join-btn-${s.toLowerCase()}`}
                        disabled={joining}
                        onClick={() => joinRoom("debater", s)}
                      >
                        <span
                          className="join-btn-label"
                          style={{ color: s === "PRO" ? "#23a559" : "#ed4245" }}
                        >
                          {s}
                        </span>
                        <span className="join-btn-sub">Join</span>
                      </button>
                    ))}
                  </div>
                )}

                {availableStances.length === 0 && (
                  <p
                    style={{
                      fontSize: "10px",
                      color: "rgba(238,238,245,0.25)",
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    Both slots full — joining as spectator adds you to queue
                  </p>
                )}

                <button
                  className="join-spectator-btn"
                  disabled={joining}
                  onClick={() => joinRoom("spectator")}
                >
                  Watch as Spectator
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <ChatPanel
        roomId={roomId}
        currentUser={currentUser}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
      />

      <NotesPopout
        isOpen={notesOpen}
        onClose={() => setNotesOpen(false)}
        roomId={roomId}
        userId={currentUser?.id}
      />
    </div>
  );
}
