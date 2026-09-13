/* Floating emoji over the stage (components/agora/ReactionOverlay.tsx):
   each one drifts up from the lower third and fades, its lane seeded
   from its id so the stream scatters instead of stacking. */
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { REACTION_TTL_MS, type Reaction } from "./roomCall";

function Floater({ r }: { r: Reaction }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: REACTION_TTL_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [t]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -260] });
  const opacity = t.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] });
  const scale = t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.15, 1] });
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", bottom: "28%", left: `${12 + ((r.id * 37) % 76)}%`, transform: [{ translateY }, { scale }], opacity }}>
      <Text style={{ fontSize: 30 }}>{r.emoji}</Text>
    </Animated.View>
  );
}

export function ReactionOverlay({ reactions }: { reactions: Reaction[] }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {reactions.map((r) => <Floater key={r.id} r={r} />)}
    </View>
  );
}
