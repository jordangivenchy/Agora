/* The broadcast (components/agora/HlsPlayer.tsx): over the audience
   ceiling the room is watched as its composited stream — the phone
   plays HLS natively, chasing the live edge. */
import { useEffect } from "react";
import { Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { colors, fonts } from "./theme";

export function BroadcastView({ url, height }: { url: string; height: number }) {
  const player = useVideoPlayer({ uri: url }, (pl) => {
    pl.loop = false;
    pl.play();
  });
  useEffect(() => {
    player.replace({ uri: url });
    player.play();
  }, [player, url]);
  return (
    <View style={{ height, borderRadius: 12, overflow: "hidden", backgroundColor: "#000", borderWidth: 1, borderColor: "#2a2a33" }}>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} allowsPictureInPicture />
      <View style={{ position: "absolute", left: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: "#0a0a0c" }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.live }} />
        <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 10.5 }}>Broadcast · a few seconds behind</Text>
      </View>
    </View>
  );
}
