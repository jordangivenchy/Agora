/* Web and Expo Go: no LiveKit, so the call has nothing behind it; the
   broadcast still plays, and the seats, hands and chat work. */
import type { ReactNode } from "react";
import { Linking } from "react-native";
import type { HlsMode } from "./token";
import { inertCall, type CallApi } from "./roomCall";

export function LiveCall({ hls, children }: { username: string; hls: HlsMode | null; children: (call: CallApi) => ReactNode }) {
  return <>{children(inertCall({ hls, connected: !!hls }))}</>;
}

export function openAppSettings() {
  void Linking.openSettings().catch(() => undefined);
}
