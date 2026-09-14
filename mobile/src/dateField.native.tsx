/* A date and time from the system picker, as the site's datetime-local
   gives a phone browser its wheels: iOS draws its compact date and time
   buttons, Android opens the date dialog and then the time one. The web
   build has no picker (dateField.tsx), and the caller offers presets. */
import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { colors, fonts } from "./theme";

export const hasDatePicker = true;

export function DateTimeField({ value, minimumDate, onChange }: { value: Date; minimumDate: Date; onChange: (d: Date) => void }) {
  if (Platform.OS === "ios") {
    return (
      <DateTimePicker
        value={value}
        mode="datetime"
        display="compact"
        minimumDate={minimumDate}
        minuteInterval={5}
        themeVariant="dark"
        accentColor={colors.yellow}
        onValueChange={(_e, d) => onChange(d)}
      />
    );
  }
  const open = (mode: "date" | "time") =>
    DateTimePickerAndroid.open({
      value,
      mode,
      minimumDate: mode === "date" ? minimumDate : undefined,
      onValueChange: (_e, d) => {
        const next = new Date(value);
        if (mode === "date") next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
        else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
        onChange(next);
      },
    });
  const button = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: pressed ? "#1d1d24" : "#141418", borderWidth: 1, borderColor: "#2e2e38" })}>
      <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13.5 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {button(value.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), () => open("date"))}
      {button(value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), () => open("time"))}
    </View>
  );
}
