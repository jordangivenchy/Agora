/* Web and Expo Go have no LiveKit native module. */
export type LiveKit = typeof import("@livekit/react-native");
export function loadLiveKit(): LiveKit | null {
  return null;
}
