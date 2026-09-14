/* A stage with made-up people, to look at the design without a live room:
   the amphitheater (the audience view) and the speaker view's hands and
   listeners. Development only. */
import { useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StageView } from "../../src/stageView";
import { Amphitheater, type AmphiPerson, type AmphiStagePerson } from "../../src/amphitheater";
import type { StageTile } from "../../src/roomTiles";
import type { Seat } from "../../src/stageModel";
import { colors, fonts } from "../../src/theme";
import { Button, Screen } from "../../src/ui";

const HOST = "u-host";
const seat = (id: string, name: string, extra: Partial<Seat> = {}): Seat => ({
  id, room_id: "r", user_id: id, role: "spectator", stance: null, joined_at: "2026-09-12T00:00:00Z", left_at: null, hand_raised_at: null, mic_muted: false, stage_role: null,
  user: { username: name.toLowerCase(), display_name: name, avatar_url: null }, ...extra,
});

const SEATS: Seat[] = [
  seat(HOST, "Jordan"),
  seat("u-red", "Red", { stage_role: "speaker" }),
  seat("u-alan", "Alan", { stage_role: "speaker", mic_muted: true }),
  seat("u-1", "Christian", { hand_raised_at: "2026-09-12T00:01:00Z" }),
  seat("u-2", "Dada", { hand_raised_at: "2026-09-12T00:02:00Z" }),
  ...Array.from({ length: 9 }, (_, i) => seat(`u-a${i}`, ["Mia", "Noah", "Ava", "Leo", "Zoe", "Eli", "Ivy", "Max", "Uma"][i])),
];

const person = (id: string, name: string): AmphiPerson => ({ id, name, handle: name.toLowerCase(), avatarUrl: null });
const AUDIENCE = ["Mia", "Noah", "Ava", "Leo", "Zoe", "Eli", "Ivy", "Max", "Uma"].map((n, i) => person(`u-a${i}`, n));
const QUEUE = [person("u-1", "Christian"), person("u-2", "Dada"), person("u-3", "Priya"), person("u-4", "Tom"), person("u-5", "Kai"), person("u-6", "Lena"), person("u-7", "Omar")];
const tile = (id: string, name: string, role: string, micMuted = false): StageTile => ({ key: `${id}:camera`, identity: id, username: name, handle: name.toLowerCase(), avatarUrl: null, local: false, source: "camera", micMuted, roleLabel: role, call: null });
const STRIP: AmphiStagePerson[] = [{ ...person(HOST, "Jordan"), role: "host" }, { ...person("u-co", "Sam"), role: "cohost" }];

export default function DevStage() {
  const [asHost, setAsHost] = useState(true);
  const [locked, setLocked] = useState(false);
  const [amphi, setAmphi] = useState(true);
  const [mic, setMic] = useState(true);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!__DEV__) return null;
  if (amphi) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: "Amphitheater (design)" }} />
        <Amphitheater
          width={width}
          height={height - insets.top - 130 - 70}
          bottomInset={12}
          roomId="design-room"
          audience={AUDIENCE}
          viewerCount={48}
          queue={QUEUE}
          micHolder={mic ? person("u-mic", "Harper") : null}
          micLive={mic}
          strip={mic ? [...STRIP, { ...person("u-mic", "Harper"), role: "speaker" }] : STRIP}
          dock={[tile("u-red", "Red", "Speaker"), tile("u-alan", "Alan", "Speaker", true)]}
          speaking={new Set(["u-red"])}
          onPressTile={() => {}}
          onPressStrip={() => {}}
        />
        <View style={{ flexDirection: "row", gap: 8, padding: 12 }}>
          <Chip label="Speaker view" onPress={() => setAmphi(false)} />
          <Chip label={mic ? "Free the mic" : "Take the mic"} onPress={() => setMic((v) => !v)} />
        </View>
      </View>
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: "Stage (design)" }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        <View style={{ paddingTop: 12, paddingBottom: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.red }} />
              <Text style={{ color: colors.red, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 }}>LIVE</Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11.5 }}>{SEATS.length} here</Text>
          </View>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", lineHeight: 26, letterSpacing: -0.2 }}>Should the voting age be lowered to 16?</Text>
          <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 4 }}>Hosted by Jordan</Text>
        </View>
        <StageView
          seats={SEATS}
          hostId={HOST}
          meId={asHost ? HOST : "u-1"}
          myRole={asHost ? "host" : "audience"}
          speaking={new Set(["u-red"])}
          actions={asHost ? { bringUp: () => {}, dismiss: () => {}, toAudience: () => {}, makeCohost: () => {} } : null}
          requestsLocked={locked}
          onToggleLock={() => setLocked((v) => !v)}
        />
        <View style={{ height: 20 }} />
        <Button kind="secondary" onPress={() => setAsHost((v) => !v)}>{asHost ? "View as a listener" : "View as the host"}</Button>
        <View style={{ height: 10 }} />
        <Button kind="secondary" onPress={() => setAmphi(true)}>Amphitheater</Button>
      </ScrollView>
    </Screen>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: "#0e0e11", borderWidth: 1, borderColor: "#2a2a33", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}
