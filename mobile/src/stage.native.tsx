/* Who is audibly speaking, the mic, and the connection state, all from
   LiveKit, rendered inside the call host so the hooks see the room. */
import { Pressable, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { ConnectionState } from "livekit-client";
import { loadLiveKit, type LiveKit } from "./livekit";
import { colors } from "./theme";
import { Button, Note } from "./ui";
import { useSpeakingIds as noSpeaking, MicButton as NoMic, ConnectionNote as NoConnection } from "./stage";

export function useSpeakingIds(): Set<string> {
  const lk = loadLiveKit();
  // Hooks are called unconditionally per platform: lk is fixed for the app's life.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return lk ? useNativeSpeaking(lk) : noSpeaking();
}

function useNativeSpeaking(lk: LiveKit): Set<string> {
  const speaking = lk.useSpeakingParticipants();
  return new Set(speaking.map((p) => p.identity));
}

export function MicButton({ compact }: { compact?: boolean }) {
  const lk = loadLiveKit();
  if (!lk) return <NoMic compact={compact} />;
  return <NativeMic lk={lk} compact={compact} />;
}

function NativeMic({ lk, compact }: { lk: LiveKit; compact?: boolean }) {
  const { localParticipant, isMicrophoneEnabled } = lk.useLocalParticipant();
  const canPublish = localParticipant.permissions?.canPublish ?? false;
  if (!canPublish) return null;
  const toggle = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };
  if (compact) {
    return (
      <Pressable onPress={toggle} hitSlop={8} style={{ paddingHorizontal: 12, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: isMicrophoneEnabled ? colors.yellow : colors.surface2, borderWidth: 1, borderColor: isMicrophoneEnabled ? colors.yellow : colors.border }}>
        <Text style={{ color: isMicrophoneEnabled ? colors.ink : colors.text, fontSize: 12.5, fontWeight: "700" }}>{isMicrophoneEnabled ? "Mic on" : "Mic off"}</Text>
      </Pressable>
    );
  }
  return (
    <Button kind={isMicrophoneEnabled ? "primary" : "secondary"} onPress={toggle}>
      {isMicrophoneEnabled ? "Mic on" : "Mic off"}
    </Button>
  );
}

export function ConnectionNote() {
  const lk = loadLiveKit();
  if (!lk) return <NoConnection />;
  return <NativeConnection lk={lk} />;
}

function NativeConnection({ lk }: { lk: LiveKit }) {
  const state = lk.useConnectionState();
  return <Note>{state === ConnectionState.Connected ? "Connected" : state === ConnectionState.Reconnecting ? "Reconnecting…" : "Connecting…"}</Note>;
}
