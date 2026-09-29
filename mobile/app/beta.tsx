/* The closed-beta door, in the website's words and look
   (src/app/beta/page.tsx): the site's sky on true black, one card with
   the Closed beta label, the key field, the yellow pill, and where to
   get a key, where only the word Discord is the link. What's typed goes
   to the server as typed. The card rises in once; a wrong key shakes
   the field. */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "../src/session";
import { Starfield } from "../src/starfield";
import { useReduceMotion } from "../src/motion";
import { DISCORD_INVITE } from "../src/links";
import { colors, fonts } from "../src/theme";

const LOGO_RATIO = 2039 / 274;
/* The key reads best in a fixed-width face; the phone's own. */
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

export default function Beta() {
  const { redeemKey } = useSession();
  const { width, height } = useWindowDimensions();
  const reduce = useReduceMotion();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const ready = code.trim().length > 0;

  const rise = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) { rise.setValue(1); return; }
    Animated.timing(rise, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [reduce, rise]);

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const err = await redeemKey(code);
    setBusy(false);
    if (!err) { router.replace("/"); return; }
    setError(err);
    if (!reduce) {
      shake.setValue(0);
      Animated.sequence([-5, 5, -5, 5, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 55, useNativeDriver: true }))).start();
    }
  }

  const tone = error ? "#ff8a80" : focused ? "#c9c9d2" : "#6f6f7c";
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Starfield width={width} height={height} count={110} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            style={{
              width: "100%", maxWidth: 400, alignSelf: "center", alignItems: "center",
              opacity: rise,
              transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            }}
          >
            <Image source={require("../assets/logo.png")} style={{ height: 24, width: 24 * LOGO_RATIO, marginBottom: 26 }} resizeMode="contain" accessibilityLabel="AgoraSphere" />
            <View style={{ width: "100%", backgroundColor: "#111114", borderWidth: 1, borderColor: "#23232b", borderRadius: 18, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 }}>
              <View style={{ alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 7, height: 26, paddingHorizontal: 12, borderRadius: 999, backgroundColor: "#18181d", borderWidth: 1, borderColor: "#2a2a33" }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.yellow }} />
                <Text style={{ color: "#d4d4dc", fontFamily: fonts.semi, fontSize: 11.5, letterSpacing: 0.2 }}>Closed beta</Text>
              </View>
              <Text style={{ marginTop: 16, textAlign: "center", color: colors.text, fontFamily: fonts.title, fontSize: 25, lineHeight: 30, letterSpacing: -0.5 }}>Enter your beta key</Text>
              <Text style={{ marginTop: 8, marginBottom: 22, textAlign: "center", color: colors.muted, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20 }}>
                AgoraSphere is invite-only for now. We&apos;re letting people in a few at a time.
              </Text>

              <Animated.View
                style={{
                  flexDirection: "row", alignItems: "center", gap: 10, height: 50, paddingHorizontal: 16,
                  borderRadius: 12, borderWidth: 1, borderColor: error ? "#e5484d" : focused ? "#4a9eff" : "#2b2b34", backgroundColor: "#000",
                  transform: [{ translateX: shake }],
                }}
              >
                <Ionicons name="key-outline" size={17} color={tone} />
                <TextInput
                  value={code}
                  onChangeText={(t) => { setCode(t); if (error) setError(null); }}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onSubmitEditing={submit}
                  placeholder="AGORA-XXXX-XXXX"
                  placeholderTextColor="#4b4b55"
                  accessibilityLabel="Beta key"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  spellCheck={false}
                  autoFocus
                  returnKeyType="go"
                  style={{ flex: 1, height: "100%", color: colors.text, fontFamily: MONO, fontSize: 15, letterSpacing: 0.8 }}
                />
              </Animated.View>
              {error && (
                <View style={{ flexDirection: "row", gap: 7, marginTop: 10, marginHorizontal: 2 }} accessibilityLiveRegion="polite">
                  <Ionicons name="alert-circle-outline" size={15} color="#ff8a80" style={{ marginTop: 1 }} />
                  <Text style={{ flex: 1, color: "#ff8a80", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 }}>{error}</Text>
                </View>
              )}

              {/* Nothing typed yet: a solid quiet pill, not a faded yellow one. */}
              <Pressable
                onPress={submit}
                disabled={!ready || busy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  { marginTop: 16, height: 48, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: ready || busy ? colors.yellow : "#17171c" },
                  pressed && ready && !busy && { transform: [{ scale: 0.985 }] },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.ink} />
                ) : (
                  <>
                    <Text style={{ color: ready ? colors.ink : "#5c5c66", fontFamily: fonts.bold, fontSize: 14.5 }}>Continue</Text>
                    <Ionicons name="arrow-forward" size={16} color={ready ? colors.ink : "#5c5c66"} />
                  </>
                )}
              </Pressable>

              <Text style={{ marginTop: 20, textAlign: "center", color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 }}>
                No key yet? Get one on our{" "}
                <Text onPress={() => void Linking.openURL(DISCORD_INVITE)} accessibilityRole="link" style={{ color: colors.yellow, fontFamily: fonts.semi }}>Discord</Text>.
              </Text>
            </View>
            <Text style={{ marginTop: 18, textAlign: "center", color: "#55555f", fontFamily: fonts.body, fontSize: 11.5 }}>Each key lets one device in for 30 days.</Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
