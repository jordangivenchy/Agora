/* A line at the bottom for a moment: "Following @x", "Profile link
   copied". One host at the root; showToast from anywhere. The fade runs
   on the JS driver: a native-driven view mounted in the same moment it
   starts animating never drew on iOS (the reactions had the same fault). */
import { useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts } from "./theme";

let push: ((msg: string) => void) | null = null;

export function showToast(msg: string) {
  push?.(msg);
}

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    push = (m) => {
      setMsg(m);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(t, { toValue: 1, duration: 180, useNativeDriver: false }).start();
      timer.current = setTimeout(() => {
        Animated.timing(t, { toValue: 0, duration: 220, useNativeDriver: false }).start(() => setMsg(null));
      }, 2400);
    };
    return () => { push = null; };
  }, [t]);
  if (!msg) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 80, alignItems: "center", opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
      <View style={{ maxWidth: "86%", backgroundColor: "#16161c", borderWidth: 1, borderColor: "#2a2a34", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 13 }}>{msg}</Text>
      </View>
    </Animated.View>
  );
}
