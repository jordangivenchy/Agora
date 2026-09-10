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
import { logRoomEvent, noteRoomAction } from "@/lib/roomDiag";
import {
  ConnectionState,
  DisconnectReason,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  VideoQuality,
} from "livekit-client";

/* iOS unlocks audio without LiveKit's startAudio(). LiveKit's iOS path
   builds a silent MediaStream track out of a Web Audio oscillator and
   plays it beside the call; on iOS 18.7 / Safari 26 that kills the tab
   the moment it is played inside a gesture (the room telemetry showed
   the crash right after the "tap to listen" prompt, or after the first
   touch anywhere, which is the same unlock). A plain silent <audio>
   element played in the gesture unlocks the audio session just as well,
   with no Web Audio at all. */
const IOS_TOUCH =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

let silentWav: string | null = null;
function silentWavUrl(): string {
  if (silentWav) return silentWav;
  const rate = 8000, samples = 800; // 0.1s of 16-bit mono silence
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples * 2, true);
  silentWav = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  return silentWav;
}

/* Disconnects that are a verdict, not an accident — no automatic reconnect. */
const NO_RECONNECT = new Set<DisconnectReason>([
  DisconnectReason.CLIENT_INITIATED,
  DisconnectReason.DUPLICATE_IDENTITY,
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.ROOM_DELETED,
  DisconnectReason.ROOM_CLOSED,
  DisconnectReason.JOIN_FAILURE,
  DisconnectReason.USER_REJECTED,
  DisconnectReason.USER_UNAVAILABLE,
]);

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
  /** Camera feed or a shared screen. Screens are routed to the cast stage
      and must never land on a holo panel, so the two are distinguished at
      the source rather than guessed at downstream. */
  source: "camera" | "screen";
}

/** Stable React key for a tile. Identity alone collides the moment someone
    shares a screen while their camera is on — they are two tiles from one
    participant — so the source is part of the key. */
export function tileKey(t: VideoTile) {
  return `${t.identity}:${t.local ? "l" : "r"}:${t.source}`;
}

interface Options {
  roomId: string;
  /** Signed-in user id, or null — guests get a throwaway identity. */
  userId: string | null;
  username: string;
  /** True for host / cohost / speaker: request a publishing token. */
  canPublish: boolean;
  /** Viewer is in the close-up speaker view — pull full-res video.
      In the distant audience view the medium layer is indistinguishable. */
  highQuality?: boolean;
  /** Gate connection until the page has loaded the room. */
  ready: boolean;
  /** Egress compositor mode: connect with the recorder token LiveKit put in
      the page URL instead of minting our own (hidden, subscribe-only — and
      it doesn't need the beta cookie our token API sits behind). */
  external?: { serverUrl: string; token: string } | null;
}

type DataMsg = { t: "reaction"; e: string; u: string };

let reactionSeq = 1;

