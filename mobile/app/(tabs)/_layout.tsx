/* The door, then the site's phone shell: its tab bar under the screens,
   the mini-player above it while a call is on, and the Create sheet. */
import { Redirect, Tabs } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { MiniPlayer } from "../../src/miniPlayer";
import { QueueDock } from "../../src/queue";
import { AppTabBar, TAB_BAR_HEIGHT } from "../../src/tabBar";
import { useCreate } from "../../src/create";
import { colors } from "../../src/theme";
import { Spinner } from "../../src/ui";

export default function TabsLayout() {
  const { ready, session, pass, gated, guest } = useSession();
  const insets = useSafeAreaInsets();
  const { openMenu } = useCreate();
  if (!ready) return <Spinner />;
  if (gated && !pass) return <Redirect href="/beta" />;
  if (!session && !guest) return <Redirect href="/sign-in" />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        /* A tab you've left stops rendering until you come back to it.
           Every tab stays mounted, so without this a realtime row — a
           message arriving, a room going live — re-renders all six, and
           it lands in the middle of whatever transition is running. */
        screenOptions={{ headerShown: false, freezeOnBlur: true, sceneStyle: { backgroundColor: colors.bg } }}
        tabBar={(props) => <AppTabBar state={props.state} navigation={props.navigation} onCreate={openMenu} />}
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
      <QueueDock bottom={TAB_BAR_HEIGHT + insets.bottom} />
    </View>
  );
}
