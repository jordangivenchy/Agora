/* Agreeing to the terms in force, once: the site's /agree in the app,
   in the same words (components/agora/legal and aboutYou) and the look
   of the other doors (beta, sign-in): the sky on true black, one card,
   the yellow pill. The tabs send a signed-in person here when they
   haven't agreed (src/terms.ts).

   The first time there are two short steps: a few things about them (a
   date of birth, their country and, in the United States, their state),
   then the points that matter, the two documents, a box to tick and one
   button. Someone we already know sees only the second. Nothing is sent
   until that button: the answers travel with the agreement, which is
   recorded with its version and the server's time and shown in
   Settings. A date of birth that is under age puts the account on hold
   instead (accept_terms). */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useSession } from "../src/session";
import { Starfield } from "../src/starfield";
import { colors, fonts } from "../src/theme";
import { goHome } from "../src/goHome";
import { PlacePicker } from "../src/placePicker";
import { acceptTerms, agreement, details, rememberAgreed } from "../src/terms";
import { LEGAL, legalReady, termsSummary } from "../../src/components/agora/legal";
import { ABOUT_COPY, aboutYou, birthHint, checkBirth, type BirthParts } from "../../src/components/agora/aboutYou";
import { COUNTRIES, COUNTRIES_FIRST, US_STATES, countryName, needsState, stateName } from "../../src/components/agora/places";

const LOGO_RATIO = 2039 / 274;
type IonName = keyof typeof Ionicons.glyphMap;
/* One picture for each of the points, in their order (termsSummary):
   your age, the recording, the rules, what stays yours, the totals. */
const POINT_ICONS: IonName[] = ["person-outline", "videocam-outline", "shield-outline", "document-text-outline", "trending-up-outline"];

const FIELD = { height: 44, borderRadius: 10, borderWidth: 1, borderColor: "#2b2b34", backgroundColor: "#0b0b0d" } as const;
const LABEL = { color: "#a3a3ae", fontFamily: fonts.semi, fontSize: 11.5, letterSpacing: 0.2 } as const;

