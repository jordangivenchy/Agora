/* The door, then the phone shell: Apple's own tab bar under the screens,
   the mini-player above it while a call is on, and the Create menu.

   The bar is the system's (NativeTabs), so on iOS 26 it is the Liquid
   Glass capsule, and its selection lifts into a lens under a press and
   follows a finger along it. It holds five things on a phone: Home,
   Feed, the yellow +, Communities and News. Explore opens from Home's
   "Popular rooms" line (src/board.tsx), and Trending is the other half
   of the Feed tab ((tabs)/feed.tsx). */
import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { MiniPlayer } from "../../src/miniPlayer";
import { QueueDock } from "../../src/queue";
import { tabBarTop } from "../../src/tabBar";
import { CreateMenuHost, useCreate } from "../../src/create";
import type { IconName } from "../../src/topics";
import { colors } from "../../src/theme";
import { Spinner } from "../../src/ui";

/* The + keeps the brand's solid yellow and its ink: an image drawn as
   it is, never tinted (assets/tab-create.png). */
const CREATE_ICON = require("../../assets/tab-create.png");

/* The bar is Apple's; what is in it is ours. Icons only, as the bar
   the app used to draw had it — no words under them. The icons are the
   app's own set, handed to the system as shapes it tints (yellow for
   the tab you're on), not its own symbols, which are another hand. Each
   item still has its name for a screen reader. */
const ICON_SIZE = 26;
const sized = { getImageSource: (name: IconName, _size: number, color: Parameters<typeof Ionicons.getImageSource>[2]) => Ionicons.getImageSource(name, ICON_SIZE, color) };
const icon = (name: IconName) => <NativeTabs.Trigger.VectorIcon family={sized} name={name} />;

function AppTabs({ onCreate }: { onCreate: () => void }) {
  return (
    /* Every screen pads its own foot past the bar, as it did under the
       bar the app used to draw, so the system's inset is turned off:
       both would leave a gap the height of a second bar. */
    <NativeTabs tintColor={colors.yellow}>
      <NativeTabs.Trigger name="index" accessibilityLabel="Home" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon src={icon("home-outline")} renderingMode="template" />
        <NativeTabs.Trigger.Label hidden />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="feed" accessibilityLabel="Feed" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon src={icon("sparkles-outline")} renderingMode="template" />
        <NativeTabs.Trigger.Label hidden />
      </NativeTabs.Trigger>
      {/* A button in the bar: it can't be selected, and its press opens
          the Create menu, just above it (src/createMenu.tsx). */}
      <NativeTabs.Trigger name="create" disabled accessibilityLabel="Create" listeners={{ tabPress: onCreate }}>
        <NativeTabs.Trigger.Icon src={CREATE_ICON} renderingMode="original" />
        <NativeTabs.Trigger.Label hidden />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="communities" accessibilityLabel="Communities" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon src={icon("people-outline")} renderingMode="template" />
        <NativeTabs.Trigger.Label hidden />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="news" accessibilityLabel="News" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon src={icon("newspaper-outline")} renderingMode="template" />
        <NativeTabs.Trigger.Label hidden />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

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
      <AppTabs onCreate={openMenu} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: aboveBar }}>
        <MiniPlayer />
      </View>
      <QueueDock bottom={aboveBar} />
      {/* Over the bar it rises from, and over everything else here. */}
      <CreateMenuHost />
    </View>
  );
}
