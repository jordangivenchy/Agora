/* The settings page's building blocks, as the site draws them: a card
   with a title and a line under it, a row with a switch, the dark
   field, the blue and the ghost buttons, an ok/error line. */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, fonts } from "./theme";

export function SectionCard({ title, sub, children, danger }: { title: string; sub?: string; children?: ReactNode; danger?: boolean }) {
  return (
    <View style={{ backgroundColor: "#121218", borderWidth: StyleSheet.hairlineWidth, borderColor: danger ? "#5a2a2a" : colors.border, borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
        <Text style={{ color: danger ? "#fca5a5" : colors.text, fontFamily: fonts.title, fontSize: 14 }}>{title}</Text>
        {!!sub && <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, marginTop: 3 }}>{sub}</Text>}
      </View>
      <View style={{ paddingBottom: 6 }}>{children}</View>
    </View>
  );
}

export function Toggle({ on, disabled, onChange, label, sub }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <Pressable
      onPress={() => !disabled && onChange(!on)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingHorizontal: 16, paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13.5 }}>{label}</Text>
        {!!sub && <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 15, marginTop: 2 }}>{sub}</Text>}
      </View>
      <View style={{ width: 36, height: 20, borderRadius: 99, backgroundColor: on ? "#1d9e75" : "#3a3a42", justifyContent: "center" }}>
        <View style={{ position: "absolute", top: 3, left: on ? 19 : 3, width: 14, height: 14, borderRadius: 7, backgroundColor: "#fff" }} />
      </View>
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      {...props}
      style={[{ backgroundColor: "#0a0a0e", borderWidth: StyleSheet.hairlineWidth, borderColor: "#34343c", borderRadius: 9, color: colors.text, fontFamily: fonts.body, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10, minHeight: 40 }, props.style]}
    />
  );
}

export function Btn({ label, onPress, kind = "primary", disabled, style }: { label: string; onPress: () => void; kind?: "primary" | "ghost" | "danger"; disabled?: boolean; style?: object }) {
  const bg = kind === "primary" ? "#183052" : kind === "danger" ? "#2a1414" : "transparent";
  const border = kind === "primary" ? "#2c5382" : kind === "danger" ? "#6b2a2a" : "#3a3a42";
  const color = kind === "primary" ? "#9cc4f0" : kind === "danger" ? "#fca5a5" : "#c0c0c8";
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [{ alignSelf: "flex-start", backgroundColor: bg, borderWidth: StyleSheet.hairlineWidth, borderColor: border, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 9, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}>
      <Text style={{ color, fontFamily: fonts.semi, fontSize: 12.5 }}>{label}</Text>
    </Pressable>
  );
}

export function Msg({ msg }: { msg: { kind: "ok" | "err"; text: string } | null }) {
  if (!msg) return null;
  return <Text style={{ color: msg.kind === "ok" ? "#97c459" : "#fca5a5", fontFamily: fonts.body, fontSize: 12, lineHeight: 17 }}>{msg.text}</Text>;
}

export function Pad({ children }: { children: ReactNode }) {
  return <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 10 }}>{children}</View>;
}
