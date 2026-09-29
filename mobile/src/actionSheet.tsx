/* A sheet from the bottom with a few choices, on a solid card. When the
   title (or the line under it) names a person, their verified mark rides
   after it. */
import { Modal, Pressable, Text, View } from "react-native";
import { VerifiedMark } from "./verifiedMark";
import { colors } from "./theme";

export interface SheetAction {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
}

type Who = { id?: string | null; username?: string | null } | null | undefined;

export function ActionSheet({ open, title, sub, titlePerson, subPerson, actions, onClose }: {
  open: boolean;
  title: string;
  sub?: string;
  /** The person the title names, for the mark after it. */
  titlePerson?: Who;
  /** The person the line under the title names ("Hosted by …"). */
  subPerson?: Who;
  actions: SheetAction[];
  onClose: () => void;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, paddingBottom: 28 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Text style={{ flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: "800" }}>{title}</Text>
            {titlePerson && <VerifiedMark id={titlePerson.id} username={titlePerson.username} size={16} />}
          </View>
          {sub && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
              <Text style={{ flexShrink: 1, color: colors.muted, fontSize: 12.5 }}>{sub}</Text>
              {subPerson && <VerifiedMark id={subPerson.id} username={subPerson.username} size={12} />}
            </View>
          )}
          <View style={{ height: 12 }} />
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => {
                onClose();
                /* After the sheet is down: anything the action presents
                   (a browser, another sheet) is dropped while this Modal
                   is still dismissing. */
                setTimeout(a.onPress, 280);
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
