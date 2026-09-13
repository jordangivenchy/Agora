/* What the room screen asks of the live call, whichever way the call
   is carried: LiveKit in the real build, nothing in Expo Go and on the
   web, the broadcast stream when the room is over the audience ceiling.
   The screen draws from this; liveRoom.native.tsx fills it in. */
import type { HlsMode } from "./token";

export interface Reaction {
  id: number;
  emoji: string;
  username: string;
}

export interface CallTile {
  /** identity:l|r:camera|screen — a share beside a camera is two tiles from one person. */
  key: string;
  identity: string;
  source: "camera" | "screen";
  local: boolean;
  /** The LiveKit track reference; the tile video draws it. */
  ref: unknown;
}

export interface CameraDevice {
  id: string;
  label: string;
}

export interface CallApi {
  /** The call is up (or the broadcast is playing). */
  connected: boolean;
  reconnecting: boolean;
  /** A LiveKit call is being carried at all (false in Expo Go, on the web, and in broadcast mode). */
  live: boolean;
  canPublish: boolean;
  micOn: boolean;
  camOn: boolean;
  mediaBusy: boolean;
  mediaError: string | null;
  /** Set when the error is a denied permission: the Settings app fixes it. */
  mediaErrorSettings: boolean;
  clearMediaError(): void;
  toggleMic(): void;
  toggleCam(): void;
  flipCamera(): void;
  facing: "user" | "environment";
  cameras: CameraDevice[];
  activeCameraId: string | null;
  switchCamera(id: string): void;
  outputVolume: number;
  setOutputVolume(v: number): void;
  /** iOS: the default route, or the speaker forced. */
  output: "default" | "speaker";
  setOutput(o: "default" | "speaker"): void;
  showRoutePicker(): void;
  speaking: ReadonlySet<string>;
  tiles: CallTile[];
  reactions: Reaction[];
  react(emoji: string): void;
  /** The local mic's level while the test runs, 0..1. */
  micLevel: number;
  micTest: boolean;
  setMicTest(on: boolean): void;
  /** Silence one person for me only (the person menu's "Mute their audio"). */
  mutedLocally: ReadonlySet<string>;
  toggleLocalMute(identity: string): void;
  hiddenCameras: ReadonlySet<string>;
  toggleHideCamera(identity: string): void;
  hls: HlsMode | null;
}

const NONE = new Set<string>();
const noop = () => undefined;

/** The call with nothing behind it: the seats, hands and chat still work. */
export function inertCall(overrides: Partial<CallApi> = {}): CallApi {
  return {
    connected: false,
    reconnecting: false,
    live: false,
    canPublish: false,
    micOn: false,
    camOn: false,
    mediaBusy: false,
    mediaError: null,
    mediaErrorSettings: false,
    clearMediaError: noop,
    toggleMic: noop,
    toggleCam: noop,
    flipCamera: noop,
    facing: "user",
    cameras: [],
    activeCameraId: null,
    switchCamera: noop,
    outputVolume: 1,
    setOutputVolume: noop,
    output: "speaker",
    setOutput: noop,
    showRoutePicker: noop,
    speaking: NONE,
    tiles: [],
    reactions: [],
    react: noop,
    micLevel: 0,
    micTest: false,
    setMicTest: noop,
    mutedLocally: NONE,
    toggleLocalMute: noop,
    hiddenCameras: NONE,
    toggleHideCamera: noop,
    hls: null,
    ...overrides,
  };
}

let seq = 1;
/** Reactions float for 3.2 seconds, the site's timing; at most thirty at once. */
export function pushReactionTo(list: Reaction[], emoji: string, username: string): { next: Reaction[]; id: number } {
  const id = seq++;
  return { next: [...list.slice(-30), { id, emoji, username }], id };
}
export const REACTION_TTL_MS = 3200;
export const REACTION_EMOJI = ["👏", "❤️", "😂", "🔥", "👍", "🤯"];
