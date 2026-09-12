/* The bar above the tabs while a call is on: the room's title, the mic
   for speakers, Leave. Tap it to go back to the room. */
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useCall } from "./callSession";
import { MicButton } from "./stage";
import { colors } from "./theme";

export function MiniPlayer() {
  const { active, leave } = useCall();
  if (!active) return null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/room/[id]", params: { id: active.roomId } })}
      style={{
        flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 10, marginBottom: 6, padding: 10, paddingLeft: 12,
        borderRadius: 14, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13.5, fontWeight: "700" }}>{active.motion}</Text>
        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11.5 }}>Listening · {active.hostName}</Text>
      </View>
      <MicButton compact />
      <Pressable onPress={leave} hitSlop={8} style={{ paddingHorizontal: 12, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.red }}>
        <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: "700" }}>Leave</Text>
      </Pressable>
    </Pressable>
  );
}
