/* Web and Expo Go: the stage without audio. */
import { Text, View } from "react-native";
import { colors } from "./theme";

export function Stage() {
  return (
    <View style={{ padding: 16, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>
        Live audio needs the full AgoraSphere app build (TestFlight or Play), not Expo Go or the web preview. Everything else works here.
      </Text>
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MicButton(_props: { compact?: boolean }) {
  return null;
}
