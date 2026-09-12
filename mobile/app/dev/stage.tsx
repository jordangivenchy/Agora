/* A stage with made-up people, to look at the design without a live room.
   Development only. */
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { StageView } from "../../src/stageView";
import type { Seat } from "../../src/stageModel";
import { colors } from "../../src/theme";
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

export default function DevStage() {
  const [asHost, setAsHost] = useState(true);
  const [locked, setLocked] = useState(false);
  if (!__DEV__) return null;
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
      </ScrollView>
    </Screen>
  );
}
