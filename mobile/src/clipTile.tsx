/* One clip in a grid (components/clips/ClipTile.tsx): the picture or
   the clip's colours, the duration, the title, who clipped it, views. */
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "./avatar";
import { clipColors, formatClipDuration, formatViews, type ClipTileData } from "./clips";
import { colors, fonts } from "./theme";

export function ClipTile({ clip, width, onPress }: { clip: ClipTileData; width: number; onPress: () => void }) {
  const duration = formatClipDuration(clip.duration_seconds);
  const [c0, c1] = clipColors(clip.id, clip.thumb_gradient);
  const who = clip.uploader ? clip.uploader.display_name?.trim() || clip.uploader.username : null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ width, opacity: pressed ? 0.88 : 1 })}>
      <View style={{ width, height: Math.round((width * 9) / 16), borderRadius: 10, overflow: "hidden", backgroundColor: c0 }}>
        {clip.thumbnail_url ? <Image source={{ uri: clip.thumbnail_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : <View style={{ position: "absolute", right: -20, bottom: -20, width: width * 0.8, height: width * 0.8, borderRadius: width, backgroundColor: c1, opacity: 0.8 }} />}
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#000", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", alignItems: "center", justifyContent: "center" }}><Ionicons name="play" size={13} color="#fff" style={{ marginLeft: 2 }} /></View>
        </View>
        {duration && <View style={{ position: "absolute", right: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: "#000" }}><Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 11 }}>{duration}</Text></View>}
      </View>
      <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13, lineHeight: 17, marginTop: 7 }}>{clip.title || "Clip"}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
        {clip.uploader && <Avatar url={clip.uploader.avatar_url} name={clip.uploader.username} size={16} />}
        {who && <Text numberOfLines={1} style={{ flexShrink: 1, color: "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: 11.5 }}>{who}</Text>}
        {who && <Text style={{ color: "#3a3a42" }}>·</Text>}
        <Text style={{ color: "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: 11.5 }}>{formatViews(clip.view_count)}</Text>
      </View>
    </Pressable>
  );
}
