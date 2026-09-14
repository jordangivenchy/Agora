/* Create a community, the site's modal (components/community/
   CreateCommunityModal.tsx) as it stands on a phone: a card over the middle
   of the screen, the same frame as Start a discussion's — the header pinned
   (the title, Discussion | Community, the steps, the close button), the
   step scrolling and sliding in from the side it came from, the footer
   pinned under it. Basics (name, type, description, rules), Look (colour,
   avatar, banner), Access (public or private with the application prompt),
   Review, then Invite friends once it exists. One insert, then the creator
   becomes owner. The database's own gate (community_creation_status) is
   shown instead of the form when it would refuse. The card lives in
   create.tsx's modal, trading places with the discussion card. */
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Image, KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { pickImage, uploadPostImage, uploadSquareImage, type PickedImage } from "./postImages";
import { InviteFriends } from "./inviteFriends";
import { cleanTextError, BODY_MIN, NAME_MIN } from "./cleanText";
import { useReduceMotion } from "./motion";
import { useRevealField } from "./revealField";
import { colors, fonts } from "./theme";

export const COMMUNITY_KINDS: { key: string; label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; hint: string }[] = [
  { key: "topic-circle", label: "Topic circle", icon: "people-circle-outline", hint: "People around an interest" },
  { key: "university", label: "University", icon: "school-outline", hint: "A campus or society" },
  { key: "hs-team", label: "HS team", icon: "trophy-outline", hint: "A school debate team" },
  { key: "mun", label: "Model UN", icon: "globe-outline", hint: "Delegations and committees" },
  { key: "pre-law", label: "Pre-law", icon: "hammer-outline", hint: "Moot court, LSAT, admissions" },
];
const COLORS = ["#4a9eff", "#ffb700", "#00b894", "#e05a5a", "#9d8fd9", "#d98fb9", "#e0956a", "#64B5F6"];
type CreationStatus = { allowed: boolean; reason: "signed_out" | "email_unverified" | "not_verified" | "account_too_new" | "community_limit" | null; count: number; cap: number | null; account_age_hours?: number };
const GUARD_MESSAGES: Record<string, string> = {
  email_unverified: "Verify your email address before creating a community.",
  not_verified: "During the beta, only verified accounts can create a community.",
  account_too_new: "New accounts can create communities after their first day.",
  community_limit: "You've reached the limit of communities one account can create.",
};
const NAME_MIN_LEN = 3, NAME_MAX = 40, DESC_MAX = 300, RULES_MAX = 4000, PROMPT_MAX = 500;
const STEPS = ["Basics", "Look", "Access", "Review", "Invite"];
const previewSlug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

/* The site's modal palette, solid (CreateCommunityModal.tsx, globals.css). */
const INK = "#1a0e00";
const TEXT = "#eeeef5";
const LINE = "rgba(255,255,255,0.1)";
const EDGE = "rgba(255,255,255,0.14)";
const SEP = "rgba(255,255,255,0.06)";
const FIELD = "#0b0b0d";
const HINT = "rgba(238,238,245,0.42)";

/* The gate's last answer for the account, so the card opens on it while it asks again. */
let knownGate: { uid: string; status: CreationStatus } | null = null;

