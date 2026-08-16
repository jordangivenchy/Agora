"use client";

/* The amphitheater's live-call layer, on the same LiveKit room the classic
   debate stage uses. One hook owns the whole lifecycle:

     • connect everyone who enters (on-stage roles publish; audience and
       signed-out guests get subscribe-only tokens — the token API enforces
       that server-side, so a tampered client still can't broadcast)
     • play remote speakers' audio through hidden <audio> elements
     • expose real mic/camera toggles for the control bar
     • surface live camera tracks for the video dock
     • track active speakers so the stage rings show who is ACTUALLY talking
     • carry emoji reactions over the data channel

   Publish rights follow the stage model: when a listener is promoted (or a
   speaker demoted) the hook reconnects with a re-scoped token. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";

export interface Reaction {
  id: number;
  emoji: string;
  username: string;
}

export interface VideoTile {
  identity: string;
  username: string;
  track: Track;
  local: boolean;
}

interface Options {
  roomId: string;
  /** Signed-in user id, or null — guests get a throwaway identity. */
  userId: string | null;
  username: string;
  /** True for host / cohost / speaker: request a publishing token. */
  canPublish: boolean;
  /** Gate connection until the page has loaded the room. */
  ready: boolean;
}

type DataMsg = { t: "reaction"; e: string; u: string };

let reactionSeq = 1;

