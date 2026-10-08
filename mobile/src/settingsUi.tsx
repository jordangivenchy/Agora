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
  /* One solid button, as the site's settings draw theirs (.stg-btn): what
     kind it is shows in the words — red for what can't be undone, quieter
     for the lesser choice — never in a colour washed behind them. Off, it
     is a darker tile with dim words, not a faded one. */
  const ghost = kind === "ghost";
  const color = disabled ? "#5d5d66" : kind === "danger" ? "#ff6b61" : ghost ? "#c0c0c8" : "#f5f5f0";
  const rest = ghost ? "transparent" : disabled ? "#141418" : "#1c1c22";
  const border = ghost ? "#3a3a42" : disabled ? "#26262e" : "#33333c";
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [{ alignSelf: "flex-start", backgroundColor: pressed && !disabled ? "#26262e" : rest, borderWidth: StyleSheet.hairlineWidth, borderColor: border, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 9 }, style]}>
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
