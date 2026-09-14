/* The news strip under the hero: the stories the hero didn't take,
   rolling past twice over so the loop never shows a seam. No rules
   above or below: it sits straight on the page. */
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import type { NewsStory } from "./home";
import { openUrl } from "./web";
import { colors, fonts } from "./theme";

const SPEED = 40; // points per second

export function NewsTicker({ stories }: { stories: NewsStory[] }) {
  const x = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!w) return;
    x.setValue(0);
    const anim = Animated.loop(Animated.timing(x, { toValue: -w, duration: (w / SPEED) * 1000, easing: Easing.linear, useNativeDriver: true }));
    anim.start();
    return () => anim.stop();
  }, [w, x]);
  if (!stories.length) return null;
  const items = (tag: string) =>
    stories.map((s) => (
      <Pressable key={`${tag}:${s.id}`} onPress={() => s.url && openUrl(s.url)} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 28 }}>
        <Text style={{ color: "#eaeaf0", fontFamily: fonts.medium, fontSize: 13.5 }}>{s.headline}</Text>
        {s.sources[0] && <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>{s.sources[0].name}</Text>}
        {s.url && <Text style={{ color: colors.yellow, fontFamily: fonts.bold, fontSize: 12.5 }}>Read at {s.sources[0]?.name ?? "the source"} ↗</Text>}
      </Pressable>
    ));
  return (
    <View style={{ height: 48, justifyContent: "center", overflow: "hidden", backgroundColor: colors.surface }}>
      <Animated.View style={{ flexDirection: "row", paddingLeft: 14, transform: [{ translateX: x }] }}>
        <View style={{ flexDirection: "row" }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>{items("a")}</View>
        <View style={{ flexDirection: "row" }}>{items("b")}</View>
      </Animated.View>
    </View>
  );
}
