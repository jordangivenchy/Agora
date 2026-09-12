/* Who is audibly speaking, the mic, and the connection state, all from
   LiveKit, rendered inside the call host so the hooks see the room. */
import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { ConnectionState } from "livekit-client";
import { loadLiveKit, type LiveKit } from "./livekit";
import { useCall } from "./callSession";
import { colors } from "./theme";
import { Button, Note } from "./ui";
import { WithSpeakingFallback as NoSpeaking, MicButtonFallback as NoMic, ConnectionNoteFallback as NoConnection } from "./stageFallback";

/* Who is audibly speaking. LiveKit's hooks throw outside a room, and
   the room screen renders before the call is joined, so the hook only
   runs in a child that exists once there is a room context. */
export function WithSpeaking({ children }: { children: (speaking: Set<string>) => ReactNode }) {
  const lk = loadLiveKit();
  if (!lk) return <NoSpeaking>{children}</NoSpeaking>;
  return <MaybeSpeaking lk={lk}>{children}</MaybeSpeaking>;
}

const NONE = new Set<string>();

/* The call host wraps the app in LiveKitRoom exactly while a call is
   active, so "is there a room context" is "is there an active call". */
function MaybeSpeaking({ lk, children }: { lk: LiveKit; children: (speaking: Set<string>) => ReactNode }) {
  const { active } = useCall();
  if (!active) return <>{children(NONE)}</>;
  return <RoomSpeaking lk={lk}>{children}</RoomSpeaking>;
}

function RoomSpeaking({ lk, children }: { lk: LiveKit; children: (speaking: Set<string>) => ReactNode }) {
  const speaking = lk.useSpeakingParticipants();
  return <>{children(new Set(speaking.map((p) => p.identity)))}</>;
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