export function useAgoraCall({ roomId, userId, username, canPublish, ready }: Options) {
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  /** Human-readable reason the last mic/camera toggle failed (toast fodder). */
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [videoTiles, setVideoTiles] = useState<VideoTile[]>([]);

  const roomRef = useRef<Room | null>(null);
  /* One guest identity per mount, so reconnects don't multiply "viewers". */
  const guestIdRef = useRef(`guest-${Math.random().toString(36).slice(2, 10)}`);
  /* Display name only — read through a ref so it settling (Guest → real
     username as data loads) never tears down and rebuilds the call. */
  const usernameRef = useRef(username);
  usernameRef.current = username;

  const pushReaction = useCallback((emoji: string, who: string) => {
    const id = reactionSeq++;
    setReactions((prev) => [...prev.slice(-30), { id, emoji, username: who }]);
    // Reactions are ephemeral: drop each one after its float animation.
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 3200);
  }, []);

  /* Rebuild the video-dock tiles from the room's current camera tracks. */
  const refreshTiles = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setVideoTiles([]);
      return;
    }
    const tiles: VideoTile[] = [];
    const localCam = room.localParticipant
      .getTrackPublications()
      .find((p) => p.source === Track.Source.Camera && p.track && !p.isMuted);
    if (localCam?.track) {
      tiles.push({
        identity: room.localParticipant.identity,
        username: room.localParticipant.name || "You",
        track: localCam.track,
        local: true,
      });
    }
    room.remoteParticipants.forEach((rp) => {
      rp.getTrackPublications().forEach((pub) => {
        if (pub.source === Track.Source.Camera && pub.track && !pub.isMuted) {
          tiles.push({
            identity: rp.identity,
            username: rp.name || rp.identity,
            track: pub.track,
            local: false,
          });
        }
      });
    });
    setVideoTiles(tiles);
  }, []);

  useEffect(() => {
    if (!ready || !roomId) return;

    const identity = userId ?? guestIdRef.current;
    const room = new Room();
    roomRef.current = room;
    let cancelled = false;
    const audioEls: HTMLMediaElement[] = [];

    const attachAudio = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      el.style.display = "none";
      document.body.appendChild(el);
      audioEls.push(el);
    };

    (async () => {
      try {
        const res = await fetch("/api/livekit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            userId: identity,
            username: usernameRef.current,
            /* The token API grants publish only to "debater"; guests are
               forced subscribe-only server-side regardless. */
            role: canPublish ? "debater" : "spectator",
          }),
        });
        if (!res.ok) throw new Error(`livekit token ${res.status}`);
        const { token } = await res.json();
        if (!token || cancelled) return;

        room
          .on(RoomEvent.TrackSubscribed, (track) => {
            attachAudio(track);
            refreshTiles();
          })
          .on(RoomEvent.TrackUnsubscribed, (track) => {
            track.detach().forEach((el) => el.remove());
            refreshTiles();
          })
          .on(RoomEvent.LocalTrackPublished, refreshTiles)
          .on(RoomEvent.LocalTrackUnpublished, refreshTiles)
          .on(RoomEvent.TrackMuted, refreshTiles)
          .on(RoomEvent.TrackUnmuted, refreshTiles)
          .on(RoomEvent.ParticipantDisconnected, refreshTiles)
          .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
            setSpeakingIds(new Set(speakers.map((s) => s.identity)));
          })
          .on(RoomEvent.DataReceived, (payload) => {
            try {
              const msg = JSON.parse(new TextDecoder().decode(payload)) as DataMsg;
              if (msg.t === "reaction" && typeof msg.e === "string") {
                pushReaction(msg.e.slice(0, 8), String(msg.u ?? "").slice(0, 40));
              }
            } catch {
              /* forwarded garbage — ignore */
            }
          })
          .on(RoomEvent.ConnectionStateChanged, (s) => {
            setConnected(s === ConnectionState.Connected);
          });

        await room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL!, token);
        if (cancelled) {
          room.disconnect();
          return;
        }
        setConnected(true);
        refreshTiles();

        /* Browsers block autoplaying audio until a gesture — resume on the
           first interaction so listeners actually hear the stage. */
        const resume = () => {
          room.startAudio().catch(() => {});
          document.removeEventListener("pointerdown", resume);
        };
        document.addEventListener("pointerdown", resume);
      } catch (e) {
        console.warn("agora call connect failed", e);
      }
    })();

    return () => {
      cancelled = true;
      audioEls.forEach((el) => el.remove());
      room.disconnect();
      roomRef.current = null;
      setConnected(false);
      setMicOn(false);
      setCamOn(false);
      setSpeakingIds(new Set());
      setVideoTiles([]);
    };
  }, [ready, roomId, userId, canPublish, pushReaction, refreshTiles]);

  /* Turn a getUserMedia / publish failure into something a user can act on.
     Swallowing these (the old behavior) made the buttons look dead. */
  const explainMediaError = (kind: "microphone" | "camera", e: unknown): string => {
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    if (name === "NotAllowedError" || /permission/i.test(msg))
      return `${kind === "camera" ? "Camera" : "Mic"} access is blocked — click the camera icon in your browser's address bar (or System Settings on macOS) and allow it, then try again.`;
    if (name === "NotFoundError" || /requested device not found/i.test(msg))
      return `No ${kind} found on this device.`;
    if (name === "NotReadableError" || /could not start|in use/i.test(msg))
      return `Your ${kind} is in use by another app — close it and try again.`;
    if (/insufficient permissions|not allowed to publish/i.test(msg))
      return "You don't have publish rights in this room — rejoining the stage should fix it.";
    return `Could not start the ${kind}: ${msg || "unknown error"}`;
  };

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room || mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      const next = !micOn;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch (e) {
      console.warn("mic toggle failed", e);
      setMediaError(explainMediaError("microphone", e));
    } finally {
      setMediaBusy(false);
    }
  }, [micOn, mediaBusy]);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    if (!room || mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      const next = !camOn;
      await room.localParticipant.setCameraEnabled(next);
      setCamOn(next);
      refreshTiles();
    } catch (e) {
      console.warn("camera toggle failed", e);
      setMediaError(explainMediaError("camera", e));
    } finally {
      setMediaBusy(false);
    }
  }, [camOn, mediaBusy, refreshTiles]);

  const sendReaction = useCallback(
    (emoji: string) => {
      const room = roomRef.current;
      pushReaction(emoji, username); // show my own instantly
      if (!room || room.state !== ConnectionState.Connected) return;
      const msg: DataMsg = { t: "reaction", e: emoji, u: username };
      room.localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: false })
        .catch(() => {});
    },
    [pushReaction, username]
  );

  return {
    connected,
    micOn,
    camOn,
    mediaBusy,
    mediaError,
    clearMediaError: () => setMediaError(null),
    toggleMic,
    toggleCam,
    sendReaction,
    reactions,
    speakingIds,
    videoTiles,
  };
}
