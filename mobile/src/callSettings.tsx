/* Call settings (components/agora/CallSettings.tsx) as a sheet: the
   camera (the phone's cameras, flip), the audio (the route — speaker,
   or whatever the phone offers through its own picker — the output
   volume, a mic test with a level meter), and the words about the
   display, sharing and accessibility, adapted to a phone. */
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CallApi } from "./roomCall";
import { colors, fonts } from "./theme";

type Section = "video" | "audio" | "display" | "share" | "access";
const SECTIONS: { key: Section; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { key: "video", label: "Video & effects", icon: "videocam-outline" },
  { key: "audio", label: "Audio", icon: "headset-outline" },
  { key: "display", label: "Display & controls", icon: "phone-portrait-outline" },
  { key: "share", label: "Share screen", icon: "desktop-outline" },
  { key: "access", label: "Accessibility", icon: "accessibility-outline" },
];

function Meter({ level }: { level: number }) {
  const lit = Math.round(Math.max(0, Math.min(1, level)) * 9);
  return (
    <View style={{ flexDirection: "row", gap: 3, marginTop: 8 }}>
      {Array.from({ length: 9 }, (_, i) => <View key={i} style={{ width: 16, height: 8, borderRadius: 2, backgroundColor: i < lit ? (i > 6 ? colors.red : colors.green) : "#1f1f26" }} />)}
    </View>
  );
}

/* A slider, drawn: a track you drag or tap. */
function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const set = (x: number) => { if (w > 0) onChange(Math.max(0, Math.min(1, x / w))); };
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => set(e.nativeEvent.locationX)}
      onResponderMove={(e) => set(e.nativeEvent.locationX)}
      style={{ flex: 1, height: 32, justifyContent: "center" }}
    >
      <View style={{ height: 4, borderRadius: 2, backgroundColor: "#26262e" }}>
        <View style={{ width: `${value * 100}%`, height: 4, borderRadius: 2, backgroundColor: colors.yellow }} />
      </View>
      <View style={{ position: "absolute", left: Math.max(0, value * w - 8), width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff" }} />
    </View>
  );
}

const Label = ({ t }: { t: string }) => <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.semi, fontSize: 10, letterSpacing: 0.9, marginTop: 10, marginBottom: 6 }}>{t.toUpperCase()}</Text>;
const Body = ({ t }: { t: string }) => <Text style={{ color: "#c9c9d2", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 }}>{t}</Text>;

