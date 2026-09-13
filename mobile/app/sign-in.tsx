/* Sign in, the site's login page (app/login): sign in or create an
   account, Google, the emailed code for two-factor accounts, the way to
   a forgotten password. A brand-new account goes on to the welcome flow. */
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../src/supabase";
import { isNewAccount, useSession } from "../src/session";
import { colors, fonts } from "../src/theme";
import { Button, Field, Note, Screen, Sub, Title } from "../src/ui";

type Mode = "signin" | "signup" | "2fa";

export default function SignIn() {
  const { signIn, verifyTwoFactor, resendTwoFactor, signUp, resendConfirmation, signInWithGoogle, listenAsGuest } = useSession();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [twoFactorEmail, setTwoFactorEmail] = useState("");
  const [resendWait, setResendWait] = useState(0);
  useEffect(() => {
    if (resendWait <= 0) return;
    const t = setTimeout(() => setResendWait((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendWait]);

  /* In: unless the account is suspended, in which case out again with a word. */
  async function finish() {
    const { data: suspended } = await supabase.rpc("is_suspended");
    if (suspended === true) {
      await supabase.auth.signOut().catch(() => {});
      setBusy(false);
      setMode("signin");
      setPending(null);
      setError("This account is suspended. Contact support if you believe this is a mistake.");
      return;
    }
    const { data } = await supabase.auth.getSession();
    router.replace(isNewAccount(data.session) ? "/welcome" : "/");
  }

  async function google() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setError(null);
    const err = await signInWithGoogle();
    setGoogleBusy(false);
    if (err) setError(err);
    else await finish();
  }

  async function submit() {
    if (busy) return;
    setError(null);
    setNotice(null);
    setUnconfirmed(false);
    if (mode === "signup") {
      const clean = username.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(clean)) { setError("Username must be 3–20 characters: lowercase letters, numbers, or underscores."); return; }
      if (!email.trim() || !password) return;
      setBusy(true);
      const r = await signUp(email, password, clean);
      setBusy(false);
      if (!r.ok) { setError(r.error); return; }
      if (!r.session) {
        setNotice("Account created — check your inbox for a confirmation link, then sign in.");
        setMode("signin");
        return;
      }
      await finish();
      return;
    }
    if (!email.trim() || !password) return;
    setBusy(true);
    const r = await signIn(email, password);
    if (r.ok) { await finish(); return; }
    setBusy(false);
    if ("twoFactor" in r) {
      setPending(r.twoFactor);
      setTwoFactorEmail(r.email);
      setCode("");
      setResendWait(60);
      setMode("2fa");
      return;
    }
    setError(r.error);
    setUnconfirmed(!!r.unconfirmed);
  }

  async function verify() {
    if (!pending || busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    const err = await verifyTwoFactor(pending, code);
    if (err) { setBusy(false); setCode(""); setError(err); return; }
    await finish();
  }

  async function resend() {
    if (!pending || resendWait > 0 || busy) return;
    setError(null);
    setNotice(null);
    const err = await resendTwoFactor(pending);
    if (err) { setError(err); return; }
    setCode("");
    setResendWait(60);
    setNotice("A new code is on its way.");
  }

  const title = mode === "2fa" ? "Verify it's you" : mode === "signin" ? "Welcome back" : "Create your account";
  const sub = mode === "2fa" ? `A code was sent to ${twoFactorEmail}. Check your inbox.` : mode === "signin" ? "Sign in to speak, vote, and follow people." : "Join live discussions, share your perspective, and be heard.";
  const tab = (m: Mode, label: string) => (
    <Pressable key={m} onPress={() => { setMode(m); setError(null); setNotice(null); }} style={{ flex: 1, height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: mode === m ? colors.surface2 : "transparent" }}>
      <Text style={{ color: mode === m ? colors.text : colors.muted, fontFamily: fonts.semi, fontSize: 13.5 }}>{label}</Text>
    </Pressable>
  );

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ maxWidth: 420, width: "100%", alignSelf: "center" }}>
            {mode !== "2fa" && (
              <View style={{ flexDirection: "row", padding: 3, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 22 }}>
                {tab("signin", "Sign in")}
                {tab("signup", "Create account")}
              </View>
            )}
            <Title>{title}</Title>
            <Sub>{sub}</Sub>
            {error && (
              <View style={{ marginBottom: 12 }}>
                <Note tone="error">{error}</Note>
                {unconfirmed && (
                  <Pressable disabled={resendWait > 0 || busy} onPress={() => void resendConfirmation(email).then((err) => { if (err) setError(err); else { setNotice(`Verification link sent to ${email.trim()}. Check your inbox (and spam).`); setResendWait(30); } })} style={{ marginTop: 6 }}>
                    <Text style={{ color: colors.blueText, fontFamily: fonts.medium, fontSize: 12.5 }}>{resendWait > 0 ? `Resend in ${resendWait}s` : "Resend the verification link"}</Text>
                  </Pressable>
                )}
              </View>
            )}
            {notice && <View style={{ marginBottom: 12 }}><Note tone="ok">{notice}</Note></View>}

            {mode === "2fa" ? (
              <>
                <Field value={code} onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))} placeholder="000000" keyboardType="number-pad" textContentType="oneTimeCode" autoFocus style={{ textAlign: "center", letterSpacing: 6, fontSize: 18 }} onSubmitEditing={() => void verify()} />
                <Button onPress={() => void verify()} busy={busy} disabled={code.length !== 6}>Verify</Button>
                <Pressable onPress={() => void resend()} disabled={resendWait > 0 || busy} style={{ marginTop: 14, alignSelf: "center" }}>
                  <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 12.5 }}>{resendWait > 0 ? `Resend code in ${resendWait}s` : "Didn't get it? Resend code"}</Text>
                </Pressable>
                <View style={{ height: 14 }} />
                <Button kind="secondary" onPress={() => { setMode("signin"); setCode(""); setPending(null); setError(null); setNotice(null); }}>Back to sign in</Button>
              </>
            ) : (
              <>
                <Pressable onPress={() => void google()} disabled={googleBusy} style={({ pressed }) => ({ height: 46, borderRadius: 999, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", marginBottom: 14, opacity: googleBusy ? 0.6 : pressed ? 0.9 : 1 })}>
                  <Text style={{ color: "#1f1f1f", fontFamily: fonts.semi, fontSize: 14.5 }}>{googleBusy ? "Opening Google…" : "Continue with Google"}</Text>
                </Pressable>
                <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11.5, textAlign: "center", marginBottom: 12 }}>or with email</Text>
                {mode === "signup" && (
                  <Field value={username} onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))} placeholder="@your_handle" autoCapitalize="none" autoCorrect={false} textContentType="username" returnKeyType="next" />
                )}
                <Field value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" />
                <Field value={password} onChangeText={setPassword} placeholder={mode === "signup" ? "Password (at least 6 characters)" : "Password"} secureTextEntry textContentType={mode === "signup" ? "newPassword" : "password"} onSubmitEditing={() => void submit()} returnKeyType="go" />
                {mode === "signin" && (
                  <Pressable onPress={() => router.push("/forgot-password")} style={{ alignSelf: "flex-end", marginTop: -4, marginBottom: 10 }}>
                    <Text style={{ color: colors.blueText, fontFamily: fonts.medium, fontSize: 12 }}>Forgot password?</Text>
                  </Pressable>
                )}
                <View style={{ height: 4 }} />
                <Button onPress={() => void submit()} disabled={!email.trim() || !password || (mode === "signup" && !username.trim())} busy={busy}>{mode === "signin" ? "Sign in" : "Create account"}</Button>
                <View style={{ height: 10 }} />
                <Button kind="secondary" onPress={() => { listenAsGuest(); router.replace("/"); }}>Browse discussions without signing in</Button>
                <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 16 }}>By continuing, you agree to AgoraSphere's Terms of Service and acknowledge our Privacy Policy.</Text>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
