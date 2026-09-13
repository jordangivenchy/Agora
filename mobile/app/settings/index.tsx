/* Settings: the site's list of sections on a phone; each opens its
   panel. Moderators get the report queue at the end. */
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "../../src/session";
import { useMe } from "../../src/me";
import { colors, fonts } from "../../src/theme";
import { Button, Screen, Sub, Title } from "../../src/ui";

export type SectionKey = "profile" | "account" | "discussion" | "recordings" | "notifications" | "appearance" | "privacy" | "data" | "blocked" | "danger";

export const SECTIONS: { key: SectionKey; label: string; sub: string }[] = [
  { key: "profile", label: "Profile", sub: "Name, username, bio, avatar" },
  { key: "account", label: "Account & security", sub: "Email, password, sessions" },
  { key: "discussion", label: "Discussion defaults", sub: "Mic and camera on join" },
  { key: "recordings", label: "Recordings & storage", sub: "VODs of your discussions, storage space" },
  { key: "notifications", label: "Notifications", sub: "What you get notified about" },
  { key: "appearance", label: "Appearance & motion", sub: "Animation preferences" },
  { key: "privacy", label: "Privacy", sub: "What others see" },
  { key: "data", label: "Data & Coach", sub: "Your data controls; the coach is coming soon" },
  { key: "blocked", label: "Blocked users", sub: "Manage your block list" },
  { key: "danger", label: "Danger zone", sub: "Delete your account" },
];

export default function Settings() {
  const { session } = useSession();
  const me = useMe();
  if (!session) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Settings" }} />
        <View style={{ paddingTop: 24 }}>
          <Title>Settings are for members</Title>
          <Sub>Sign in to change your profile, your account and what you get notified about.</Sub>
          <Button onPress={() => router.replace("/sign-in")}>Sign in</Button>
        </View>
      </Screen>
    );
  }
  return (
    <Screen style={{ paddingHorizontal: 12 }}>
      <Stack.Screen options={{ title: "Settings" }} />
      <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}>
        {SECTIONS.map((s) => (
          <Pressable
            key={s.key}
            onPress={() => router.push({ pathname: "/settings/[section]", params: { section: s.key } })}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, marginBottom: 4, backgroundColor: pressed ? "#16161c" : "transparent" })}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: s.key === "danger" ? "#fca5a5" : colors.text, fontFamily: fonts.medium, fontSize: 14 }}>{s.label}</Text>
              <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11, marginTop: 2 }}>{s.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.faint} />
          </Pressable>
        ))}
        {me?.is_moderator && (
          <Pressable
            onPress={() => router.push("/mod")}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, marginTop: 6, borderWidth: 1, borderColor: "#4a3f1f", backgroundColor: pressed ? "#16161c" : "transparent" })}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.gold, fontFamily: fonts.medium, fontSize: 14 }}>Moderation</Text>
              <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11, marginTop: 2 }}>Open the report queue</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.faint} />
          </Pressable>
        )}
      </ScrollView>
    </Screen>
  );
}
