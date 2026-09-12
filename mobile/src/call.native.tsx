/* The stage on a phone: connect with the token the site minted, hear the
   room through the native audio session (so it keeps playing with the
   screen off), show who is here and who is speaking, and a mic button for
   anyone the token lets publish.

   LiveKit's native module is loaded on demand inside a try: in Expo Go,
   which has no native modules, the screen says so instead of crashing;
   the real build (expo run:ios, TestFlight) has it. */
import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ConnectionState, type Participant } from "livekit-client";
import type { CallProps } from "./callTypes";
import { colors } from "./theme";
import { Button, Note } from "./ui";

type LiveKit = typeof import("@livekit/react-native");

function loadLiveKit(): LiveKit | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lk = require("@livekit/react-native") as LiveKit;
    lk.registerGlobals();
    return lk;
  } catch {
    return null;
  }
}

export function Call(props: CallProps) {
  const lk = useMemo(loadLiveKit, []);
  if (!lk) {
    return (
      <View style={{ padding: 16, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
          Live audio needs the full AgoraSphere app build (TestFlight or Play), not Expo Go. Everything else works here.
        </Text>
        <View style={{ height: 12 }} />
        <Button kind="secondary" onPress={props.onLeave}>Back</Button>
      </View>
    );
  }
  return <NativeCall lk={lk} {...props} />;
}

function NativeCall({ lk, serverUrl, token, onLeave }: CallProps & { lk: LiveKit }) {
  useEffect(() => {
    void lk.AudioSession.startAudioSession();
    return () => {
      void lk.AudioSession.stopAudioSession();
    };
  }, [lk]);
  const Room = lk.LiveKitRoom;
  return (
    <Room serverUrl={serverUrl} token={token} connect audio={false} video={false} onDisconnected={onLeave}>
      <Stage lk={lk} onLeave={onLeave} />
    </Room>
  );
}

function Stage({ lk, onLeave }: { lk: LiveKit; onLeave: () => void }) {
  const state = lk.useConnectionState();
  const participants = lk.useParticipants();
  const { localParticipant, isMicrophoneEnabled } = lk.useLocalParticipant();
  const canPublish = localParticipant.permissions?.canPublish ?? false;

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
      <View style={{ flexDirection: "row", gap: 10, paddingVertical: 12 }}>
        {canPublish && (
          <View style={{ flex: 1 }}>
            <Button kind={isMicrophoneEnabled ? "primary" : "secondary"} onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}>
              {isMicrophoneEnabled ? "Mic on" : "Mic off"}
            </Button>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Button kind="danger" onPress={onLeave}>Leave</Button>
        </View>
      </View>
    </View>
  );
}

function Person({ lk, p, me }: { lk: LiveKit; p: Participant; me: boolean }) {
  const speaking = lk.useIsSpeaking(p);
  const canSpeak = p.permissions?.canPublish ?? false;
  return (
    <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.surface2 }}>
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
    </Pressable>
  );
}
