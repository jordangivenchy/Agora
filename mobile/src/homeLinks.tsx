/* Explore and Trending, at the top of Home. They were tabs until the
   bar became Apple's, which holds five things; these are the two that
   moved, and each opens as a page with a way back. */
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { IconName } from "./topics";
import { colors, fonts } from "./theme";

const LINKS: { href: "/explore" | "/trending"; label: string; icon: IconName }[] = [
  { href: "/explore", label: "Explore", icon: "compass-outline" },
  { href: "/trending", label: "Trending", icon: "flame-outline" },
];

export function HomeLinks() {
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 }}>
      {LINKS.map((l) => (
        <Pressable
          key={l.href}
          onPress={() => router.push(l.href)}
          accessibilityRole="link"
          accessibilityLabel={l.label}
          style={({ pressed }) => ({
            flex: 1, height: 36, borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
            backgroundColor: pressed ? colors.surface2 : colors.surface, borderWidth: 1, borderColor: colors.border,
          })}
        >
          <Ionicons name={l.icon} size={16} color={colors.yellow} />
          <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13 }}>{l.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
