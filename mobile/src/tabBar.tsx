/* The site's phone tab bar: Home, Feed, Explore, the yellow Create,
   Communities, Trending, News. Icons only; the active one wears yellow. */
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IconName } from "./topics";
import { colors } from "./theme";
import { Glass } from "./glass";

export const TAB_BAR_HEIGHT = 58;
/** The gap under the floating capsule, above the home indicator — and the
    room the mini-player and the queue leave for it. */
export const TAB_BAR_FLOAT = 8;
const TAB_BAR_INSET = 14;

export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
  onCreate: () => void;
}

type Slot = { name: string; icon: IconName; label: string } | { create: true };
const SLOTS: Slot[] = [
  { name: "index", icon: "home-outline", label: "Home" },
  { name: "feed", icon: "sparkles-outline", label: "Feed" },
  { name: "explore", icon: "compass-outline", label: "Explore" },
  { create: true },
  { name: "communities", icon: "people-outline", label: "Communities" },
  { name: "trending", icon: "flame-outline", label: "Trending" },
  { name: "news", icon: "newspaper-outline", label: "News" },
];

export function AppTabBar({ state, navigation, onCreate }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  return (
    /* A capsule floating above the home indicator, the way iOS 26's own
       bar sits, with the content passing under it: every tab pads its
       bottom past the bar, so the last row scrolls up from beneath the
       glass. Where there is no glass, a solid pill with a hairline. */
    <Glass
      fallback="#0e0e11"
      fallbackStyle={{ borderWidth: 1, borderColor: "#23232b" }}
      style={{ position: "absolute", left: TAB_BAR_INSET, right: TAB_BAR_INSET, bottom: insets.bottom + TAB_BAR_FLOAT, height: TAB_BAR_HEIGHT, borderRadius: TAB_BAR_HEIGHT / 2, overflow: "hidden", flexDirection: "row", paddingHorizontal: 6 }}
    >
      {SLOTS.map((slot) =>
        "create" in slot ? (
          <Pressable key="create" onPress={onCreate} accessibilityLabel="Create" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            {({ pressed }) => (
              /* Rasterized: its glow is a shadow, drawn offscreen on every frame of a screen sliding past otherwise. */
              <View
                shouldRasterizeIOS
                style={{
                  width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: colors.yellow,
                  transform: [{ scale: pressed ? 0.96 : 1 }], shadowColor: colors.yellow, shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
                }}
              >
                <Ionicons name="add" size={28} color={colors.ink} />
              </View>
            )}
          </Pressable>
        ) : (
          <Pressable
            key={slot.name}
            onPress={() => navigation.navigate(slot.name)}
            accessibilityRole="tab"
            accessibilityLabel={slot.label}
            accessibilityState={{ selected: current === slot.name }}
            style={{ flex: 1, height: TAB_BAR_HEIGHT, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name={slot.icon} size={22} color={current === slot.name ? colors.yellow : "#8b8b94"} />
          </Pressable>
        ),
      )}
    </Glass>
  );
}
