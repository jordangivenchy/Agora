/* The door, then the three tabs. Past the gate and signed in, you land
   on Live; otherwise the door sends you to the key or to sign-in. The
   mini-player sits above the tab bar while a call is on. */
import { Redirect, Tabs } from "expo-router";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "../../src/session";
import { MiniPlayer } from "../../src/miniPlayer";
import { colors } from "../../src/theme";
import { Spinner } from "../../src/ui";

export default function TabsLayout() {
  const { ready, session, pass, gated } = useSession();
  if (!ready) return <Spinner />;
  if (gated && !pass) return <Redirect href="/beta" />;
  if (!session) return <Redirect href="/sign-in" />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "800" },
          headerShadowVisible: false,
          sceneStyle: { backgroundColor: colors.bg },
          tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
          tabBarActiveTintColor: colors.yellow,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Live", tabBarIcon: ({ color, size }) => <Ionicons name="radio-outline" color={color} size={size} /> }} />
        <Tabs.Screen name="queue" options={{ title: "Queue", tabBarIcon: ({ color, size }) => <Ionicons name="swap-horizontal-outline" color={color} size={size} /> }} />
        <Tabs.Screen name="you" options={{ title: "You", tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color} size={size} /> }} />
      </Tabs>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 56 }}>
        <MiniPlayer />
      </View>
    </View>
  );
}
