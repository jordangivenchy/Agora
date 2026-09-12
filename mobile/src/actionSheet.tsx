/* A sheet from the bottom with a few choices, on a solid card. */
import { Modal, Pressable, Text, View } from "react-native";
import { colors } from "./theme";

export interface SheetAction {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
}

export function ActionSheet({ open, title, sub, actions, onClose }: { open: boolean; title: string; sub?: string; actions: SheetAction[]; onClose: () => void }) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, paddingBottom: 28 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>{title}</Text>
          {sub && <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>{sub}</Text>}
          <View style={{ height: 12 }} />
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => {
                onClose();
                a.onPress();
              }}
              style={({ pressed }) => ({
                height: 46, borderRadius: 999, alignItems: "center", justifyContent: "center", marginBottom: 8,
                backgroundColor: a.primary ? colors.yellow : colors.surface2, borderWidth: 1, borderColor: a.primary ? colors.yellow : a.danger ? colors.red : colors.border,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: a.primary ? colors.ink : colors.text, fontSize: 14.5, fontWeight: "700" }}>{a.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={{ height: 40, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.muted, fontSize: 13.5, fontWeight: "600" }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
