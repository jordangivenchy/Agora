/* Floating emoji over the stage (components/agora/ReactionOverlay.tsx,
   the agReactionFloat keyframes): each one rises from the lower third
   and fades, its lane seeded from its id so the stream scatters instead
   of stacking. Positions are numbers from the overlay's measured size,
   and the animation runs on the JS driver: a native-driven floater
   added to an already-mounted overlay never drew on iOS. */
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { REACTION_TTL_MS, type Reaction } from "./roomCall";

function Floater({ r, width, height }: { r: Reaction; width: number; height: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: REACTION_TTL_MS, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [t]);
  /* The site's keyframes: in by 12% at -6vh, out at -52vh. */
  const translateY = t.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, -height * 0.06, -height * 0.52] });
  const opacity = t.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 1, 0] });
  const scale = t.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0.6, 1.1, 1] });
  const left = Math.round((width * (12 + ((r.id * 37) % 76))) / 100);
  const top = Math.round(height * 0.82) - 36;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left, top, transform: [{ translateY }, { scale }], opacity }}>
      <Text style={{ fontSize: 30, lineHeight: 36 }}>{r.emoji}</Text>
    </Animated.View>
  );
}

export function ReactionOverlay({ reactions }: { reactions: Reaction[] }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };
  return (
    <View pointerEvents="none" onLayout={onLayout} style={StyleSheet.absoluteFill}>
      {size.width > 0 && reactions.map((r) => <Floater key={r.id} r={r} width={size.width} height={size.height} />)}
    </View>
  );
}