/* The two documents, as tiles side by side. */
function ReadLinks() {
  const tile = (label: string, icon: IonName, href: "/legal/terms" | "/legal/privacy") => (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="link"
      style={({ pressed }) => ({ flex: 1, height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 10, borderWidth: 1, borderColor: pressed ? "#4a4a56" : "#2b2b34", backgroundColor: "#0b0b0d" })}
    >
      <Ionicons name={icon} size={15} color={colors.muted} />
      <Text style={{ color: "#d8d8e0", fontFamily: fonts.semi, fontSize: 12.5 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
      {tile("Terms", "document-text-outline", "/legal/terms")}
      {tile("Privacy policy", "lock-closed-outline", "/legal/privacy")}
    </View>
  );
}

/* A place to choose, drawn as a field: what is chosen, or what to choose. */
function PlaceField({ label, chosen, placeholder, onPress }: { label: string; chosen: string | null; placeholder: string; onPress: () => void }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[LABEL, { marginBottom: 6 }]}>{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${chosen ?? placeholder}`}
        style={({ pressed }) => [FIELD, { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 14, paddingRight: 10 }, pressed && { borderColor: "#4a4a56" }]}
      >
        <Text numberOfLines={1} style={{ flex: 1, color: chosen ? colors.text : colors.faint, fontFamily: fonts.body, fontSize: 14 }}>{chosen ?? placeholder}</Text>
        <Ionicons name="chevron-down" size={15} color={colors.muted} />
      </Pressable>
    </View>
  );
}

export default function Agree() {
  const { ready: sessionReady, session, signOut } = useSession();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<"loading" | "ask" | "busy">("loading");
  const [error, setError] = useState<string | null>(null);
  /* We don't yet know their age and where they live: ask first. */
  const [askAbout, setAskAbout] = useState(false);
  /* The date of birth this account gave was under age. */
  const [held, setHeld] = useState(false);
  /* The box is theirs to tick: the button does nothing until it is. */
  const [ticked, setTicked] = useState(false);
  /* The first step's answers, kept here until the agreement is sent. */
  const [step, setStep] = useState<"about" | "terms">("about");
  const [birth, setBirth] = useState<BirthParts>({ month: "", day: "", year: "" });
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [picking, setPicking] = useState<"country" | "state" | null>(null);
  const dayRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  const ready = legalReady();

  useEffect(() => {
    if (!sessionReady) return;
    if (!userId) {
      router.replace("/sign-in");
      return;
    }
    if (!ready) {
      setState("ask");
      return;
    }
    let on = true;
    void Promise.all([agreement(userId), details(userId)]).then(([found, known]) => {
      if (!on) return;
      if (found.state === "agreed") {
        void rememberAgreed(userId).then(goHome);
        return;
      }
      setHeld(known.state === "known" && known.held);
      /* Asked unless their age is already on record. When that couldn't
         be found out they are asked too: the server keeps what it has. */
      setAskAbout(!(known.state === "known" && known.checked));
      setState("ask");
    });
    return () => {
      on = false;
    };
  }, [sessionReady, userId, ready]);

  const about = askAbout ? aboutYou(birth, country, region) : null;

  async function agree() {
    if (!userId || state !== "ask" || !ticked || (askAbout && !about)) return;
    setState("busy");
    setError(null);
    const done = await acceptTerms(about);
    if (done.state === "under_age") {
      setHeld(true);
      setState("ask");
      return;
    }
    if (done.state !== "ok") {
      setState("ask");
      setError("That didn't save. Check your connection and try again.");
      return;
    }
    await rememberAgreed(userId);
    goHome();
  }

  const leave = () => void signOut().then(() => router.replace("/sign-in"));

  const card = { width: "100%" as const, backgroundColor: "#111114", borderWidth: 1, borderColor: "#23232b", borderRadius: 18, paddingHorizontal: 20, paddingTop: 26, paddingBottom: 22 };
  const title = { textAlign: "center" as const, color: colors.text, fontFamily: fonts.title, fontSize: 22, lineHeight: 27, letterSpacing: -0.4 };
  const sub = { marginTop: 8, marginBottom: 16, textAlign: "center" as const, color: colors.muted, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20 };
  const pill = { height: 48, borderRadius: 999, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: colors.yellow };
  const fine = { marginTop: 14, textAlign: "center" as const, color: colors.faint, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 18 };
  const quiet = { color: colors.muted, fontFamily: fonts.medium, fontSize: 12.5 };
  const signOutLink = (
    <Pressable onPress={leave} disabled={state === "busy"} accessibilityRole="button" hitSlop={10}>
      <Text style={quiet}>Sign out instead</Text>
    </Pressable>
  );

  let body;
  if (!ready) {
    body = (
      <View style={card}>
        <Text style={title}>Nothing to agree to yet</Text>
        <Text style={sub}>AgoraSphere&apos;s terms are still a draft. You can read them as they stand.</Text>
        <ReadLinks />
        <Pressable onPress={goHome} accessibilityRole="button" style={({ pressed }) => [pill, pressed && { transform: [{ scale: 0.985 }] }]}>
          <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 14.5 }}>Carry on</Text>
        </Pressable>
      </View>
    );
  } else if (held) {
    body = (
      <View style={card}>
        <View style={{ width: 56, height: 56, borderRadius: 28, alignSelf: "center", alignItems: "center", justifyContent: "center", marginBottom: 16, backgroundColor: "#141418", borderWidth: 1, borderColor: "#23232b" }}>
          <Ionicons name="lock-closed-outline" size={24} color="#ff9d92" />
        </View>
        <Text style={title}>{ABOUT_COPY.heldTitle}</Text>
        <Text style={[sub, { marginBottom: 20 }]}>{ABOUT_COPY.held(LEGAL.contact)}</Text>
        <Pressable onPress={leave} accessibilityRole="button" style={({ pressed }) => ({ height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: pressed ? "#3a3a45" : "#2b2b34", backgroundColor: "#0b0b0d" })}>
          <Text style={{ color: "#c9c9d2", fontFamily: fonts.semi, fontSize: 13.5 }}>Sign out</Text>
        </Pressable>
      </View>
    );
  } else if (state === "loading") {
    /* Finding out who this is, and whether they have been asked before:
       which step comes first isn't known yet. */
    body = (
      <>
        <View style={[card, { paddingVertical: 44, alignItems: "center" }]}>
          <ActivityIndicator color={colors.muted} />
        </View>
        <View style={{ marginTop: 16 }}>{signOutLink}</View>
      </>
    );
  } else if (askAbout && step === "about") {
    const hint = birthHint(checkBirth(birth));
    const part = (key: keyof BirthParts, most: number) => (text: string) => {
      const value = text.replace(/\D/g, "").slice(0, most);
      setBirth((b) => ({ ...b, [key]: value }));
      /* A full box hands on to the next one; the year, to the rest of the card. */
      if (value.length < most) return;
      if (key === "month") dayRef.current?.focus();
      else if (key === "day") yearRef.current?.focus();
      else Keyboard.dismiss();
    };
    const box = { ...FIELD, textAlign: "center" as const, color: colors.text, fontFamily: fonts.body, fontSize: 15, paddingVertical: 0, paddingHorizontal: 8 };
    const choose = (which: "country" | "state") => {
      Keyboard.dismiss();
      setPicking(which);
    };
    body = (
      <>
        <View style={card}>
          <Text style={title}>{ABOUT_COPY.title}</Text>
          <Text style={[sub, { marginBottom: 20 }]}>{ABOUT_COPY.sub}</Text>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={LABEL}>{ABOUT_COPY.birth}</Text>
            <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11.5 }}>Month, day, year</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput value={birth.month} onChangeText={part("month", 2)} placeholder="MM" placeholderTextColor={colors.faint} keyboardType="number-pad" autoComplete="birthdate-month" maxLength={2} accessibilityLabel="Month of birth" style={[box, { flex: 1 }]} />
            <TextInput ref={dayRef} value={birth.day} onChangeText={part("day", 2)} placeholder="DD" placeholderTextColor={colors.faint} keyboardType="number-pad" autoComplete="birthdate-day" maxLength={2} accessibilityLabel="Day of birth" style={[box, { flex: 1 }]} />
            <TextInput ref={yearRef} value={birth.year} onChangeText={part("year", 4)} placeholder="YYYY" placeholderTextColor={colors.faint} keyboardType="number-pad" autoComplete="birthdate-year" maxLength={4} accessibilityLabel="Year of birth" style={[box, { flex: 1.4 }]} />
          </View>
          <Text accessibilityLiveRegion="polite" style={{ marginTop: 6, marginBottom: 16, minHeight: 18, color: hint.bad ? "#ff9d92" : colors.faint, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 18 }}>{hint.text}</Text>

          <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
            <PlaceField label={ABOUT_COPY.country} chosen={countryName(country)} placeholder={ABOUT_COPY.pickCountry} onPress={() => choose("country")} />
            {needsState(country) && <PlaceField label={ABOUT_COPY.state} chosen={stateName(region)} placeholder={ABOUT_COPY.pickState} onPress={() => choose("state")} />}
          </View>

          {/* Not ready yet: a solid quiet pill, not a faded yellow one. */}
          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              setStep("terms");
            }}
            disabled={!about}
            accessibilityRole="button"
            accessibilityState={{ disabled: !about }}
            style={({ pressed }) => [pill, !about && { backgroundColor: "#1c1c22" }, pressed && { transform: [{ scale: 0.985 }] }]}
          >
            <Text style={{ color: about ? colors.ink : "#6f6f7c", fontFamily: fonts.bold, fontSize: 14.5 }}>{ABOUT_COPY.go}</Text>
          </Pressable>
          <Text style={fine}>{ABOUT_COPY.fine}</Text>
        </View>
        <View style={{ marginTop: 16 }}>{signOutLink}</View>
        <PlacePicker
          open={picking === "country"}
          title={ABOUT_COPY.country}
          places={COUNTRIES}
          first={COUNTRIES_FIRST}
          value={country}
          onPick={(code) => {
            setCountry(code);
            if (!needsState(code)) setRegion("");
          }}
          onClose={() => setPicking(null)}
        />
        <PlacePicker open={picking === "state"} title={ABOUT_COPY.state} places={US_STATES} value={region} onPick={setRegion} onClose={() => setPicking(null)} />
      </>
    );
  } else {
    const waiting = state !== "ask";
    const can = !waiting && ticked && (!askAbout || !!about);
    body = (
      <>
        <View style={card}>
          <Text style={title}>Before you carry on</Text>
          <Text style={sub}>AgoraSphere has terms and a privacy policy. What matters most:</Text>
          <View style={{ gap: 10, marginBottom: 16 }}>
            {termsSummary().map((point, i) => (
              <View key={point} style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#18181d", borderWidth: 1, borderColor: "#26262e" }}>
                  <Ionicons name={POINT_ICONS[i] ?? "checkmark"} size={15} color="#c9c9d2" />
                </View>
                <Text style={{ flex: 1, paddingTop: 5, color: "#d8d8e0", fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }}>{point}</Text>
              </View>
            ))}
          </View>
          <ReadLinks />
          <Pressable
            onPress={() => setTicked((t) => !t)}
            disabled={waiting}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ticked }}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: ticked ? colors.yellow : pressed ? "#4a4a56" : "#2b2b34", backgroundColor: "#0b0b0d" })}
          >
            <View style={{ width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: ticked ? colors.yellow : "#5d5d66", backgroundColor: ticked ? colors.yellow : "#111114" }}>
              {/* The site's own check (components/icons) at its weight:
                  Ionicons' is too thin to read on the yellow at this size. */}
              {ticked && (
                <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                  <Path d="M20 6 9 17l-5-5" stroke={colors.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              )}
            </View>
            <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 13, lineHeight: 20 }}>
              I&apos;m {LEGAL.minAge} or older, and I agree to the Terms and the Privacy Policy.
            </Text>
          </Pressable>
          {error && (
            <Text accessibilityLiveRegion="polite" style={{ marginBottom: 14, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: "#2b2b34", backgroundColor: "#0b0b0d", color: "#ff9d92", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 }}>
              {error}
            </Text>
          )}
          {/* Not ticked yet: a solid quiet pill, not a faded yellow one. */}
          <Pressable
            onPress={() => void agree()}
            disabled={!can}
            accessibilityRole="button"
            accessibilityState={{ disabled: !can }}
            style={({ pressed }) => [pill, !ticked && { backgroundColor: "#1c1c22" }, pressed && can && { transform: [{ scale: 0.985 }] }]}
          >
            {state === "busy"
              ? <ActivityIndicator color={colors.ink} />
              : <Text style={{ color: ticked ? colors.ink : "#6f6f7c", fontFamily: fonts.bold, fontSize: 14.5 }}>Agree and continue</Text>}
          </Pressable>
          <Text style={fine}>Version of {LEGAL.effective}. Both stay in Settings, under Terms &amp; privacy.</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 22, marginTop: 16 }}>
          {askAbout && (
            <Pressable onPress={() => setStep("about")} disabled={waiting} accessibilityRole="button" hitSlop={10}>
              <Text style={quiet}>Back</Text>
            </Pressable>
          )}
          {signOutLink}
        </View>
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Starfield width={width} height={height} count={110} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {/* A tall card: it starts clear of the clock and ends clear of the
            home bar, and on most phones the box and the button are on the
            first screen. */}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10 }}>
          <View style={{ width: "100%", maxWidth: 440, alignSelf: "center", alignItems: "center" }}>
            <Image source={require("../assets/logo.png")} style={{ height: 24, width: 24 * LOGO_RATIO, marginBottom: 22 }} resizeMode="contain" accessibilityLabel="AgoraSphere" />
            {body}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
