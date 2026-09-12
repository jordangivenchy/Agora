/* The queue comes to the app next, with the match as a notification. */
import { Linking, Text, View } from "react-native";
import { SITE } from "../../src/api";
import { colors } from "../../src/theme";
import { Button, Screen, Sub, Title } from "../../src/ui";

export default function Queue() {
  return (
    <Screen>
      <View style={{ paddingTop: 16 }}>
        <Title>Someone who disagrees</Title>
        <Sub>Pick a topic and a side, and get paired with someone on the other side for a live one-on-one. It's coming to the app with a notification when you're matched; for now it lives on the website.</Sub>
        <Button kind="secondary" onPress={() => void Linking.openURL(`${SITE}/`)}>Queue on agorasphere.net</Button>
        <Text style={{ color: colors.faint, fontSize: 11.5, marginTop: 14 }}>Matched rooms open here like any other room.</Text>
      </View>
    </Screen>
  );
}
