/* The terms and the privacy policy, to read: the site's /terms and
   /privacy in the app, from the same words (components/agora/legal). */
import { ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { colors, fonts } from "../../src/theme";
import { Screen } from "../../src/ui";
import { LEGAL, legalBlanks, privacySections, termsSections } from "../../../src/components/agora/legal";

export default function LegalDocument() {
  const params = useLocalSearchParams<{ doc: string }>();
  const privacy = params.doc === "privacy";
  const title = privacy ? "Privacy policy" : "Terms";
  const sections = privacy ? privacySections() : termsSections();
  const blanks = legalBlanks();
  const para = { color: "#c9c9d2", fontFamily: fonts.body, fontSize: 13.5, lineHeight: 21, marginBottom: 10 };

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <Stack.Screen options={{ title: "", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 56 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 24, lineHeight: 29 }}>{title}</Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, marginTop: 6 }}>Version of {LEGAL.effective}</Text>
        {blanks.length > 0 && (
          <Text style={{ marginTop: 14, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: "#26262e", backgroundColor: "#111114", color: colors.yellow, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 }}>
            A draft, not yet in force. Still to be filled in: {blanks.join("; ")}.
          </Text>
        )}
        {sections.map((s) => (
          <View key={s.id} style={{ marginTop: 22, paddingTop: 18, borderTopWidth: 1, borderTopColor: "#16161b" }}>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15.5, lineHeight: 20, marginBottom: 9 }}>{s.title}</Text>
            {s.body.map((block, i) =>
              typeof block === "string" ? (
                <Text key={i} style={para}>{block}</Text>
              ) : (
                <View key={i} style={{ marginBottom: 4 }}>
                  {block.list.map((item, j) => (
                    <View key={j} style={{ flexDirection: "row", gap: 9, marginBottom: 7 }}>
                      <Text style={{ color: "#5d5d66", fontFamily: fonts.body, fontSize: 13.5, lineHeight: 21 }}>•</Text>
                      <Text style={{ flex: 1, color: "#c9c9d2", fontFamily: fonts.body, fontSize: 13.5, lineHeight: 21 }}>{item}</Text>
                    </View>
                  ))}
                </View>
              )
            )}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
