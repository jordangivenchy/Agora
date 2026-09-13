/* The door, then the site's phone shell: its tab bar under the screens,
   the mini-player above it while a call is on, and the Create sheet. */
import { useState } from "react";
import { Redirect, Tabs } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { MiniPlayer } from "../../src/miniPlayer";
import { AppTabBar, TAB_BAR_HEIGHT } from "../../src/tabBar";
import { ActionSheet } from "../../src/actionSheet";
import { openWeb } from "../../src/web";
import { colors } from "../../src/theme";
import { Spinner } from "../../src/ui";

export default function TabsLayout() {
  const { ready, session, pass, gated, guest } = useSession();
  const insets = useSafeAreaInsets();
  const [creating, setCreating] = useState(false);
  if (!ready) return <Spinner />;
  if (gated && !pass) return <Redirect href="/beta" />;
  if (!session && !guest) return <Redirect href="/sign-in" />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
        tabBar={(props) => <AppTabBar state={props.state} navigation={props.navigation} onCreate={() => setCreating(true)} />}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="feed" />
        <Tabs.Screen name="explore" />
        <Tabs.Screen name="communities" />
        <Tabs.Screen name="trending" />
        <Tabs.Screen name="news" />
      </Tabs>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: TAB_BAR_HEIGHT + insets.bottom }}>
        <MiniPlayer />
      </View>
      <ActionSheet
        open={creating}
        title="Create"
        sub="Rooms and posts are made on the web for now."
        onClose={() => setCreating(false)}
        actions={[
          { label: "New room", primary: true, onPress: () => { setCreating(false); openWeb("/?create=1"); } },
          { label: "New post", onPress: () => { setCreating(false); openWeb("/?create=1"); } },
        ]}
      />
    </View>
  );
}
