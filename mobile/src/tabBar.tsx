/* The site's phone tab bar: Home, Feed, Explore, the yellow Create,
   Communities, Trending, News. Icons only; the active one wears yellow. */
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IconName } from "./topics";
import { colors } from "./theme";

export const TAB_BAR_HEIGHT = 58;

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
    <View style={{ flexDirection: "row", height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom, paddingHorizontal: 10, backgroundColor: colors.bg }}>
      {SLOTS.map((slot) =>
        "create" in slot ? (
          <Pressable key="create" onPress={onCreate} accessibilityLabel="Create" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            {({ pressed }) => (
              <View
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
    </View>
  );
}
