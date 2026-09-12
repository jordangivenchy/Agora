/* The stage without LiveKit: Expo Go and the web preview. Both platform
   files import from here (never from each other, which on iOS would
   make stage.native import itself). */
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { colors } from "./theme";

const NONE = new Set<string>();

/** Who is audibly speaking: nobody, without LiveKit. */
export function WithSpeakingFallback({ children }: { children: (speaking: Set<string>) => ReactNode }) {
  return <>{children(NONE)}</>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MicButtonFallback(_props: { compact?: boolean }) {
  return null;
}

export function ConnectionNoteFallback() {
  return (
    <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 10 }}>
      <Text style={{ color: colors.muted, fontSize: 12.5, lineHeight: 18 }}>Live audio needs the full app build (TestFlight or Play), not Expo Go or the web preview. Seats, hands and roles work here.</Text>
    </View>
  );
}
