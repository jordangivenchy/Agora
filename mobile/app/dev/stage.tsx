/* A room with made-up people, to look at the design without a live room:
   the amphitheater from the seats, and the speaker view's call layout —
   Discord's square grid for any number of cameras, a shared screen, or
   multi-speaker. Development only. */
import { useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Amphitheater, type AmphiPerson, type AmphiStagePerson, type AmphiView } from "../../src/amphitheater";
import { StageTiles, type Layout, type StageTile } from "../../src/roomTiles";
import { colors, fonts } from "../../src/theme";

const person = (id: string, name: string): AmphiPerson => ({ id, name, handle: name.toLowerCase(), avatarUrl: null });
const AUDIENCE = ["Mia", "Noah", "Ava", "Leo", "Zoe", "Eli", "Ivy", "Max", "Uma"].map((n, i) => person(`u-a${i}`, n));
const QUEUE = [person("u-1", "Christian"), person("u-2", "Dada"), person("u-3", "Priya"), person("u-4", "Tom"), person("u-5", "Kai"), person("u-6", "Lena"), person("u-7", "Omar")];
const tile = (id: string, name: string, role: string, micMuted = false): StageTile => ({ key: `${id}:camera`, identity: id, username: name, handle: name.toLowerCase(), avatarUrl: null, local: false, source: "camera", micMuted, roleLabel: role, call: null });
const NAMES = ["Jordan", "Red", "Alan", "Mia", "Noah", "Ava", "Leo", "Zoe", "Eli", "Ivy", "Max", "Uma", "Kai", "Lena", "Omar", "Priya"];
const STRIP: AmphiStagePerson[] = [{ ...person("u-host", "Jordan"), role: "host" }, { ...person("u-co", "Sam"), role: "cohost" }];

export default function DevStage() {
  const [mic, setMic] = useState(true);
  const [view, setView] = useState<AmphiView>("audience");
  const [count, setCount] = useState(4);
  const [share, setShare] = useState(false);
  const [layout, setLayout] = useState<Layout>("gallery");
  const [talker, setTalker] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!__DEV__) return null;
  const tiles: StageTile[] = [
    ...(share ? [{ ...tile("u-1", NAMES[1], "Speaker"), key: "u-1:screen", source: "screen" as const }] : []),
    ...NAMES.slice(0, count).map((n, i) => tile(`u-${i}`, n, i === 0 ? "Host" : "Speaker", i % 3 === 2)),
  ];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "Amphitheater (design)" }} />
      <Amphitheater
        width={width}
        height={height - insets.top - 130 - 70}
        view={view}
        onSwitchView={() => setView((v) => (v === "audience" ? "speaker" : "audience"))}
        speakerLayout={(area) => <StageTiles tiles={tiles} speaking={new Set([`u-${talker}`])} layout={layout} pinned={pinned} onPin={setPinned} width={area.width} height={area.height} onPressTile={() => {}} />}
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12 }}>
        <Chip label="−" onPress={() => setCount((c) => Math.max(0, c - 1))} />
        <Chip label={`${count} on stage`} onPress={() => setCount((c) => (c >= NAMES.length ? 1 : c + 1))} />
        <Chip label="+" onPress={() => setCount((c) => Math.min(NAMES.length, c + 1))} />
        <Chip label={`Talking: ${NAMES[talker]}`} onPress={() => setTalker((i) => (i + 1) % Math.max(1, count))} />
        <Chip label={share ? "Stop share" : "Share screen"} onPress={() => setShare((v) => !v)} />
        <Chip label={layout === "gallery" ? "Gallery" : "Multi-speaker"} onPress={() => setLayout((l) => (l === "gallery" ? "multi" : "gallery"))} />
        <Chip label={mic ? "Free the mic" : "Take the mic"} onPress={() => setMic((v) => !v)} />
      </View>
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: "#0e0e11", borderWidth: 1, borderColor: "#2a2a33", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}
