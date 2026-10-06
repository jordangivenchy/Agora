/* The tab bar is Apple's own (app/(tabs)/_layout.tsx): on iOS 26 the
   Liquid Glass capsule, whose selection lifts into a lens under a press
   and follows a finger dragged along it. What is left here is what the
   rest of the app needs to know about a bar it no longer draws: how
   much of the screen's foot it takes, and a tab that waits to be opened.

   The system gives no way to measure its bar, so its place is written
   down: the capsule on iOS 26 (the same on every iPhone with a home
   indicator, a little lower without one), the classic bar before. */
import { useState, type ComponentType } from "react";
import { Platform, View } from "react-native";
import { useIsFocused } from "expo-router";
import { colors } from "./theme";

const IOS_26 = Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;
/* The capsule's height, and how far its foot sits above the screen's:
   measured on the iPhone 17 Pro (iOS 26.5). */
const CAPSULE_HEIGHT = 62;
const CAPSULE_FOOT = 21;
const CAPSULE_FOOT_NO_INDICATOR = 8;
const CLASSIC_BAR_HEIGHT = 49;

/** From the screen's bottom edge to the top of the tab bar: where
    something that rides above the bar (the mini-player, the queue) puts
    its foot. `bottomInset` is the window's, not a tab screen's. */
export function tabBarTop(bottomInset: number): number {
  if (IOS_26) return CAPSULE_HEIGHT + (bottomInset > 0 ? CAPSULE_FOOT : CAPSULE_FOOT_NO_INDICATOR);
  return CLASSIC_BAR_HEIGHT + bottomInset;
}

/** A tab that isn't built until it is first opened. The system's bar
    keeps every tab's screen at hand, which here would mean all five
    fetching and laying out behind the opening sky; a tab not yet seen is
    an empty page instead, and from the first visit it stays. */
export function lazyTab<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  return function LazyTab(props: P) {
    const focused = useIsFocused();
    const [seen, setSeen] = useState(focused);
    if (focused && !seen) setSeen(true);
    return seen ? <Screen {...props} /> : <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  };
}
