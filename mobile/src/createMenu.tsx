/* The Create menu: a small Liquid Glass panel that rises out of the +
   in the tab bar and sits just above it — Create a Discussion, Write a
   post, New community. It used to be a sheet across the foot of the
   screen; a three-row menu belongs next to the button that opened it.

   Glass because it floats over the page (glass.tsx has the rule), with
   the material's own answer to a touch; where there is no glass, the
   solid panel the app's other menus are. A tap anywhere else puts it
   away.

   The panel grows and its words fade in, but the glass itself is never
   faded: its material is turned on as the menu opens and off as it goes
   (glass.tsx, `present`). Faded in from nothing, the glass was there the
   first time and missing the next — the words alone over the page.

   It is drawn over the tabs, not in a modal of its own, and that is
   what lets it hand over in one motion: a row opens a sheet (which is a
   modal), and iOS won't present one modal while another is on its way
   out. As a modal, this menu first dropped the sheet altogether, then
   had to finish leaving before the sheet could start — a dead beat
   between the two. As a plain layer, the sheet starts the moment a row
   is tapped, its backdrop fading in over the page while the menu melts
   back into the + beneath it. */
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Glass, glassAvailable } from "./glass";
import { tabBarTop } from "./tabBar";
import { useReduceMotion } from "./motion";
import type { IconName } from "./topics";
import { colors, fonts } from "./theme";

export interface CreateMenuItem {
  icon: IconName;
  label: string;
  run: () => void;
}

/* How long it takes to go, and the gap it keeps above the bar. */
const LEAVE_MS = 160;
const ABOVE_BAR = 10;

export function CreateMenu({ open, items, onClose }: { open: boolean; items: CreateMenuItem[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const still = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;
  /* Kept on screen while it leaves. */
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  /* On screen and laid out: its material can be turned on. */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (open) {
      void Haptics.selectionAsync().catch(() => undefined);
      /* A frame after it mounts: an animation started in the same moment
         its view appears never drew on iOS (sheetModal.tsx), and the
         glass is laid out before its material is asked for. */
      const frame = requestAnimationFrame(() => {
        setReady(true);
        if (still) Animated.timing(t, { toValue: 1, duration: 120, useNativeDriver: true }).start();
        else Animated.spring(t, { toValue: 1, damping: 16, stiffness: 260, mass: 0.7, useNativeDriver: true }).start();
      });
      return () => cancelAnimationFrame(frame);
    }
    const leave = Animated.timing(t, { toValue: 0, duration: LEAVE_MS, useNativeDriver: true });
    leave.start(({ finished }) => { if (finished) { setShown(false); setReady(false); } });
    return () => leave.stop();
  }, [open, still, t]);

  if (!shown) return null;

  /* It grows from its foot, where the + is. */
  const scale = still ? 1 : t.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });
  const translateY = still ? 0 : t.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const opacity = t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1], extrapolate: "clamp" });
  /* The fade is on the words where there is glass (which has its own way
     in), and on the whole panel where there isn't. */
  const panelOpacity = glassAvailable ? 1 : opacity;
  const wordsOpacity = glassAvailable ? opacity : 1;

  return (
    /* Over the whole screen, the bar included; out of the way of touches
       as soon as it starts to leave. */
    <View pointerEvents={open ? "box-none" : "none"} style={StyleSheet.absoluteFill}>
      <Pressable onPress={onClose} accessibilityLabel="Close the Create menu" style={StyleSheet.absoluteFill} />
      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: tabBarTop(insets.bottom) + ABOVE_BAR, alignItems: "center" }}>
        <Animated.View style={{ opacity: panelOpacity, transform: [{ translateY }, { scale }], transformOrigin: "bottom" }}>
          <Glass
            interactive
            present={open && ready}
            presentSeconds={open ? 0.22 : LEAVE_MS / 1000}
            fallback="#0e0e11"
            fallbackStyle={{ borderWidth: 1, borderColor: "#23232b" }}
            accessibilityRole="menu"
            accessibilityViewIsModal
            style={{ width: 236, borderRadius: 26, padding: 6, overflow: "hidden" }}
          >
            <Animated.View style={{ opacity: wordsOpacity }}>
              {items.map((it) => (
                <Pressable
                  key={it.label}
                  accessibilityRole="menuitem"
                  accessibilityLabel={it.label}
                  /* Together: the row's sheet comes up as this goes. */
                  onPress={() => { onClose(); it.run(); }}
                  style={{ height: 46, borderRadius: 20, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 }}
                >
                  {({ pressed }) => (
                    <>
                      <Ionicons name={it.icon} size={19} color={colors.text} style={{ opacity: pressed ? 0.5 : 1 }} />
                      <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 15, opacity: pressed ? 0.5 : 1 }}>{it.label}</Text>
                    </>
                  )}
                </Pressable>
              ))}
            </Animated.View>
          </Glass>
        </Animated.View>
      </View>
    </View>
  );
}
