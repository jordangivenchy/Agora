/* Forgot your password: the site's page (app/forgot-password). The
   reset email comes from the same route, which rate-limits per address
   and per network and answers the same way whether or not the address
   has an account. The link in the email opens the site's reset page. */
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch } from "../src/api";
import { colors, fonts } from "../src/theme";
import { Button, Field, Note, Screen, Sub, Title } from "../src/ui";

const RESEND_COOLDOWN_S = 30;

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit() {
    setError(null);
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError("Enter a valid email address."); return; }
    setBusy(true);
    try {
      const res = await apiFetch("/api/auth/forgot-password", {}, { method: "POST", body: JSON.stringify({ email: trimmed }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 429) { setError(data.error || "Too many reset requests. Please wait a few minutes."); return; }
      if (!res.ok && res.status === 400) { setError(data.error || "Something went wrong. Please try again."); return; }
      setSubmitted(true);
      setCooldown(RESEND_COOLDOWN_S);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "", headerBackTitle: "Back" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center" }}>
        <View style={{ maxWidth: 420, width: "100%", alignSelf: "center" }}>
          {!submitted ? (
            <>
              <Title>Forgot your password?</Title>
              <Sub>Enter the email on your account and we'll send you a link to reset it.</Sub>
              {error && <Note tone="error">{error}</Note>}
              <Field value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoFocus onSubmitEditing={() => void submit()} returnKeyType="send" />
              <Button onPress={() => void submit()} busy={busy} disabled={!email.trim()}>Send reset link</Button>
            </>
          ) : (
            <>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#0f2a1a", borderWidth: 1, borderColor: "#1f5a35", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <Ionicons name="mail-outline" size={24} color="#22c55e" />
              </View>
              <Title>Check your inbox</Title>
              <Sub>If an account with that email exists, we've sent password reset instructions. The link expires in about an hour.</Sub>
              {error && <Note tone="error">{error}</Note>}
              <Button kind="secondary" onPress={() => void submit()} disabled={cooldown > 0 || busy}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Didn't get it? Resend"}</Button>
            </>
          )}
          <Pressable onPress={() => router.back()} style={{ marginTop: 18, alignSelf: "center" }}>
            <Text style={{ color: colors.blueText, fontFamily: fonts.medium, fontSize: 12.5 }}>Back to sign in</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