function Choice({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ width: 18, alignItems: "center" }}>{on && <Ionicons name="checkmark" size={15} color={colors.yellow} />}</View>
      <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function CallSettingsSheet({ open, onClose, call }: { open: boolean; onClose: () => void; call: CallApi }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [section, setSection] = useState<Section | null>("video");
  const body = (key: Section) => {
    switch (key) {
      case "video":
        return (
          <View>
            <Label t="Camera" />
            {call.cameras.length === 0 ? (
              <Body t={call.live ? "Turn your video on once so the phone can name its cameras." : "Live video needs the full app build."} />
            ) : (
              call.cameras.map((c) => <Choice key={c.id} label={c.label} on={c.id === call.activeCameraId} onPress={() => call.switchCamera(c.id)} />)
            )}
            {call.live && call.camOn && (
              <Pressable onPress={call.flipCamera} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, height: 32, borderRadius: 8, backgroundColor: "#141418", borderWidth: 1, borderColor: "#2a2a33", marginTop: 4 }}>
                <Ionicons name="camera-reverse-outline" size={14} color={colors.text} />
                <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 12 }}>Flip camera</Text>
              </Pressable>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, opacity: 0.55 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13 }}>Blur my background</Text>
              <Text style={{ color: colors.gold, fontFamily: fonts.semi, fontSize: 10, letterSpacing: 0.6 }}>SOON</Text>
            </View>
          </View>
        );
      case "audio":
        return (
          <View>
            <Label t="Speaker" />
            <Choice label="Speaker" on={call.output === "speaker"} onPress={() => call.setOutput("speaker")} disabled={!call.live} />
            <Choice label="Default route (earpiece, headphones)" on={call.output === "default"} onPress={() => call.setOutput("default")} disabled={!call.live} />
            <Pressable onPress={call.showRoutePicker} disabled={!call.live} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, height: 32, borderRadius: 8, backgroundColor: "#141418", borderWidth: 1, borderColor: "#2a2a33", marginTop: 4, opacity: call.live ? 1 : 0.5 }}>
              <Ionicons name="bluetooth-outline" size={14} color={colors.text} />
              <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 12 }}>Choose AirPods, a speaker…</Text>
            </Pressable>
            <Label t="Output volume" />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="volume-mute-outline" size={15} color={colors.muted} />
              <Slider value={call.outputVolume} onChange={call.setOutputVolume} />
              <Ionicons name="volume-high-outline" size={15} color={colors.muted} />
            </View>
            <Label t="Microphone" />
            <Body t={call.canPublish ? (call.micOn ? "Your phone's microphone." : "Unmute once to test your microphone.") : "The mic is for people on the stage."} />
            <Pressable onPress={() => call.setMicTest(!call.micTest)} disabled={!call.micOn} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, height: 32, borderRadius: 8, backgroundColor: call.micTest ? colors.yellow : "#141418", borderWidth: 1, borderColor: call.micTest ? colors.yellow : "#2a2a33", marginTop: 8, opacity: call.micOn ? 1 : 0.5 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: call.micTest ? colors.ink : colors.green }} />
              <Text style={{ color: call.micTest ? colors.ink : colors.text, fontFamily: fonts.semi, fontSize: 12 }}>{call.micTest ? "Stop test" : "Test microphone"}</Text>
            </Pressable>
            <Meter level={call.micTest ? call.micLevel : 0} />
            <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11, marginTop: 6 }}>Input level follows your phone's microphone.</Text>
          </View>
        );
      case "display":
        return <Body t="Gallery shows everyone at once; multi-speaker keeps one picture big. Long-press a picture to pin it, and pick the layout under More. The chat lives under its own button." />;
      case "share":
        return <Body t="Sharing a screen is a desktop act — a share from someone at a desk takes the big picture here, and you can pin it." />;
      case "access":
        return (
          <View>
            <Body t="Reduce motion stills the sky and the glides. It follows your account's setting." />
            <Pressable onPress={() => { onClose(); setTimeout(() => router.push({ pathname: "/settings/[section]", params: { section: "appearance" } }), 320); }} style={{ marginTop: 8, alignSelf: "flex-start" }}>
              <Text style={{ color: colors.blueText, fontFamily: fonts.semi, fontSize: 12.5 }}>Appearance settings →</Text>
            </Pressable>
          </View>
        );
    }
  };
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1 }} accessibilityLabel="Close" />
      <View style={{ maxHeight: Math.round(height * 0.78), backgroundColor: "#0b0b0d", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#26262e" }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15 }}>Settings</Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close settings" style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={20} color={colors.muted} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 14 }}>
          {SECTIONS.map((s) => {
            const isOpen = section === s.key;
            return (
              <View key={s.key} style={{ borderBottomWidth: 1, borderColor: "#17171c" }}>
                <Pressable onPress={() => setSection(isOpen ? null : s.key)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 4 }}>
                  <Ionicons name={s.icon} size={17} color={colors.soft} />
                  <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13.5, flex: 1 }}>{s.label}</Text>
                  <Ionicons name={isOpen ? "chevron-down" : "chevron-forward"} size={15} color={colors.faint} />
                </Pressable>
                {isOpen && <View style={{ paddingHorizontal: 4, paddingBottom: 12 }}>{body(s.key)}</View>}
              </View>
            );
          })}
          <Pressable onPress={() => { onClose(); setTimeout(() => router.push("/settings"), 320); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 14, paddingHorizontal: 4 }}>
            <Ionicons name="settings-outline" size={14} color={colors.blueText} />
            <Text style={{ color: colors.blueText, fontFamily: fonts.semi, fontSize: 12.5 }}>Open all settings</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