/** Mounted each time the modal opens it, so it starts fresh. */
export function CreateCommunityCard({ onClose, onCreateDiscussion }: { onClose: () => void; onCreateDiscussion?: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const email = session?.user.email ?? null;
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState(COMMUNITY_KINDS[0].key);
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [avatar, setAvatar] = useState<PickedImage | null>(null);
  const [banner, setBanner] = useState<PickedImage | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<CreationStatus | null>(() => (uid && knownGate?.uid === uid ? knownGate.status : null));
  const [resent, setResent] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const nameRef = useRef<TextInput>(null);
  const descriptionRef = useRef<TextInput>(null);
  const rulesRef = useRef<TextInput>(null);
  const promptRef = useRef<TextInput>(null);
  const reveal = useRevealField(scrollRef);
  const openedAt = useRef(Date.now());
  const focusedName = useRef(false);

  useEffect(() => {
    void supabase.rpc("community_creation_status").then(({ data, error: err }) => {
      const status: CreationStatus = err || !data ? { allowed: true, reason: null, count: 0, cap: null } : (data as CreationStatus);
      if (uid) knownGate = { uid, status };
      setGate(status);
    });
  }, [uid]);
  /* The site puts the cursor in the name; here it waits for the card to settle, and for the gate to allow it. */
  useEffect(() => {
    if (!gate?.allowed || focusedName.current) return;
    const t = setTimeout(() => { focusedName.current = true; nameRef.current?.focus(); }, Math.max(0, 320 - (Date.now() - openedAt.current)));
    return () => clearTimeout(t);
  }, [gate]);

  const trimmed = name.trim();
  const slug = previewSlug(trimmed);
  const nameIssue = cleanTextError(trimmed, NAME_MIN);
  const nameOk = trimmed.length >= NAME_MIN_LEN && trimmed.length <= NAME_MAX && !nameIssue;
  const canNext = step === 0 ? nameOk && description.length <= DESC_MAX : true;
  const canCreate = nameOk && rules.length <= RULES_MAX && (!isPrivate || prompt.length <= PROMPT_MAX);
  const kindMeta = COMMUNITY_KINDS.find((k) => k.key === kind) ?? COMMUNITY_KINDS[0];
  /* The form waits for the gate's answer: a refusal replacing it a moment after it appeared was a flash. */
  const allowed = !!gate?.allowed;

  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    setStep(n);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const pick = async (set: (i: PickedImage | null) => void) => {
    try { const img = await pickImage(); if (img) set(img); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't pick a picture."); }
  };

  const create = async () => {
    if (!canCreate || busy || !uid) return;
    const textIssue = cleanTextError(description, BODY_MIN) ?? cleanTextError(rules, BODY_MIN) ?? cleanTextError(prompt, BODY_MIN);
    if (textIssue) { setError(textIssue); return; }
    setBusy(true);
    setError(null);
    try {
      const [avatar_url, banner_url] = await Promise.all([avatar ? uploadSquareImage(uid, avatar) : Promise.resolve(null), banner ? uploadPostImage(uid, banner) : Promise.resolve(null)]);
      const { data, error: err } = await supabase
        .from("communities")
        .insert({ name: trimmed, kind, color, description: description.trim() || null, rules: rules.trim() || null, is_private: isPrivate, application_prompt: isPrivate && prompt.trim() ? prompt.trim() : null, avatar_url, banner_url, created_by: uid })
        .select("id, name")
        .single();
      if (err || !data) throw new Error(GUARD_MESSAGES[err?.message ?? ""] ?? err?.message ?? "Couldn't create the community.");
      const row = data as { id: string; name: string };
      await supabase.from("community_members").insert({ community_id: row.id, user_id: uid, role: "owner" });
      setDir(1);
      setCreated(row);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the community.");
    } finally {
      setBusy(false);
    }
  };

  const activeStep = created ? 4 : step;
  const cardW = Math.min(width - 24, 540);
  const cardH = Math.min(Math.round(height * 0.88), height - insets.top - insets.bottom - 24);
  /* Type cards two to a row on a phone (.ccm-kinds). */
  const kindW = Math.floor((cardW - 2 - 40 - 8) / 2);
  const field = (key: string) => ({ borderRadius: 10, borderWidth: 1, borderColor: focus === key ? "rgba(255,255,255,0.24)" : LINE, backgroundColor: "#070708", color: TEXT, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10 }) as const;
  const focusProps = (key: string, ref: React.RefObject<TextInput | null>) => ({
    ref,
    onFocus: () => { setFocus(key); reveal.focused(ref); },
    onBlur: () => { setFocus((f) => (f === key ? null : f)); reveal.blurred(ref); },
  });

  const preview = (
    <View style={{ borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: LINE, backgroundColor: "#0e0e11" }}>
      <View style={{ height: 84, backgroundColor: banner ? FIELD : color }}>{banner && <Image source={{ uri: banner.uri }} style={{ width: "100%", height: 84 }} resizeMode="cover" />}</View>
      {/* The tile hangs off the band and the name sits under it, as on the community page. */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 14, paddingBottom: 12, marginTop: -26 }}>
        <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: color, borderWidth: 3, borderColor: "#101014", overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
          {avatar ? <Image source={{ uri: avatar.uri }} style={{ width: 50, height: 50 }} /> : <Text style={{ color: "#fff", fontFamily: fonts.title, fontSize: 22 }}>{(trimmed || "?").charAt(0).toUpperCase()}</Text>}
        </View>
        <View style={{ minWidth: 0, flex: 1, paddingTop: 33 }}>
          <Text numberOfLines={1} style={{ color: "#f5f5f0", fontFamily: fonts.title, fontSize: 15 }}>{trimmed || "Your community"}</Text>
          <Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 11.5, marginTop: 2 }}>{kindMeta.label} · {isPrivate ? "private" : "public"} · 1 member</Text>
        </View>
      </View>
    </View>
  );

  return (
    /* Framed as the discussion card is (newRoomSheet.tsx): the keyboard lifts the floor and the card shrinks to fit. */
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={-insets.bottom} pointerEvents="box-none" style={{ flex: 1 }}>
      <View pointerEvents="box-none" style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, paddingHorizontal: 12 }}>
        <View style={{ width: cardW, height: cardH, flexShrink: 1, backgroundColor: "#000", borderRadius: 20, borderWidth: 1, borderColor: LINE, overflow: "hidden" }}>
          {/* Header */}
          <View style={{ paddingTop: 16, paddingRight: 16, paddingBottom: 12, paddingLeft: 20, borderBottomWidth: 1, borderBottomColor: SEP }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
              <View>
                <Text style={{ color: "#f4f4f5", fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.36 }}>{created ? "Invite friends" : "Create a community"}</Text>
                {onCreateDiscussion && (
                  <View accessibilityRole="tablist" style={{ flexDirection: "row", alignSelf: "flex-start", marginTop: 10, padding: 3, gap: 2, borderRadius: 999, backgroundColor: FIELD, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
                    <Pressable accessibilityRole="tab" accessibilityState={{ selected: false }} onPress={onCreateDiscussion} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, opacity: pressed ? 0.7 : 1 })}>
                      <Ionicons name="mic-outline" size={12} color="rgba(238,238,245,0.7)" />
                      <Text style={{ color: "rgba(238,238,245,0.7)", fontFamily: fonts.semi, fontSize: 12 }}>Discussion</Text>
                    </Pressable>
                    <View accessibilityRole="tab" accessibilityState={{ selected: true }} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.yellow }}>
                      <Ionicons name="people" size={12} color={INK} />
                      <Text style={{ color: INK, fontFamily: fonts.bold, fontSize: 12 }}>Community</Text>
                    </View>
                  </View>
                )}
              </View>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close" style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#141418" : FIELD, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" })}>
                <Ionicons name="close" size={15} color="rgba(244,244,245,0.55)" />
              </Pressable>
            </View>
            <View accessibilityLabel={`Step ${activeStep + 1} of ${STEPS.length}`} style={{ flexDirection: "row", alignItems: "center", marginTop: 12 }}>
              {STEPS.map((s, i) => {
                const tone = i === activeStep ? colors.yellow : i < activeStep ? "rgba(238,238,245,0.7)" : "rgba(238,238,245,0.35)";
                return (
                  <Fragment key={s}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: i === activeStep ? colors.yellow : i < activeStep ? "#242424" : "#0f0f0f" }}>
                        {i < activeStep ? <Ionicons name="checkmark" size={10} color={tone} /> : <Text style={{ color: i === activeStep ? INK : tone, fontFamily: fonts.bold, fontSize: 10.5 }}>{i + 1}</Text>}
                      </View>
                      <Text style={{ color: tone, fontFamily: fonts.semi, fontSize: 11.5 }}>{s}</Text>
                    </View>
                    {i < STEPS.length - 1 && <View style={{ flexGrow: 1, flexShrink: 1, maxWidth: 14, height: 1, marginHorizontal: 5, backgroundColor: "#1f1f1f" }} />}
                  </Fragment>
                );
              })}
            </View>
          </View>

          {/* Body */}
          <ScrollView ref={scrollRef} onScroll={reveal.onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14, gap: 14 }}>
            {gate && !gate.allowed && gate.reason && (
              <View style={{ alignItems: "center", paddingTop: 26, paddingBottom: 18, paddingHorizontal: 12 }}>
                <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: "#1f1807", borderWidth: 1, borderColor: "#4d3a08", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                  <Ionicons name={gate.reason === "email_unverified" ? "mail-outline" : gate.reason === "not_verified" ? "person-circle-outline" : gate.reason === "account_too_new" ? "time-outline" : "business-outline"} size={22} color={colors.yellow} />
                </View>
                <Text style={{ color: "#f5f5f0", fontFamily: fonts.title, fontSize: 16, textAlign: "center" }}>
                  {gate.reason === "email_unverified" ? "Verify your email first" : gate.reason === "not_verified" ? "Communities are for verified accounts for now" : gate.reason === "account_too_new" ? "Your account is brand new" : gate.reason === "community_limit" ? "You've made the most communities one account can" : "Sign in to create a community"}
                </Text>
                <Text style={{ color: "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: 13, lineHeight: 19.5, textAlign: "center", marginTop: 6, maxWidth: 340 }}>
                  {gate.reason === "email_unverified" ? `We sent a link to ${email ?? "your inbox"}. Open it, then come back — communities need a verified address.`
                    : gate.reason === "not_verified" ? "During the beta, only verified accounts can create a community. Join the ones that exist, post, and ask the team in the Discord if you'd like to run one."
                    : gate.reason === "account_too_new" ? `Communities open up after your first day (${Math.max(0, 24 - (gate.account_age_hours ?? 0))}h to go). Join a few communities and post in the meantime.`
                    : gate.reason === "community_limit" ? `You've created ${gate.count} of ${gate.cap ?? 3}. Owner upgrades with more communities are coming; for now, grow the ones you have.`
                    : "Communities are created from an account."}
                </Text>
                {gate.reason === "email_unverified" && email && (
                  <Pressable disabled={resent} onPress={() => void supabase.auth.resend({ type: "signup", email }).then(({ error: err }) => (err ? setError(err.message) : setResent(true)))} style={{ marginTop: 14, height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: resent ? "#17171c" : colors.yellow }}>
                    <Text style={{ color: resent ? "#c9c9d2" : INK, fontFamily: fonts.bold, fontSize: 13 }}>{resent ? "Sent — check your inbox" : "Resend the link"}</Text>
                  </Pressable>
                )}
              </View>
            )}

            {created && (
              <StepIn key="invite" dir={1}>
                <View>
                  <Label text={`Invite friends to ${created.name}`} />
                  <InviteFriends communityId={created.id} communityName={created.name} isPrivate={isPrivate} />
                </View>
              </StepIn>
            )}

            {allowed && !created && step === 0 && (
              <StepIn key="step-0" dir={dir}>
                <View>
                  <Label text="Name" />
                  <TextInput value={name} onChangeText={(t) => setName(t.slice(0, NAME_MAX + 10))} placeholder="e.g. Georgetown Debate Society" placeholderTextColor={colors.faint} maxLength={NAME_MAX} returnKeyType="next" {...focusProps("name", nameRef)} style={field("name")} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, marginTop: 5 }}>
                    <Text numberOfLines={1} style={{ flex: 1, color: nameIssue ? "#ff8a80" : HINT, fontFamily: fonts.body, fontSize: 11.5 }}>
                      {nameIssue ?? (slug ? <>Lives at <Text style={{ color: "rgba(238,238,245,0.7)" }}>agorasphere.net/communities/{slug}</Text></> : `${NAME_MIN_LEN}–${NAME_MAX} characters.`)}
                    </Text>
                    <Text style={{ color: trimmed.length > NAME_MAX ? "#ff8a80" : HINT, fontFamily: fonts.body, fontSize: 11.5 }}>{trimmed.length}/{NAME_MAX}</Text>
                  </View>
                </View>

                <View>
                  <Label text="Type" />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {COMMUNITY_KINDS.map((k) => {
                      const on = k.key === kind;
                      return (
                        <Pressable
                          key={k.key}
                          onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity)); setKind(k.key); }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          style={({ pressed }) => ({ width: kindW, flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, backgroundColor: on ? colors.yellow : pressed ? "#141418" : FIELD, borderWidth: 1, borderColor: on ? colors.yellow : EDGE })}
                        >
                          <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: on ? INK : "#16161a" }}><Ionicons name={k.icon} size={15} color={on ? colors.yellow : "#c0c0c8"} /></View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={{ color: on ? INK : TEXT, fontFamily: fonts.semi, fontSize: 13 }}>{k.label}</Text>
                            {/* One line at rest, the whole hint on the chosen card. */}
                            <Text numberOfLines={on ? 0 : 1} style={{ color: on ? "rgba(26,14,0,0.7)" : "rgba(238,238,245,0.45)", fontFamily: fonts.body, fontSize: 11, lineHeight: 15 }}>{k.hint}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View>
                  <Label text="Description" optional />
                  <TextInput value={description} onChangeText={(t) => setDescription(t.slice(0, DESC_MAX))} placeholder="What is this community for, and who is it for?" placeholderTextColor={colors.faint} multiline {...focusProps("description", descriptionRef)} style={[field("description"), { minHeight: 82, textAlignVertical: "top" }]} />
                  <Hint right>{description.length}/{DESC_MAX}</Hint>
                </View>
                <View>
                  <Label text="Rules" optional />
                  <TextInput value={rules} onChangeText={(t) => setRules(t.slice(0, RULES_MAX))} placeholder={"1. Stay on topic\n2. Argue the point, not the person"} placeholderTextColor={colors.faint} multiline {...focusProps("rules", rulesRef)} style={[field("rules"), { minHeight: 102, textAlignVertical: "top" }]} />
                  <Hint>{"Pinned in the community's sidebar. You can edit everything later in the community's settings."}</Hint>
                </View>
              </StepIn>
            )}

            {allowed && !created && step === 1 && (
              <StepIn key="step-1" dir={dir}>
                {preview}
                <View>
                  <Label text="Accent colour" />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4 }}>
                    {COLORS.map((c) => {
                      const on = color === c;
                      return (
                        <Pressable key={c} onPress={() => setColor(c)} hitSlop={3} accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected: on }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, transform: [{ scale: on ? 1.05 : 1 }] }}>
                          {on && <View pointerEvents="none" style={{ position: "absolute", top: -4, left: -4, right: -4, bottom: -4, borderRadius: 19, borderWidth: 2, borderColor: c }} />}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                {([["Avatar", "Square, shown beside the name.", avatar, setAvatar], ["Banner", "Wide, across the top of the community page.", banner, setBanner]] as const).map(([title, h, file, set]) => (
                  <View key={title} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: EDGE, backgroundColor: FIELD }}>
                    <Label text={title} optional tight />
                    <Text style={{ color: HINT, fontFamily: fonts.body, fontSize: 11.5, marginBottom: 10 }}>{h}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      {file && <Image source={{ uri: file.uri }} style={{ width: 44, height: 44, borderRadius: 8 }} />}
                      <Pressable onPress={() => void pick(set as (i: PickedImage | null) => void)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: pressed ? "#1a1a1f" : "#121214", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" })}>
                        <Ionicons name="image-outline" size={13} color="#e8e8ee" /><Text style={{ color: "#e8e8ee", fontFamily: fonts.semi, fontSize: 12 }}>{file ? "Replace" : "Upload"}</Text>
                      </Pressable>
                      {file && <Pressable onPress={() => (set as (i: PickedImage | null) => void)(null)} hitSlop={6}><Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 12 }}>Remove</Text></Pressable>}
                    </View>
                  </View>
                ))}
              </StepIn>
            )}

            {allowed && !created && step === 2 && (
              <StepIn key="step-2" dir={dir}>
                <View>
                  <Label text="Who can join" />
                  <View style={{ gap: 8 }}>
                    {([[false, "lock-open-outline", "Public", "Anyone can find it and join."], [true, "lock-closed-outline", "Private", "People request to join; you approve."]] as const).map(([priv, icon, title, h]) => {
                      const on = isPrivate === priv;
                      return (
                        <Pressable key={title} onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity)); setIsPrivate(priv); }} accessibilityRole="button" accessibilityState={{ selected: on }} style={({ pressed }) => ({ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, backgroundColor: on ? colors.yellow : pressed ? "#141418" : FIELD, borderWidth: 1, borderColor: on ? colors.yellow : EDGE })}>
                          <Ionicons name={icon} size={15} color={on ? INK : "#c0c0c8"} style={{ marginTop: 1 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: on ? INK : TEXT, fontFamily: fonts.semi, fontSize: 13 }}>{title}</Text>
                            <Text style={{ color: on ? "rgba(26,14,0,0.72)" : "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 11.5, marginTop: 2 }}>{h}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                {isPrivate && (
                  <View>
                    <Label text="Ask applicants" optional />
                    <TextInput value={prompt} onChangeText={(t) => setPrompt(t.slice(0, PROMPT_MAX))} placeholder="e.g. Which school are you at, and who do you know here?" placeholderTextColor={colors.faint} multiline {...focusProps("prompt", promptRef)} style={[field("prompt"), { minHeight: 62, textAlignVertical: "top" }]} />
                    <Hint>Shown when someone requests to join; their answer comes with the request.</Hint>
                  </View>
                )}
              </StepIn>
            )}

            {allowed && !created && step === 3 && (
              <StepIn key="step-3" dir={dir}>
                {preview}
                <View>
                  <Label text="Everything, before it exists" />
                  <View style={{ borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: FIELD, overflow: "hidden" }}>
                    {([["Name", trimmed, 0], ["Type", kindMeta.label, 0], ["Description", description.trim() || "None", 0], ["Rules", rules.trim() ? `${rules.trim().split(/\n+/).filter(Boolean).length} rule${rules.trim().split(/\n+/).filter(Boolean).length === 1 ? "" : "s"}` : "None", 0], ["Look", `${avatar ? "Avatar" : "Initial"} · ${banner ? "banner" : "colour band"}`, 1], ["Access", isPrivate ? `Private — people apply${prompt.trim() ? ", with a question" : ""}` : "Public — anyone can join", 2]] as [string, string, number][]).map(([k, v, target], idx, arr) => (
                      <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: idx < arr.length - 1 ? 1 : 0, borderBottomColor: SEP }}>
                        <Text style={{ width: 84, color: "rgba(255,255,255,0.4)", fontFamily: fonts.semi, fontSize: 11, letterSpacing: 0.66 }}>{k.toUpperCase()}</Text>
                        <Text numberOfLines={1} style={{ flex: 1, color: TEXT, fontFamily: fonts.body, fontSize: 13 }}>{v}</Text>
                        <Pressable onPress={() => go(target)} hitSlop={8}><Text style={{ color: "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: 12 }}>Edit</Text></Pressable>
                      </View>
                    ))}
                  </View>
                  <Hint>{"You'll be the owner. Everything here can be changed later in the community's settings."}</Hint>
                </View>
              </StepIn>
            )}

            {!!error && (
              <View style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: "#140909", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)" }}>
                <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 }}>{error}</Text>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, borderTopWidth: 1, borderTopColor: SEP }}>
            {created ? (
              <>
                <Text style={{ flex: 1, color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, fontSize: 12, lineHeight: 16 }}>You can invite more people from the community any time.</Text>
                <FootButton label="Done" primary onPress={() => { const id = created.id; onClose(); router.push({ pathname: "/c/[id]", params: { id } }); }} />
              </>
            ) : !gate ? (
              <View style={{ height: 38 }} />
            ) : !gate.allowed ? (
              <><View style={{ flex: 1 }} /><FootButton label="Close" onPress={onClose} /></>
            ) : (
              <>
                {step > 0 && <FootButton label="Back" icon="arrow-back" onPress={() => go(step - 1)} />}
                <View style={{ flex: 1 }} />
                {step < 3
                  ? <FootButton label="Next" primary disabled={!canNext} onPress={() => canNext && go(step + 1)} />
                  : <FootButton label={busy ? "Creating…" : "Create community"} primary disabled={!canCreate || busy} onPress={() => void create()} />}
              </>
            )}
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ── The site's pieces (CreateCommunityModal.tsx label, hintStyle, the footer buttons) ── */

