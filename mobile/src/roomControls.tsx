/* The control row, the phone's one pill (agora.css, max-width 639px):
   mic and camera leftmost, then react and the hand, chat, More, and
   Leave far right where a destructive control belongs. Fill colour
   carries state: yellow for transmitting, red for leave. The reaction
   tray and the More drawer hang off the row. */
import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REACTION_EMOJI, type CallApi } from "./roomCall";
import type { Layout } from "./roomTiles";
import { showToast } from "./toast";
import { colors, fonts } from "./theme";

type Icon = React.ComponentProps<typeof Ionicons>["name"];
export const CONTROLS_H = 54;

function Ctl({ icon, label, on, onTint, disabled, onPress, badge }: { icon: Icon; label: string; on?: boolean; onTint?: string; disabled?: boolean; onPress: () => void; badge?: number }) {
  const tint = on ? onTint ?? colors.yellow : "transparent";
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label} hitSlop={4} style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: tint, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 })}>
      <Ionicons name={icon} size={19} color={on ? (onTint ? "#fff" : colors.ink) : colors.text} />
      {!!badge && (
        <View style={{ position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 9.5 }}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

export interface ControlsProps {
  call: CallApi;
  onStage: boolean;
  canRaise: boolean;
  handRaised: boolean;
  handBusy: boolean;
  requestsLocked: boolean;
  amMicHolder: boolean;
  onToggleHand: () => void;
  onStepDown: () => void;
  onChat: () => void;
  chatBadge: number;
  onLeave: () => void;
  onSettings: () => void;
  onCopyLink: () => void;
  layout: Layout;
  onLayout: (l: Layout) => void;
  duel: boolean;
}

export function RoomControls(p: ControlsProps) {
  const insets = useSafeAreaInsets();
  const [reactOpen, setReactOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { call } = p;
  const hlsAudience = !!call.hls;
  const publishOff = !p.onStage || !call.connected || call.mediaBusy || !call.live;
  /* The mic is a mute switch once it's warmed up: a camera starting never holds it. */
  const micOff = !p.onStage || !call.connected || !call.live;
  const bottom = 8 + insets.bottom;
  return (
    <>
      {reactOpen && (
        <Pressable onPress={() => setReactOpen(false)} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} accessibilityLabel="Close reactions">
          <View style={{ position: "absolute", left: 10, right: 10, bottom: bottom + CONTROLS_H + 8, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: "#0e0e11", borderWidth: 1, borderColor: "#2a2a33" }}>
            {REACTION_EMOJI.map((e) => (
              <Pressable key={e} onPress={() => { call.react(e); setReactOpen(false); }} hitSlop={6} style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#1b1b21" : "transparent" })}>
                <Text style={{ fontSize: 24 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      )}
      <View style={{ position: "absolute", left: 10, right: 10, bottom, height: CONTROLS_H, borderRadius: 999, paddingHorizontal: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#0e0e11", borderWidth: 1, borderColor: "#2a2a33" }}>
        {!hlsAudience && (
          <>
            <Ctl icon={call.micOn ? "mic" : "mic-off"} label={!p.onStage ? "Mic — speakers only" : call.micOn ? "Mute your mic" : "Unmute your mic"} on={call.micOn} onTint="#1f9d55" disabled={micOff} onPress={call.toggleMic} />
            <Ctl icon={call.camOn ? "videocam" : "videocam-off"} label={!p.onStage ? "Camera — speakers only" : call.camOn ? "Turn camera off" : "Turn camera on"} on={call.camOn} onTint="#1f9d55" disabled={publishOff} onPress={call.toggleCam} />
          </>
        )}
        <Ctl icon="happy-outline" label="Send a reaction" on={reactOpen} disabled={!call.connected && !hlsAudience} onPress={() => { setMoreOpen(false); setReactOpen((v) => !v); }} />
        {p.amMicHolder ? (
          <Ctl icon="mic" label="Give up the mic" on onTint="#1f9d55" onPress={p.onStepDown} />
        ) : (
          <Ctl icon="hand-left-outline" label={p.handRaised ? "Lower your hand" : p.requestsLocked ? "Speaker requests are locked" : "Raise your hand to request to speak"} on={p.handRaised} disabled={!p.canRaise || p.requestsLocked || p.handBusy} onPress={p.onToggleHand} />
        )}
        <Ctl icon="chatbubble-ellipses-outline" label="Chat" onPress={p.onChat} badge={p.chatBadge} />
        <Ctl icon="ellipsis-vertical" label="More options" on={moreOpen} onPress={() => { setReactOpen(false); setMoreOpen((v) => !v); }} />
        <Ctl icon="call" label="Leave the room" on onTint={colors.red} onPress={p.onLeave} />
      </View>
      <MoreDrawer open={moreOpen} onClose={() => setMoreOpen(false)} bottom={bottom} hlsAudience={hlsAudience} duel={p.duel} layout={p.layout} onLayout={p.onLayout} onSettings={p.onSettings} onCopyLink={p.onCopyLink} />
    </>
  );
}

const TOOLS: { icon: Icon; label: string }[] = [{ icon: "easel-outline", label: "Whiteboard" }, { icon: "reader-outline", label: "Notepad" }, { icon: "document-text-outline", label: "Documents" }];

function MoreDrawer({ open, onClose, bottom, hlsAudience, duel, layout, onLayout, onSettings, onCopyLink }: { open: boolean; onClose: () => void; bottom: number; hlsAudience: boolean; duel: boolean; layout: Layout; onLayout: (l: Layout) => void; onSettings: () => void; onCopyLink: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!open) setCopied(false); }, [open]);
  if (!open) return null;
  const seg = (l: Layout, icon: Icon, label: string) => (
    <Pressable key={l} onPress={() => onLayout(l)} accessibilityLabel={label} style={{ flex: 1, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: layout === l ? "#26262e" : "transparent" }}>
      <Ionicons name={icon} size={15} color={layout === l ? colors.text : colors.muted} />
      <Text style={{ color: layout === l ? colors.text : colors.muted, fontFamily: fonts.semi, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
  return (
    <Pressable onPress={onClose} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} accessibilityLabel="Close">
      <Pressable onPress={() => undefined} style={{ position: "absolute", left: 10, right: 10, bottom: bottom + CONTROLS_H + 8, borderRadius: 16, backgroundColor: "#0e0e11", borderWidth: 1, borderColor: "#2a2a33", padding: 10 }}>
        {!hlsAudience && !duel && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 10, marginBottom: 10, borderBottomWidth: 1, borderColor: "#1f1f26" }}>
            <Text style={{ color: "#8a8f9c", fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.4 }}>Layout</Text>
            <View style={{ flex: 1, flexDirection: "row", height: 40, borderRadius: 10, backgroundColor: "#141418", padding: 2 }}>
              {seg("gallery", "grid-outline", "Gallery")}
              {seg("multi", "people-outline", "Multi-speaker")}
            </View>
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {TOOLS.map((t) => (
            <View key={t.label} style={{ flex: 1, minHeight: 74, borderRadius: 12, backgroundColor: "#141418", borderWidth: 1, borderColor: "#1f1f26", alignItems: "center", justifyContent: "center", gap: 5, opacity: 0.55 }}>
              <Ionicons name={t.icon} size={22} color={colors.soft} />
              <Text style={{ color: colors.soft, fontFamily: fonts.semi, fontSize: 11 }}>{t.label}</Text>
              <Text style={{ color: colors.gold, fontFamily: fonts.semi, fontSize: 9, letterSpacing: 0.6, position: "absolute", top: 6, right: 8 }}>SOON</Text>
            </View>
          ))}
          <Pressable onPress={() => { onClose(); setTimeout(onSettings, 60); }} style={({ pressed }) => ({ flex: 1, minHeight: 74, borderRadius: 12, backgroundColor: pressed ? "#1b1b21" : "#141418", borderWidth: 1, borderColor: "#1f1f26", alignItems: "center", justifyContent: "center", gap: 5 })}>
            <Ionicons name="settings-outline" size={22} color={colors.text} />
            <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 11 }}>Settings</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => { onCopyLink(); setCopied(true); setTimeout(() => setCopied(false), 1600); }} style={({ pressed }) => ({ marginTop: 10, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#1b1b21" : "#141418", borderWidth: 1, borderColor: "#1f1f26" })}>
          <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 12.5 }}>{copied ? "Copied" : "Copy room link"}</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

/** The layout choice, remembered on this phone like the site's localStorage key. */
const LAYOUT_KEY = "agora:call-layout";
export function useSavedLayout(): [Layout, (l: Layout) => void] {
  const [layout, setLayoutState] = useState<Layout>("gallery");
  useEffect(() => {
    AsyncStorage.getItem(LAYOUT_KEY).then((v) => { if (v === "gallery" || v === "multi") setLayoutState(v); }, () => undefined);
  }, []);
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    AsyncStorage.setItem(LAYOUT_KEY, l).catch(() => undefined);
  };
  return [layout, setLayout];
}

export async function copyRoomLink(link: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
    await Clipboard.setStringAsync(link);
    showToast("Room link copied");
  } catch {
    showToast("Could not copy link");
  }
}

/** A modal drawn over everything else (the sheets are Modals, so the tray and drawer must be too when a sheet is up). */
export function Scrim({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}>{children}</Pressable>
    </Modal>
  );
}
