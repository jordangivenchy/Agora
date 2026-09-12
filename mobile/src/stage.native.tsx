/* Who is here, who is speaking, and the mic. Rendered inside the call
   host, so LiveKit's hooks see the room. */
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { ConnectionState, type Participant } from "livekit-client";
import { loadLiveKit, type LiveKit } from "./livekit";
import { colors } from "./theme";
import { Button, Note } from "./ui";
import { Stage as Fallback } from "./stage";

export function Stage() {
  const lk = loadLiveKit();
  if (!lk) return <Fallback />;
  return <NativeStage lk={lk} />;
}

function NativeStage({ lk }: { lk: LiveKit }) {
  const state = lk.useConnectionState();
  const participants = lk.useParticipants();
  const { localParticipant } = lk.useLocalParticipant();
  return (
    <View style={{ flex: 1 }}>
      <Note>
        {state === ConnectionState.Connected
          ? `${participants.length} here`
          : state === ConnectionState.Reconnecting
            ? "Reconnecting…"
            : "Connecting…"}
      </Note>
      <ScrollView style={{ flex: 1, marginTop: 10 }}>
        {participants.map((p) => (
          <Person key={p.identity} lk={lk} p={p} me={p.identity === localParticipant.identity} />
        ))}
      </ScrollView>
    </View>
  );
}

/** The mic, for anyone the token lets publish; nothing for listeners. */
export function MicButton({ compact }: { compact?: boolean }) {
  const lk = loadLiveKit();
  if (!lk) return null;
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

function Person({ lk, p, me }: { lk: LiveKit; p: Participant; me: boolean }) {
  const speaking = lk.useIsSpeaking(p);
  const canSpeak = p.permissions?.canPublish ?? false;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.surface2 }}>
      <View
        style={{
          width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
          backgroundColor: speaking ? colors.yellow : colors.surface2, borderWidth: 1, borderColor: speaking ? colors.yellow : colors.border,
        }}
      >
        <Text style={{ color: speaking ? colors.ink : colors.text, fontWeight: "800" }}>{(p.name || p.identity).slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "600" }}>
          {p.name || p.identity}{me ? " (you)" : ""}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 11.5 }}>{canSpeak ? (p.isMicrophoneEnabled ? "on the mic" : "on stage, muted") : "listening"}</Text>
      </View>
    </View>
  );
}
