/* A section the app hasn't rebuilt yet: its name, what it is, and the
   way to it on the web. Each gets replaced as the native version lands. */
import { Pressable, Text, View } from "react-native";
import { HomeHeader } from "./header";
import { openWeb } from "./web";
import { colors, fonts } from "./theme";

export function WebSection({ title, blurb, path }: { title: string; blurb: string; path: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HomeHeader />
      <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 22, letterSpacing: -0.3 }}>{title}</Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, marginTop: 8 }}>{blurb}</Text>
        <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, marginTop: 10 }}>Coming to the app in a later step. It's on the web for now.</Text>
        <Pressable
          onPress={() => openWeb(path)}
          style={({ pressed }) => ({ marginTop: 16, height: 42, paddingHorizontal: 20, borderRadius: 21, alignSelf: "flex-start", alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#ffc22e" : colors.yellow })}
        >
          <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 14.5 }}>Open on agorasphere.net</Text>
        </Pressable>
      </View>
    </View>
  );
}
