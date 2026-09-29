/* The bar above the tabs while a call is on: the room's title, the host
   with their verified mark, the mic for speakers, Leave. Tap it to go
   back to the room. */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "./supabase";
import { useCall } from "./callSession";
import { MicButton } from "./stage";
import { VerifiedMark } from "./verifiedMark";
import { colors } from "./theme";

export function MiniPlayer() {
  const { active, leave } = useCall();
  /* The call carries only the host's name; who they are comes from the room, for the mark. */
  const roomId = active?.roomId ?? null;
  const [hostId, setHostId] = useState<string | null>(null);
  useEffect(() => {
    setHostId(null);
    if (!roomId) return;
    let live = true;
    void supabase.from("debate_rooms").select("host_id").eq("id", roomId).maybeSingle().then(({ data }) => {
      if (live) setHostId((data as { host_id?: string | null } | null)?.host_id ?? null);
    });
    return () => { live = false; };
  }, [roomId]);
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.muted, fontSize: 11.5 }}>Listening · {active.hostName}</Text>
          <VerifiedMark id={hostId} size={11} />
        </View>
      </View>
      <MicButton compact />
      <Pressable onPress={leave} hitSlop={8} style={{ paddingHorizontal: 12, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.red }}>
        <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: "700" }}>Leave</Text>
      </Pressable>
    </Pressable>
  );
}
