/* Web and Expo Go: no LiveKit, so nobody is heard speaking and there is
   no mic; the seats, hands and roles still work. */
import { Text, View } from "react-native";
import { colors } from "./theme";

export function useSpeakingIds(): Set<string> {
  return new Set();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MicButton(_props: { compact?: boolean }) {
  return null;
}

export function ConnectionNote() {
  return (
    <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 10 }}>
      <Text style={{ color: colors.muted, fontSize: 12.5, lineHeight: 18 }}>Live audio needs the full app build (TestFlight or Play), not Expo Go or the web preview. Seats, hands and roles work here.</Text>
    </View>
  );
}
