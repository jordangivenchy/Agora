/* The Create menu: a small Liquid Glass panel that rises out of the +
   in the tab bar and sits just above it — Create a Discussion, Write a
   post, New community. It used to be a sheet across the foot of the
   screen; a three-row menu belongs next to the button that opened it.

   Glass because it floats over the page (glass.tsx has the rule), with
   the material's own answer to a touch; where there is no glass, the
   solid panel the app's other menus are. A tap anywhere else puts it
   away. What a row opens is another sheet, so it runs once this one has
   gone, as the avatar's menu does (dropdown.tsx). */
import { useEffect, useRef, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Glass } from "./glass";
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

  useEffect(() => {
    if (open) {
      void Haptics.selectionAsync().catch(() => undefined);
      if (still) Animated.timing(t, { toValue: 1, duration: 120, useNativeDriver: true }).start();
      else Animated.spring(t, { toValue: 1, damping: 16, stiffness: 260, mass: 0.7, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(t, { toValue: 0, duration: LEAVE_MS, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setShown(false);
    });
  }, [open, still, t]);

  /* It grows from its foot, where the + is. */
  const scale = still ? 1 : t.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });
  const translateY = still ? 0 : t.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const opacity = t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1], extrapolate: "clamp" });

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={onClose}>
      <Pressable onPress={onClose} accessibilityLabel="Close the Create menu" style={StyleSheet.absoluteFill} />
      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: tabBarTop(insets.bottom) + ABOVE_BAR, alignItems: "center" }}>
        <Animated.View style={{ opacity, transform: [{ translateY }, { scale }], transformOrigin: "bottom" }}>
          <Glass
            interactive
            fallback="#0e0e11"
            fallbackStyle={{ borderWidth: 1, borderColor: "#23232b" }}
            accessibilityRole="menu"
            accessibilityViewIsModal
            style={{ width: 236, borderRadius: 26, padding: 6, overflow: "hidden" }}
          >
            {items.map((it) => (
              <Pressable
                key={it.label}
                accessibilityRole="menuitem"
                accessibilityLabel={it.label}
                onPress={() => { onClose(); setTimeout(it.run, LEAVE_MS); }}
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
          </Glass>
        </Animated.View>
      </View>
    </Modal>
  );
}
