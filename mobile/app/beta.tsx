/* The closed-beta door, same words as the website's. */
import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { router } from "expo-router";
import { useSession } from "../src/session";
import { Button, Field, Note, Screen, Sub, Title } from "../src/ui";

export default function Beta() {
  const { redeemKey } = useSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    const err = await redeemKey(code);
    setBusy(false);
    if (err) setError(err);
    else router.replace("/");
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center" }}>
        <View style={{ maxWidth: 420, width: "100%", alignSelf: "center" }}>
          <Title>Closed beta</Title>
          <Sub>AgoraSphere is invite-only right now. Enter your beta key to come in.</Sub>
          <Field
            value={code}
            onChangeText={setCode}
            placeholder="Beta key"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={submit}
            returnKeyType="go"
          />
          {error && <Note tone="error">{error}</Note>}
          <View style={{ height: 8 }} />
          <Button onPress={submit} disabled={!code.trim()} busy={busy}>Enter</Button>
          <Note>Keys are handed out on our Discord.</Note>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