/* The new step slides in from the side it came from (globals.css ccmStepFwd / ccmStepBack). */
function StepIn({ dir, children }: { dir: 1 | -1; children: ReactNode }) {
  const reduce = useReduceMotion();
  const t = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    /* A frame after mounting: a native-driven view animated as it mounts never drew (toast.tsx). */
    const frame = requestAnimationFrame(() => Animated.timing(t, { toValue: 1, duration: 220, easing: Easing.bezier(0.2, 0.7, 0.2, 1), useNativeDriver: true }).start());
    return () => cancelAnimationFrame(frame);
  }, [reduce, t]);
  return <Animated.View style={{ gap: 20, opacity: t, transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [18 * dir, 0] }) }] }}>{children}</Animated.View>;
}

function Label({ text, optional, tight }: { text: string; optional?: boolean; tight?: boolean }) {
  return (
    <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.semi, fontSize: 11, letterSpacing: 0.66, marginBottom: tight ? 2 : 8 }}>
      {text.toUpperCase()}
      {optional && <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body }}> (OPTIONAL)</Text>}
    </Text>
  );
}

function Hint({ children, right }: { children: ReactNode; right?: boolean }) {
  return <Text style={{ color: HINT, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, marginTop: 5, textAlign: right ? "right" : "left" }}>{children}</Text>;
}

function FootButton({ label, onPress, primary, disabled, icon }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; icon?: React.ComponentProps<typeof Ionicons>["name"] }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 38, paddingHorizontal: primary ? 18 : 14, borderRadius: 19, backgroundColor: primary ? (pressed ? "#ffc22e" : colors.yellow) : pressed ? "#141418" : FIELD, borderWidth: primary ? 0 : 1, borderColor: EDGE, opacity: disabled ? 0.5 : 1 })}
    >
      {icon && <Ionicons name={icon} size={13} color="#e8e8ee" />}
      <Text style={{ color: primary ? INK : "#e8e8ee", fontFamily: primary ? fonts.bold : fonts.semi, fontSize: 13.5 }}>{label}</Text>
    </Pressable>
  );
}