export function useAgoraCall({ roomId, userId, username, canPublish, ready, highQuality = false, external = null }: Options) {
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [activeMicId, setActiveMicId] = useState<string | null>(null);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [outputVolume, setOutputVolumeState] = useState(1);
  const outputVolumeRef = useRef(1);
  /** Human-readable reason the last mic/camera toggle failed (toast fodder). */
  const [mediaError, setMediaError] = useState<string | null>(null);
  /* Browser refused audio autoplay — the UI shows a tap-to-listen prompt. */
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  /* Audience overflow: the token API answered "watch the broadcast"
     instead of minting a token — no WebRTC connection exists; the page
     renders the HLS stream on the stage surface instead. Cleared the
     moment a later request (promotion, egress death) yields a token. */
  const [hlsMode, setHlsMode] = useState<{ url: string; viewerCount?: number } | null>(null);
  /* Bumping this re-runs the connect effect — the page uses it to
     escape HLS mode when the stream dies (hls_url goes null). */
  const [connectNonce, setConnectNonce] = useState(0);
  /* A drop that was not ours (screen locked, app backgrounded, a blip
     that outlasted LiveKit's own reconnect window). The visibility
     handler below reconnects on return; the page re-takes its seat. */
  const droppedRef = useRef(false);
  const everConnectedRef = useRef(false);
  const retriesRef = useRef(0);
  const [reconnects, setReconnects] = useState(0);
  const [lastDropAt, setLastDropAt] = useState<number | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [videoTiles, setVideoTiles] = useState<VideoTile[]>([]);
  const hqRef = useRef(highQuality);
  hqRef.current = highQuality;

  /* Switching views retunes already-subscribed video layers. */
  useEffect(() => {
    const room = roomRef.current;
    if (!room || canPublish) return;
    const q = highQuality ? VideoQuality.HIGH : VideoQuality.MEDIUM;
    room.remoteParticipants.forEach((p) => {
      p.videoTrackPublications.forEach((pub) => {
        if (pub.isSubscribed) pub.setVideoQuality(q);
      });
    });
  }, [highQuality, canPublish]);

  const roomRef = useRef<Room | null>(null);

  const unlockRef = useRef<() => void>(() => {});
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

  /* Rebuild the tile list from every live video track in the room.

     Two bugs lived here and both made screen sharing invisible:

     1. Remote publications were filtered to Track.Source.Camera, so a
        screen share published by anyone else reached the wire and was then
        dropped on the floor — every viewer saw nothing. Sharing only ever
        appeared to work because the sharer saw their own local track.
     2. The local side used .find() across Camera *or* ScreenShare, which
        returns exactly one. Sharing with your camera already on silently
        replaced your face with your screen instead of yielding both.

     Both are fixed by treating the two sources as peers and collecting
     every matching publication rather than the first. */
  const refreshTiles = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setVideoTiles([]);
      return;
    }
    const tiles: VideoTile[] = [];

    const sourceOf = (s: Track.Source): VideoTile["source"] | null =>
      s === Track.Source.Camera ? "camera" : s === Track.Source.ScreenShare ? "screen" : null;

    const collect = (
      pubs: { source: Track.Source; track?: Track | null; isMuted: boolean }[],
      identity: string,
      username: string,
      local: boolean
    ) => {
      pubs.forEach((pub) => {
        const source = sourceOf(pub.source);
        /* A muted *screen* publication is still worth showing: LiveKit
           reports isMuted on a screen track that is merely paused, and
           dropping it would blank the cast stage mid-share. Cameras keep
           the muted check — a muted camera is one that is off. */
        if (!source || !pub.track) return;
        if (source === "camera" && pub.isMuted) return;
        tiles.push({ identity, username, track: pub.track, local, source });
      });
    };

    collect(
      room.localParticipant.getTrackPublications(),
      room.localParticipant.identity,
      room.localParticipant.name || "You",
      true
    );
    room.remoteParticipants.forEach((rp) => {
      collect(rp.getTrackPublications(), rp.identity, rp.name || rp.identity, false);
    });

    setVideoTiles(tiles);
  }, []);

  useEffect(() => {
    if (!ready || !roomId) return;

    const identity = userId ?? guestIdRef.current;
    /* Cost controls: dynacast stops the publisher encoding simulcast
       layers nobody is subscribed to; capture capped at 720p; audience
       subscribers cap themselves at the medium layer below — together
       these keep per-viewer bandwidth a fraction of full-res. */
    /* Phones: 540p, one H.264 encode (the hardware path on iOS) instead
       of three VP8 software simulcast layers — a Safari tab publishing
       three encoders next to the call's decodes is what tips it over. */
    const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
    const room = new Room({
      dynacast: true,
      /* Remote video is decoded at the size it is shown, not the size it
         is sent — on a phone with several tiles that is the difference
         between a call and a tab crash. */
      adaptiveStream: true,
      videoCaptureDefaults: { resolution: (phone ? VideoPresets.h360 : VideoPresets.h720).resolution },
      publishDefaults: phone ? { simulcast: false, videoCodec: "h264" } : { simulcast: true },
    });
    roomRef.current = room;
    let cancelled = false;
    const audioEls: HTMLMediaElement[] = [];
    const recovering = everConnectedRef.current;

    /* Browsers block autoplaying audio until a gesture, and iOS counts
       only real activation events (touchend / click / keydown — not a
       pointerdown alone). Listen for all of them, unlock once, and re-arm
       whenever playback reports blocked again (a reconnect, a locked
       screen). The UI shows a tap-to-listen prompt while blocked. */
    const gestures = ["pointerdown", "touchend", "click", "keydown"] as const;
    let armed = false;
    function disarm() {
      armed = false;
      gestures.forEach((g) => document.removeEventListener(g, unlock));
    }
    async function unlock() {
      disarm();
      if (!IOS_TOUCH) {
        room.startAudio().catch(() => {});
        return;
      }
      try {
        const el = document.createElement("audio");
        el.setAttribute("playsinline", "");
        el.src = silentWavUrl();
        el.volume = 0.01;
        await el.play();
        setTimeout(() => { el.pause(); el.remove(); }, 400);
      } catch {
        /* the gesture may not count; the remote elements below decide */
      }
      let blocked = false;
      for (const el of audioEls) {
        el.muted = false;
        try { await el.play(); } catch { blocked = true; }
      }
      setAudioBlocked(blocked);
      if (blocked) arm();
    }
    unlockRef.current = () => { void unlock(); };
    function arm() {
      if (armed) return;
      armed = true;
      gestures.forEach((g) => document.addEventListener(g, unlock, { passive: true }));
    }
    function watchPlayback() {
      setAudioBlocked(!room.canPlaybackAudio);
      if (!room.canPlaybackAudio) arm();
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        setAudioBlocked(!room.canPlaybackAudio);
        if (!room.canPlaybackAudio) arm();
      });
      if (!IOS_TOUCH) room.startAudio().catch(() => {});
    }

    const attachAudio = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      el.style.display = "none";
      el.volume = outputVolumeRef.current;
      document.body.appendChild(el);
      audioEls.push(el);
    };

    (async () => {
      try {
        /* Track/data handlers are wired BEFORE either connect path. The
           egress compositor used to skip these entirely (its branch
           connected and returned early), so the recorder never attached
           audio elements and only showed whichever video tracks happened
           to be subscribed at the moment of its single refresh — i.e.
           recordings with one missing camera and NO audio. */
        room
          .on(RoomEvent.TrackSubscribed, (track, publication) => {
            /* Audience members render video on the distant holo screens or
               small dock tiles — the 360p simulcast layer is all they can
               see. On-stage participants (and the recorder, which runs
               with highQuality) keep full quality. */
            if (!canPublish && track.kind === Track.Kind.Video) {
              (publication as RemoteTrackPublication).setVideoQuality(
                hqRef.current ? VideoQuality.HIGH : VideoQuality.MEDIUM
              );
            }
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
            if (s === ConnectionState.Connected) {
              retriesRef.current = 0;
              if (everConnectedRef.current && recovering) setReconnects((n) => n + 1);
              everConnectedRef.current = true;
            }
          })
          .on(RoomEvent.Disconnected, (reason) => {
            /* Ours, or the server's verdict (removed, room closed, a second
               tab took our identity): stay down. Anything else is a lost
               connection — iOS cuts the page's sockets the moment the
               screen locks — so remember it for the return handler and,
               if we're still on screen, come straight back. */
            if (cancelled) return;
            logRoomEvent(roomId, "disconnected", reason === undefined ? "unknown" : DisconnectReason[reason] ?? String(reason), {
              retries: retriesRef.current, everConnected: everConnectedRef.current,
            });
            if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
              setMediaError("This room is open on another device or tab — the call moved there.");
              return;
            }
            if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
              setMediaError("You were removed from the call.");
              return;
            }
            if (reason !== undefined && NO_RECONNECT.has(reason)) return;
            droppedRef.current = true;
            setLastDropAt(Date.now());
            if (document.visibilityState === "visible" && retriesRef.current < 5) {
              retriesRef.current += 1;
              setTimeout(() => {
                if (!cancelled && droppedRef.current) {
                  droppedRef.current = false;
                  setConnectNonce((n) => n + 1);
                }
              }, 1500);
            }
          });

        if (external) {
          await room.connect(external.serverUrl, external.token);
          if (cancelled) {
            room.disconnect();
            return;
          }
          setConnected(true);
          refreshTiles();
          watchPlayback();
          return;
        }
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
        if (!res.ok) {
          logRoomEvent(roomId, "token_fail", `http ${res.status}`, { canPublish });
          throw new Error(`livekit token ${res.status}`);
        }
        const body = await res.json();
        if (cancelled) return;
        if (body.mode === "hls" && typeof body.url === "string") {
          /* The room is over the audience ceiling: watch the broadcast
             instead of connecting. The effect's cleanup still runs (the
             Room was never connected — disconnect is a no-op). */
          setHlsMode({ url: body.url, viewerCount: body.viewerCount });
          return;
        }
        const { token } = body;
        if (!token) return;
        setHlsMode(null);

        await room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL!, token);
        if (cancelled) {
          room.disconnect();
          return;
        }
        setConnected(true);
        logRoomEvent(roomId, "connected", null, { canPublish, nonce: connectNonce, recovering });
        refreshTiles();

        watchPlayback();
      } catch (e) {
        console.warn("agora call connect failed", e);
        logRoomEvent(roomId, "connect_fail", e instanceof Error ? e.message : String(e), { canPublish, nonce: connectNonce });
        setMediaError("Couldn't connect to the live call — reload to retry.");
      }
    })();

    return () => {
      cancelled = true;
      if (everConnectedRef.current) logRoomEvent(roomId, "call_teardown", null, { canPublish, nonce: connectNonce });
      disarm();
      audioEls.forEach((el) => el.remove());
      room.disconnect();
      roomRef.current = null;
      setConnected(false);
      setMicOn(false);
      setCamOn(false);
      setSpeakingIds(new Set());
      setVideoTiles([]);
    };
    // `external` is stable for the life of a broadcast page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, roomId, userId, canPublish, pushReaction, refreshTiles, external?.token, connectNonce]);

  /* Back on screen (unlocked, foregrounded, restored from the back-forward
     cache): if the call died while we were away, reconnect. */
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== "visible") return;
      /* Only a drop we classified as ours to recover from. A room that is
         down because the server said so — the same person joined from
         another device (DUPLICATE_IDENTITY), a removal, a closed room —
         must stay down: reconnecting here would kick the other device,
         which would reconnect on its next visibility change and kick us
         back, forever. */
      if (!droppedRef.current) return;
      droppedRef.current = false;
      logRoomEvent(roomId, "visibility_reconnect");
      setConnectNonce((n) => n + 1);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("pageshow", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("pageshow", back);
    };
  }, []);

  /* Turn a getUserMedia / publish failure into something a user can act on.
     Swallowing these (the old behavior) made the buttons look dead. */
  const explainMediaError = (
    kind: "microphone" | "camera" | "screen share" | "speaker",
    e: unknown
  ): string => {
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    if (name === "NotAllowedError" || /permission/i.test(msg))
      return `${kind === "camera" ? "Camera" : kind === "screen share" ? "Screen share" : "Mic"} access is blocked — click the camera icon in your browser's address bar (or System Settings on macOS) and allow it, then try again.`;
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
      noteRoomAction(roomId, next ? "mic_on" : "mic_off");
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      logRoomEvent(roomId, next ? "mic_on" : "mic_off");
    } catch (e) {
      console.warn("mic toggle failed", e);
      setMediaError(explainMediaError("microphone", e));
    } finally {
      setMediaBusy(false);
    }
  }, [micOn, mediaBusy]);

  /* Screen share rides the same publish path as the camera, so it obeys
     the same canPublish grant — a spectator cannot start one. Browsers
     also give the user a "Stop sharing" control of their own, so the
     track can end without us: the room's LocalTrackUnpublished event is
     what keeps our state honest when that happens. */
  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room || mediaBusy) return;
    setMediaBusy(true);
    const next = !screenOn;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenOn(next);
      setMediaError(null);
      refreshTiles();
    } catch (e) {
      /* Cancelling the OS picker throws — that is a choice, not a fault. */
      const name = e instanceof Error ? e.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setMediaError(explainMediaError("screen share", e));
      }
      setScreenOn(false);
    } finally {
      setMediaBusy(false);
    }
  }, [mediaBusy, screenOn, refreshTiles]);

  const refreshCameras = useCallback(async () => {
    try {
      const [cams, audio, outs] = await Promise.all([
        Room.getLocalDevices("videoinput", false),
        Room.getLocalDevices("audioinput", false),
        Room.getLocalDevices("audiooutput", false),
      ]);
      setCameras(cams);
      setMics(audio);
      setSpeakers(outs);
      const room = roomRef.current;
      setActiveCameraId(room?.getActiveDevice("videoinput") ?? null);
      setActiveMicId(room?.getActiveDevice("audioinput") ?? null);
      setActiveSpeakerId(room?.getActiveDevice("audiooutput") ?? null);
    } catch {
      /* no-op */
    }
  }, []);

  useEffect(() => {
    refreshCameras();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    md.addEventListener("devicechange", refreshCameras);
    return () => md.removeEventListener("devicechange", refreshCameras);
  }, [refreshCameras]);

  const switchCamera = useCallback(
    async (deviceId: string) => {
      const room = roomRef.current;
      if (!room) return;
      try {
        await room.switchActiveDevice("videoinput", deviceId);
        setActiveCameraId(deviceId);
      } catch (e) {
        console.warn("camera switch failed", e);
        setMediaError(explainMediaError("camera", e));
      }
    },
    []
  );

  const switchMic = useCallback(
    async (deviceId: string) => {
      const room = roomRef.current;
      if (!room) return;
      try {
        await room.switchActiveDevice("audioinput", deviceId);
        setActiveMicId(deviceId);
      } catch (e) {
        console.warn("mic switch failed", e);
        setMediaError(explainMediaError("microphone", e));
      }
    },
    []
  );

  const switchSpeaker = useCallback(async (deviceId: string) => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.switchActiveDevice("audiooutput", deviceId);
      setActiveSpeakerId(deviceId);
    } catch (e) {
      console.warn("speaker switch failed", e);
      setMediaError(explainMediaError("speaker", e));
    }
  }, []);

  const setOutputVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    outputVolumeRef.current = clamped;
    setOutputVolumeState(clamped);
    document.querySelectorAll<HTMLMediaElement>("audio[data-lk-track-id], audio").forEach((el) => {
      if (el.srcObject) el.volume = clamped;
    });
  }, []);

  const getMicStreamTrack = useCallback((): MediaStreamTrack | null => {
    const room = roomRef.current;
    const pub = room?.localParticipant.getTrackPublication(Track.Source.Microphone);
    return pub?.track?.mediaStreamTrack ?? null;
  }, []);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    if (!room || mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      const next = !camOn;
      noteRoomAction(roomId, next ? "camera_on" : "camera_off");
      await room.localParticipant.setCameraEnabled(next);
      setCamOn(next);
      logRoomEvent(roomId, next ? "camera_on" : "camera_off");
      refreshTiles();

      refreshCameras();
    } catch (e) {
      console.warn("camera toggle failed", e);
      setMediaError(explainMediaError("camera", e));
    } finally {
      setMediaBusy(false);
    }
  }, [camOn, mediaBusy, refreshTiles, refreshCameras]);

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
    /* Non-null → the audience-overflow broadcast view is in effect. */
    hlsMode,
    /* Re-run the token request / connection attempt (used to leave HLS
       mode when the live playlist dies — the server will hand out a
       WebRTC token once hls_url is gone). */
    retryConnect: useCallback(() => setConnectNonce((n) => n + 1), []),
    micOn,
    camOn,
    mediaBusy,
    mediaError,
    audioBlocked,
    /* Bumps each time the call comes back after a drop; when it happened. */
    reconnects,
    lastDropAt,
    /* ?avdebug=1 overlay: where in the chain audio/video is breaking. */
    debugSnapshot: () => {
      const room = roomRef.current;
      if (!room) return { state: "no-room" };
      return {
        state: room.state,
        me: room.localParticipant?.identity,
        canPublish,
        canPlayAudio: room.canPlaybackAudio,
        localTracks: [...room.localParticipant.trackPublications.values()].map(
          (p) => `${p.kind}:${p.isMuted ? "muted" : "LIVE"}`
        ),
        remotes: [...room.remoteParticipants.values()].map((p) => ({
          id: p.identity,
          tracks: [...p.trackPublications.values()].map(
            (t) => `${t.kind}:${t.isSubscribed ? "sub" : "NOT-SUB"}:${t.isMuted ? "muted" : "LIVE"}`
          ),
        })),
      };
    },
    enableAudio: () => {
      unlockRef.current();
    },
    clearMediaError: () => setMediaError(null),
    toggleMic,
    toggleCam,
    cameras,
    activeCameraId,
    switchCamera,
    mics,
    activeMicId,
    switchMic,
    speakers,
    activeSpeakerId,
    switchSpeaker,
    outputVolume,
    setOutputVolume,
    getMicStreamTrack,
    screenOn,
    toggleScreenShare,
    sendReaction,
    reactions,
    speakingIds,
    videoTiles,
  };
}
