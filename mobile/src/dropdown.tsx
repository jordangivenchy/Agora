/* The site's avatar dropdown (mvp-home.css .avatar-dropdown): a 230-wide
   near-black panel that drops from under the avatar, top right, with
   your name up top, the items, a divider, and Log out in red. Tap
   anywhere else to close. */
import { useEffect, useRef, type ComponentProps } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "./theme";

type IconName = ComponentProps<typeof Ionicons>["name"];
export interface DropdownItem { label: string; icon: IconName; onPress: () => void; danger?: boolean; dividerAbove?: boolean }

export function Dropdown({ open, onClose, top, right = 16, name, sub, items }: {
  open: boolean;
  onClose: () => void;
  /** Where the panel's top edge sits, in points from the screen's top. */
  top: number;
  right?: number;
  name: string;
  sub?: string;
  items: DropdownItem[];
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!open) { t.setValue(0); return; }
    Animated.timing(t, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [open, t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] });
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
      <Animated.View
        style={{
          position: "absolute", top, right, width: 230, borderRadius: 14, padding: 6,
          backgroundColor: colors.surface, borderWidth: 1, borderColor: "#23232b",
          shadowColor: "#000", shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 18 },
          opacity: t, transform: [{ scale }, { translateY }],
        }}
      >
        <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 11, borderBottomWidth: 1, borderColor: colors.hairline, marginBottom: 5 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 13.5 }}>{name}</Text>
          {!!sub && <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11, marginTop: 1 }}>{sub}</Text>}
        </View>
        {items.map((it) => (
          <View key={it.label}>
            {it.dividerAbove && <View style={{ height: 1, backgroundColor: colors.hairline, marginVertical: 5, marginHorizontal: 6 }} />}
            <Pressable
              onPress={() => { onClose(); setTimeout(it.onPress, 160); }}
              accessibilityRole="menuitem"
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: pressed ? (it.danger ? "#2a1414" : "#1a1a20") : "transparent" })}
            >
              {({ pressed }) => (
                <>
                  <View style={{ width: 18, alignItems: "center", opacity: 0.85 }}>
                    <Ionicons name={it.icon} size={14} color={it.danger ? "#f08a8a" : pressed ? colors.text : colors.muted} />
                  </View>
                  <Text style={{ color: it.danger ? "#f08a8a" : pressed ? colors.text : colors.muted, fontFamily: fonts.medium, fontSize: 13 }}>{it.label}</Text>
                </>
              )}
            </Pressable>
          </View>
        ))}
      </Animated.View>
    </Modal>
  );
}
