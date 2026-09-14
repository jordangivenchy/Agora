/* The phone action sheet the site opens on a post or a comment
   (components/community/ActionSheet.tsx): solid, from the bottom, a
   handle, the title small and grey, one row per action with its icon,
   Cancel underneath. An action runs once the sheet has gone (sheetModal.tsx
   reports it), so whatever it presents — another sheet, an alert, a
   screen — isn't dropped while this modal is still leaving, and doesn't
   wait any longer than that. */
import { useRef } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SheetModal } from "./sheetModal";
import { fonts } from "./theme";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export interface SheetItem {
  icon: IconName;
  label: string;
  run: () => void;
  danger?: boolean;
}

export const AFTER_SHEET_MS = 320;

export function ItemSheet({ open, title, items, onClose }: { open: boolean; title?: string; items: SheetItem[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const pending = useRef<(() => void) | null>(null);
  /* What it showed stays while it leaves: callers clear their items as they close it. */
  const held = useRef({ title, items });
  if (open) held.current = { title, items };
  const shown = open ? { title, items } : held.current;
  const gone = () => {
    const run = pending.current;
    pending.current = null;
    if (run) setTimeout(run, 30);
  };
  return (
    <SheetModal open={open} onClose={onClose} onGone={gone}>
      <View accessibilityRole="menu" style={{ backgroundColor: "#0b0b0d", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: 1, borderColor: "#232329", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 + insets.bottom, maxHeight: Math.round(height * 0.8) }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#3a3a42", alignSelf: "center", marginTop: 2, marginBottom: 10 }} />
        {!!shown.title && <Text numberOfLines={1} style={{ color: "#7d7d88", fontFamily: fonts.body, fontSize: 12, paddingHorizontal: 10, marginBottom: 6 }}>{shown.title}</Text>}
        <ScrollView bounces={false}>
          {shown.items.map((it) => (
            <Pressable
              key={it.label}
              accessibilityRole="menuitem"
              onPress={() => {
                pending.current = it.run;
                onClose();
              }}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, height: 48, paddingHorizontal: 10, borderRadius: 12, backgroundColor: pressed ? "#17171c" : "transparent" })}
            >
              <Ionicons name={it.icon} size={18} color={it.danger ? "#ff8a80" : "#eeeef5"} />
              <Text style={{ color: it.danger ? "#ff8a80" : "#eeeef5", fontFamily: fonts.semi, fontSize: 15 }}>{it.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable onPress={onClose} style={({ pressed }) => ({ marginTop: 6, height: 44, borderRadius: 999, backgroundColor: pressed ? "#111114" : "#000", borderWidth: 1, borderColor: "#2b2b31", alignItems: "center", justifyContent: "center" })}>
          <Text style={{ color: "#c9c9d2", fontFamily: fonts.bold, fontSize: 14 }}>Cancel</Text>
        </Pressable>
      </View>
    </SheetModal>
  );
}
