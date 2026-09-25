/* The floating Back: the round button that sits over a page's banner
   at the top-left of the phone heads (profile, community, replay,
   clip). One button, four pages — and on iOS 26 it is glass, since it
   floats over a picture: the phones' full-bleed heads are the case the
   material was made for. Elsewhere, the solid disc it always was. */
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Glass } from "./glass";
import { colors } from "./theme";

export function FloatingBack({ top, fallback = colors.bg, home = "/", style }: {
  /** Where its top edge sits — the page's safe-area inset, give or take. */
  top: number;
  /** Its solid colour where there is no glass. */
  fallback?: string;
  /** Where to go when there is nothing to go back to. */
  home?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.navigate(home))}
      accessibilityLabel="Back"
      hitSlop={8}
      style={[{ position: "absolute", top, left: 12, width: 36, height: 36 }, style]}
    >
      {({ pressed }) => (
        <Glass
          fallback={pressed ? colors.surface2 : fallback}
          interactive
          style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", overflow: "hidden" }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Glass>
      )}
    </Pressable>
  );
}
