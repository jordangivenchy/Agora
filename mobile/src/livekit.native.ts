/* LiveKit's native module, loaded on demand inside a try: Expo Go has no
   native modules and gets null; the real build (expo run:ios, TestFlight)
   gets the module with its globals registered once. */
export type LiveKit = typeof import("@livekit/react-native");

let cached: LiveKit | null | undefined;

export function loadLiveKit(): LiveKit | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lk = require("@livekit/react-native") as LiveKit;
    lk.registerGlobals();
    cached = lk;
  } catch {
    cached = null;
  }
  return cached;
}
