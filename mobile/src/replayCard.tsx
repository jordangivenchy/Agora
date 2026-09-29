/* A past discussion in a list, the way a video sits in one: the picture
   at 16:9 with how long it ran in its bottom-right corner, the motion,
   then the host with their mark and "12 views · 3 days ago". The length
   pill stands on its own too, for the lists that draw their own
   pictures (trending, a profile's discussions, the feed). */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Img } from "./img";
import { VerifiedMark } from "./verifiedMark";
import { replayLength, viewsAndAgo, type ReplayStamps } from "./duration";
import { fonts } from "./theme";

export interface ReplayListRoom extends ReplayStamps {
  id: string;
  motion: string | null;
  thumbnail_url: string | null;
  replay_views?: number | null;
  recording_url: string | null;
  host: { id?: string | null; username: string | null; display_name: string | null; avatar_url: string | null } | null;
}

/** How long it ran, in the bottom-right corner of the picture it sits on (the picture is the positioned parent). */
export function LengthPill({ room, inset = 6 }: { room: ReplayStamps; inset?: number }) {
  const length = replayLength(room);
  if (!length) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", right: inset, bottom: inset, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: "#0b0b0d" }}>
      <Text style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 11, fontVariant: ["tabular-nums"] }}>{length}</Text>
    </View>
  );
}

export function ReplayCard({ room: r, width, onPress }: { room: ReplayListRoom; width: number; onPress: () => void }) {
  const img = r.thumbnail_url || r.host?.avatar_url || null;
  const host = r.host;
  const name = host ? host.display_name?.trim() || (host.username ? `@${host.username}` : "") : "";
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ width, opacity: pressed ? 0.85 : 1 })}>
      <View style={{ width, height: Math.round((width * 9) / 16), borderRadius: 10, overflow: "hidden", backgroundColor: "#15151c", borderWidth: StyleSheet.hairlineWidth, borderColor: "#2c2c34", alignItems: "center", justifyContent: "center" }}>
        {img ? <Img uri={img} style={{ width: "100%", height: "100%" }} recyclingKey={r.id} /> : <Ionicons name="play" size={18} color="#4a4a54" />}
        <LengthPill room={r} />
      </View>
      <Text numberOfLines={2} style={{ color: "#e5e5ec", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, marginTop: 8 }}>{r.motion || "Discussion"}</Text>
      {!!name && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: "#8b8b94", fontFamily: fonts.body, fontSize: 11 }}>{name}</Text>
          <VerifiedMark id={host?.id} username={host?.username} size={11} />
        </View>
      )}
      <Text numberOfLines={1} style={{ color: "#8b8b94", fontFamily: fonts.body, fontSize: 11, marginTop: 1 }}>{viewsAndAgo(r.replay_views, r, !!r.recording_url)}</Text>
    </Pressable>
  );
}
