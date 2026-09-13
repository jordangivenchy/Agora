/* The live call as the room screen sees it, from LiveKit's hooks: who is
   on camera, who is speaking, the mic and camera with their failures
   explained, the reactions over the data channel, the audio route and
   volume, one person silenced for me. Rendered inside the call host's
   LiveKitRoom, so the hooks see the room; without the native module
   (Expo Go) or without a call (the broadcast) the inert call stands. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking } from "react-native";
import { ConnectionState, Room, RoomEvent, Track, type LocalAudioTrack, type LocalVideoTrack, type RemoteAudioTrack } from "livekit-client";
import { loadLiveKit, type LiveKit } from "./livekit";
import { noteDisconnectReason, useCall } from "./callSession";
import type { HlsMode } from "./token";
import { inertCall, pushReactionTo, REACTION_TTL_MS, type CallApi, type CallTile, type CameraDevice, type Reaction } from "./roomCall";

export function LiveCall({ username, hls, children }: { username: string; hls: HlsMode | null; children: (call: CallApi) => ReactNode }) {
  const lk = loadLiveKit();
  const { active } = useCall();
  if (!lk || !active) return <>{children(inertCall({ hls, connected: !!hls }))}</>;
  return <LkCall lk={lk} username={username} hls={hls}>{children}</LkCall>;
}

type DataMsg = { t: "reaction"; e: string; u: string };

function explain(kind: "microphone" | "camera", e: unknown): { message: string; settings: boolean } {
  const name = e instanceof Error ? e.name : "";
  const msg = e instanceof Error ? e.message : String(e);
  const what = kind === "camera" ? "Camera" : "Mic";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || /permission|denied|not allowed/i.test(msg)) {
    return { message: `${what} access is off for AgoraSphere — allow it in Settings, then try again.`, settings: true };
  }
  if (name === "NotFoundError" || /not found/i.test(msg)) return { message: `No ${kind} found on this device.`, settings: false };
  if (name === "NotReadableError" || /in use|could not start/i.test(msg)) return { message: `Your ${kind} is in use by another app — close it and try again.`, settings: false };
  if (/insufficient permissions|not allowed to publish/i.test(msg)) return { message: "You don't have publish rights in this room — rejoining the stage should fix it.", settings: false };
  return { message: `Could not start the ${kind}: ${msg || "unknown error"}`, settings: false };
}

function LkCall({ lk, username, hls, children }: { lk: LiveKit; username: string; hls: HlsMode | null; children: (call: CallApi) => ReactNode }) {
  const room = lk.useRoomContext();
  const state = lk.useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, microphoneTrack } = lk.useLocalParticipant();
  const speakingParticipants = lk.useSpeakingParticipants();
  const videoRefs = lk.useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: false });
  const audioRefs = lk.useTracks([Track.Source.Microphone], { onlySubscribed: true });

  /* The reason a drop had, for the room screen's decision to come back. */
  useEffect(() => {
    const onDisconnected = (reason?: number) => noteDisconnectReason(reason);
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  /* ── Reactions ── */
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const push = useCallback((emoji: string, who: string) => {
    setReactions((prev) => {
      const { next, id } = pushReactionTo(prev, emoji, who);
      setTimeout(() => setReactions((p) => p.filter((r) => r.id !== id)), REACTION_TTL_MS);
      return next;
    });
  }, []);
  const { send } = lk.useDataChannel((msg) => {
    try {
      const d = JSON.parse(new TextDecoder().decode(msg.payload)) as DataMsg;
      if (d.t === "reaction" && typeof d.e === "string") push(d.e.slice(0, 8), String(d.u ?? "").slice(0, 40));
    } catch {
      /* forwarded garbage */
    }
  });
  const react = useCallback((emoji: string) => {
    push(emoji, username);
    if (room.state !== ConnectionState.Connected) return;
    const msg: DataMsg = { t: "reaction", e: emoji, u: username };
    void send(new TextEncoder().encode(JSON.stringify(msg)), { reliable: false }).catch(() => undefined);
  }, [push, room, send, username]);

  /* ── Mic and camera ── */
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<{ message: string; settings: boolean } | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
  const canPublish = localParticipant.permissions?.canPublish ?? false;

  const refreshCameras = useCallback(async () => {
    try {
      const list = await Room.getLocalDevices("videoinput", false);
      setCameras(list.map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` })));
      setActiveCameraId(room.getActiveDevice("videoinput") ?? null);
    } catch {
      /* no camera list */
    }
  }, [room]);

  const toggleMic = useCallback(async () => {
    if (mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (e) {
      setMediaError(explain("microphone", e));
    } finally {
      setMediaBusy(false);
    }
  }, [localParticipant, isMicrophoneEnabled, mediaBusy]);

  const toggleCam = useCallback(async () => {
    if (mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled, { facingMode: facing });
      void refreshCameras();
    } catch (e) {
      setMediaError(explain("camera", e));
    } finally {
      setMediaBusy(false);
    }
  }, [localParticipant, isCameraEnabled, facing, mediaBusy, refreshCameras]);

  const flipCamera = useCallback(async () => {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    if (!track) return;
    try {
      await track.restartTrack({ facingMode: next });
      void refreshCameras();
    } catch (e) {
      setMediaError(explain("camera", e));
    }
  }, [localParticipant, facing, refreshCameras]);

  const switchCamera = useCallback(async (id: string) => {
    try {
      await room.switchActiveDevice("videoinput", id);
      setActiveCameraId(id);
    } catch (e) {
      setMediaError(explain("camera", e));
    }
  }, [room]);

  useEffect(() => {
    void refreshCameras();
  }, [refreshCameras]);

  /* ── Output: the route, the volume, one person silenced ── */
  const [output, setOutputState] = useState<"default" | "speaker">("speaker");
  const [outputVolume, setOutputVolumeState] = useState(1);
  const volumeRef = useRef(1);
  const [mutedLocally, setMutedLocally] = useState<Set<string>>(new Set());
  const mutedRef = useRef(mutedLocally);
  mutedRef.current = mutedLocally;
  const [hiddenCameras, setHiddenCameras] = useState<Set<string>>(new Set());

  const applyVolumes = useCallback(() => {
    room.remoteParticipants.forEach((p) => {
      const v = mutedRef.current.has(p.identity) ? 0 : volumeRef.current;
      p.audioTrackPublications.forEach((pub) => {
        const t = pub.track as RemoteAudioTrack | undefined;
        if (t && typeof t.setVolume === "function") t.setVolume(v);
      });
    });
  }, [room]);
  useEffect(() => {
    applyVolumes();
  }, [applyVolumes, audioRefs, mutedLocally, outputVolume]);

  const setOutputVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    volumeRef.current = clamped;
    setOutputVolumeState(clamped);
    void lk.AudioSession.setDefaultRemoteAudioTrackVolume(clamped).catch(() => undefined);
    applyVolumes();
  }, [lk, applyVolumes]);
  const setOutput = useCallback((o: "default" | "speaker") => {
    setOutputState(o);
    void lk.AudioSession.selectAudioOutput(o === "speaker" ? "force_speaker" : "default").catch(() => undefined);
  }, [lk]);
  const showRoutePicker = useCallback(() => {
    void lk.AudioSession.showAudioRoutePicker().catch(() => undefined);
  }, [lk]);
  const toggleLocalMute = useCallback((identity: string) => {
    setMutedLocally((prev) => {
      const next = new Set(prev);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      return next;
    });
  }, []);
  const toggleHideCamera = useCallback((identity: string) => {
    setHiddenCameras((prev) => {
      const next = new Set(prev);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      return next;
    });
  }, []);

  /* ── The mic test ── */
  const [micTest, setMicTest] = useState(false);
  const micLevel = lk.useTrackVolume(micTest ? (microphoneTrack?.track as LocalAudioTrack | undefined) : undefined);

  /* ── Tiles: every live camera (a muted camera is one that is off), every share ── */
  const tiles = useMemo<CallTile[]>(() => {
    const out: CallTile[] = [];
    for (const ref of videoRefs) {
      const source = ref.source === Track.Source.ScreenShare ? "screen" : "camera";
      if (source === "camera" && ref.publication.isMuted) continue;
      if (!ref.publication.track) continue;
      const local = ref.participant.isLocal;
      if (!local && source === "camera" && hiddenCameras.has(ref.participant.identity)) continue;
      out.push({ key: `${ref.participant.identity}:${local ? "l" : "r"}:${source}`, identity: ref.participant.identity, source, local, ref });
    }
    return out;
  }, [videoRefs, hiddenCameras]);

  const speaking = useMemo(() => new Set(speakingParticipants.map((p) => p.identity)), [speakingParticipants]);

  const call: CallApi = {
    connected: state === ConnectionState.Connected,
    reconnecting: state === ConnectionState.Reconnecting,
    live: true,
    canPublish,
    micOn: isMicrophoneEnabled,
    camOn: isCameraEnabled,
    mediaBusy,
    mediaError: mediaError?.message ?? null,
    mediaErrorSettings: !!mediaError?.settings,
    clearMediaError: () => setMediaError(null),
    toggleMic: () => void toggleMic(),
    toggleCam: () => void toggleCam(),
    flipCamera: () => void flipCamera(),
    facing,
    cameras,
    activeCameraId,
    switchCamera: (id) => void switchCamera(id),
    outputVolume,
    setOutputVolume,
    output,
    setOutput,
    showRoutePicker,
    speaking,
    tiles,
    reactions,
    react,
    micLevel: Math.min(1, micLevel * 4),
    micTest,
    setMicTest,
    mutedLocally,
    toggleLocalMute,
    hiddenCameras,
    toggleHideCamera,
    hls,
  };
  return <>{children(call)}</>;
}

/** The Settings app, where a denied mic or camera is allowed again. */
export function openAppSettings() {
  void Linking.openSettings().catch(() => undefined);
}
