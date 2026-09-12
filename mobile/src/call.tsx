/* The web preview has no native audio; the phone build uses call.native.tsx. */
import { Text, View } from "react-native";
import type { CallProps } from "./callTypes";
import { colors } from "./theme";
import { Button } from "./ui";

export function Call({ onLeave }: CallProps) {
  return (
    <View style={{ padding: 16, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>Live audio runs in the iPhone and Android app. This web preview shows everything around it.</Text>
      <View style={{ height: 12 }} />
      <Button kind="secondary" onPress={onLeave}>Back</Button>
    </View>
  );
}
