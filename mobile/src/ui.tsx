/* The few controls every screen uses: the site's yellow pill, its dark
   field, a screen with the ground colour, and text at the site's sizes. */
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { colors } from "./theme";

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Sub({ children }: { children: ReactNode }) {
  return <Text style={styles.sub}>{children}</Text>;
}

export function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" | "ok" }) {
  const color = tone === "error" ? "#ff9d92" : tone === "ok" ? "#5fd3b5" : colors.muted;
  return <Text style={[styles.note, { color }]}>{children}</Text>;
}

export function Field(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.faint} {...props} style={[styles.field, props.style]} />;
}

export function Button({
  children, onPress, disabled, busy, kind = "primary",
}: { children: ReactNode; onPress: () => void; disabled?: boolean; busy?: boolean; kind?: "primary" | "secondary" | "danger" }) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.btn,
        kind === "primary" && styles.btnPrimary,
        kind === "secondary" && styles.btnSecondary,
        kind === "danger" && styles.btnDanger,
        off && { opacity: 0.45 },
        pressed && !off && { transform: [{ scale: 0.99 }] },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={kind === "primary" ? colors.ink : colors.text} />
      ) : (
        <Text style={[styles.btnText, kind === "primary" ? { color: colors.ink } : { color: colors.text }]}>{children}</Text>
      )}
    </Pressable>
  );
}

export function Spinner() {
  return (
    <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
      <ActivityIndicator color={colors.yellow} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.3, marginBottom: 6 },
  sub: { color: colors.muted, fontSize: 13.5, lineHeight: 20, marginBottom: 18 },
  note: { fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  field: {
    height: 46, borderRadius: 12, paddingHorizontal: 14, fontSize: 15, color: colors.text,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 12,
  },
  btn: { height: 46, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  btnPrimary: { backgroundColor: colors.yellow },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnDanger: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.red },
  btnText: { fontSize: 14.5, fontWeight: "700" },
});
