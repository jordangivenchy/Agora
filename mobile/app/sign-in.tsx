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
  const { signIn, signInWithGoogle, listenAsGuest } = useSession();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setError(null);
    const err = await signInWithGoogle();
    setGoogleBusy(false);
    if (err) setError(err);
    else router.replace("/");
  }

  async function submit() {
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    const err = await signIn(email, password);
    setBusy(false);
    if (err) setError(err);
    else router.replace("/");
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center" }}>
        <View style={{ maxWidth: 420, width: "100%", alignSelf: "center" }}>
          <Title>Sign in</Title>
          <Sub>The account you use on agorasphere.net.</Sub>
          <Pressable
            onPress={() => void google()}
            disabled={googleBusy}
            style={({ pressed }) => ({
              height: 46, borderRadius: 999, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center",
              flexDirection: "row", gap: 10, marginBottom: 14, opacity: googleBusy ? 0.6 : pressed ? 0.9 : 1,
            })}
          >
            <Text style={{ color: "#1f1f1f", fontSize: 14.5, fontWeight: "600" }}>{googleBusy ? "Opening Google…" : "Continue with Google"}</Text>
          </Pressable>
          <Text style={{ color: colors.faint, fontSize: 11.5, textAlign: "center", marginBottom: 12 }}>or with email</Text>
          <Field value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" />
          <Field value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry textContentType="password" onSubmitEditing={submit} returnKeyType="go" />
          {error && <Note tone="error">{error}</Note>}
          <View style={{ height: 8 }} />
          <Button onPress={submit} disabled={!email.trim() || !password} busy={busy}>Sign in</Button>
          <View style={{ height: 10 }} />
          <Button kind="secondary" onPress={() => { listenAsGuest(); router.replace("/"); }}>Listen as a guest</Button>
          <Pressable onPress={() => Linking.openURL(`${SITE}/login`)} style={{ marginTop: 16, alignSelf: "center" }}>
            <Text style={{ color: colors.blueText, fontSize: 12.5, fontWeight: "500" }}>New here? Make your account on agorasphere.net</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
