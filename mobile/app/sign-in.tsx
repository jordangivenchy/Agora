/* Email and password for now. Accounts are made on the website, where the
   welcome flow picks a username. */
import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSession } from "../src/session";
import { SITE } from "../src/api";
import { colors } from "../src/theme";
import { Button, Field, Note, Screen, Sub, Title } from "../src/ui";

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    const err = await signIn(email, password);
    setBusy(false);
    if (err) setError(err);
    else router.replace("/home");
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center" }}>
        <View style={{ maxWidth: 420, width: "100%", alignSelf: "center" }}>
          <Title>Sign in</Title>
          <Sub>The account you use on agorasphere.net.</Sub>
          <Field value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" />
          <Field value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry textContentType="password" onSubmitEditing={submit} returnKeyType="go" />
          {error && <Note tone="error">{error}</Note>}
          <View style={{ height: 8 }} />
          <Button onPress={submit} disabled={!email.trim() || !password} busy={busy}>Sign in</Button>
          <Pressable onPress={() => Linking.openURL(`${SITE}/login`)} style={{ marginTop: 16, alignSelf: "center" }}>
            <Text style={{ color: colors.blueText, fontSize: 12.5, fontWeight: "500" }}>New here? Make your account on agorasphere.net</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
