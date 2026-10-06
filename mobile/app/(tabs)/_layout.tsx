/* The door, then the phone shell: Apple's own tab bar under the screens,
   the mini-player above it while a call is on, and the Create sheet.

   The bar is the system's (NativeTabs), so on iOS 26 it is the Liquid
   Glass capsule, and its selection lifts into a lens under a press and
   follows a finger along it. It holds five things on a phone: Home,
   Feed, the yellow +, Communities and News. Explore and Trending open
   from the top of Home (src/homeLinks.tsx). */
import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { MiniPlayer } from "../../src/miniPlayer";
import { QueueDock } from "../../src/queue";
import { tabBarTop } from "../../src/tabBar";
import { useCreate } from "../../src/create";
import { colors } from "../../src/theme";
import { Spinner } from "../../src/ui";

/* The + keeps the brand's solid yellow and its ink: an image drawn as
   it is, never tinted (assets/tab-create.png). */
const CREATE_ICON = require("../../assets/tab-create.png");

export default function TabsLayout() {
  const { ready, session, pass, gated, guest } = useSession();
  const insets = useSafeAreaInsets();
  const { openMenu } = useCreate();
  if (!ready) return <Spinner />;
  if (gated && !pass) return <Redirect href="/beta" />;
  if (!session && !guest) return <Redirect href="/sign-in" />;
  const aboveBar = tabBarTop(insets.bottom);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Every screen pads its own foot past the bar, as it did under the
          bar the app used to draw, so the system's inset is turned off:
          both would leave a gap the height of a second bar. */}
      <NativeTabs tintColor={colors.yellow}>
        <NativeTabs.Trigger name="index" disableAutomaticContentInsets>
          <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} />
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="feed" disableAutomaticContentInsets>
          <NativeTabs.Trigger.Icon sf="sparkles" />
          <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        {/* A button in the bar: it can't be selected, and its press opens
            the Create menu. */}
        <NativeTabs.Trigger name="create" disabled accessibilityLabel="Create" listeners={{ tabPress: () => openMenu() }}>
          <NativeTabs.Trigger.Icon src={CREATE_ICON} renderingMode="original" />
          <NativeTabs.Trigger.Label>Create</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="communities" disableAutomaticContentInsets>
          <NativeTabs.Trigger.Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
          <NativeTabs.Trigger.Label>Communities</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="news" disableAutomaticContentInsets>
          <NativeTabs.Trigger.Icon sf={{ default: "newspaper", selected: "newspaper.fill" }} />
          <NativeTabs.Trigger.Label>News</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: aboveBar }}>
        <MiniPlayer />
      </View>
      <QueueDock bottom={aboveBar} />
    </View>
  );
}
