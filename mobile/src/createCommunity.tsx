/* Create a community, the site's sheet (components/community/
   CreateCommunityModal.tsx): Basics (name, type, description, rules),
   Look (colour, avatar, banner), Access (public or private with the
   application prompt), Review, then Invite friends once it exists.
   One insert, then the creator becomes owner. The database's own gate
   (community_creation_status) is shown instead of the form when it
   would refuse. */
import { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { pickImage, uploadPostImage, uploadSquareImage, type PickedImage } from "./postImages";
import { InviteFriends } from "./inviteFriends";
import { cleanTextError, BODY_MIN, NAME_MIN } from "./cleanText";
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

export function CreateCommunitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const email = session?.user.email ?? null;
  const [step, setStep] = useState(0);
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
  const [gate, setGate] = useState<CreationStatus | null>(null);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0); setCreated(null); setName(""); setKind(COMMUNITY_KINDS[0].key); setDescription(""); setRules(""); setColor(COLORS[0]);
    setAvatar(null); setBanner(null); setIsPrivate(false); setPrompt(""); setBusy(false); setError(null); setGate(null); setResent(false);
    void supabase.rpc("community_creation_status").then(({ data, error: err }) => setGate(err || !data ? { allowed: true, reason: null, count: 0, cap: null } : (data as CreationStatus)));
  }, [open]);

  const trimmed = name.trim();
  const nameIssue = cleanTextError(trimmed, NAME_MIN);
  const nameOk = trimmed.length >= NAME_MIN_LEN && trimmed.length <= NAME_MAX && !nameIssue;
  const canNext = step === 0 ? nameOk && description.length <= DESC_MAX : true;
  const canCreate = nameOk && rules.length <= RULES_MAX && (!isPrivate || prompt.length <= PROMPT_MAX);
  const kindMeta = COMMUNITY_KINDS.find((k) => k.key === kind) ?? COMMUNITY_KINDS[0];

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
      setCreated(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the community.");
    } finally {
      setBusy(false);
    }
  };

  const activeStep = created ? 4 : step;
  const label = (t: string, hint?: string) => <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.7, marginBottom: 8, marginTop: 14 }}>{t.toUpperCase()}{hint ? <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, letterSpacing: 0 }}> ({hint})</Text> : null}</Text>;
  const field = { borderRadius: 10, borderWidth: 1, borderColor: "#2e2e38", backgroundColor: "#0b0b0d", color: "#eeeef5", fontFamily: fonts.body, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 } as const;
  const hint = (t: string, bad?: boolean) => <Text style={{ color: bad ? "#ff8a80" : "rgba(238,238,245,0.42)", fontFamily: fonts.body, fontSize: 11.5, marginTop: 5 }}>{t}</Text>;
  const pill = (labelText: string, onPress: () => void, primary?: boolean, disabled?: boolean) => (
    <Pressable onPress={onPress} disabled={disabled} style={{ height: 36, paddingHorizontal: 18, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: primary ? colors.yellow : "#0b0b0d", borderWidth: primary ? 0 : 1, borderColor: "#2e2e38", opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: primary ? colors.ink : "#e8e8ee", fontFamily: fonts.bold, fontSize: 13 }}>{labelText}</Text>
    </Pressable>
  );

  const preview = (
    <View style={{ borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "#2a2a34", backgroundColor: "#0e0e11" }}>
      <View style={{ height: 84, backgroundColor: banner ? undefined : color }}>{banner && <Image source={{ uri: banner.uri }} style={{ width: "100%", height: 84 }} resizeMode="cover" />}</View>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12, paddingHorizontal: 14, paddingBottom: 12, marginTop: -26 }}>
        <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: color, borderWidth: 3, borderColor: "#101014", overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
          {avatar ? <Image source={{ uri: avatar.uri }} style={{ width: 56, height: 56 }} /> : <Text style={{ color: "#fff", fontFamily: fonts.title, fontSize: 22 }}>{(trimmed || "?").charAt(0).toUpperCase()}</Text>}
        </View>
        <View style={{ minWidth: 0, flex: 1, paddingBottom: 2 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15 }}>{trimmed || "Your community"}</Text>
          <Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 11.5, marginTop: 2 }}>{kindMeta.label} · {isPrivate ? "private" : "public"} · 1 member</Text>
        </View>
      </View>
    </View>
  );

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: "#000", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, borderColor: "#2e2e38", paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 12, maxHeight: Math.round(height * 0.9) }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 18 }}>{created ? "Invite friends" : "Create a community"}</Text>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38" }}><Ionicons name="close" size={14} color="rgba(238,238,245,0.6)" /></Pressable>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {STEPS.map((s, i) => (
              <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: i === activeStep ? colors.yellow : i < activeStep ? "#2a2a34" : "#17171c" }}>
                  {i < activeStep ? <Ionicons name="checkmark" size={10} color="#eeeef5" /> : <Text style={{ color: i === activeStep ? colors.ink : "rgba(238,238,245,0.5)", fontFamily: fonts.bold, fontSize: 10 }}>{i + 1}</Text>}
                </View>
                <Text style={{ color: i === activeStep ? colors.yellow : i < activeStep ? "rgba(238,238,245,0.7)" : "rgba(238,238,245,0.35)", fontFamily: fonts.semi, fontSize: 11 }}>{s}</Text>
                {i < STEPS.length - 1 && <View style={{ width: 8, height: 1, backgroundColor: "#2a2a34" }} />}
              </View>
            ))}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: 6 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {gate && !gate.allowed && gate.reason && (
              <View style={{ alignItems: "center", paddingVertical: 26, paddingHorizontal: 12 }}>
                <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: "#2a2410", borderWidth: 1, borderColor: "#6b5a2a", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                  <Ionicons name={gate.reason === "email_unverified" ? "mail-outline" : gate.reason === "not_verified" ? "person-circle-outline" : gate.reason === "account_too_new" ? "time-outline" : "business-outline"} size={22} color={colors.yellow} />
                </View>
                <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 16, textAlign: "center" }}>
                  {gate.reason === "email_unverified" ? "Verify your email first" : gate.reason === "not_verified" ? "Communities are for verified accounts for now" : gate.reason === "account_too_new" ? "Your account is brand new" : gate.reason === "community_limit" ? "You've made the most communities one account can" : "Sign in to create a community"}
                </Text>
                <Text style={{ color: "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 6, maxWidth: 340 }}>
                  {gate.reason === "email_unverified" ? `We sent a link to ${email ?? "your inbox"}. Open it, then come back — communities need a verified address.`
                    : gate.reason === "not_verified" ? "During the beta, only verified accounts can create a community. Join the ones that exist, post, and ask the team in the Discord if you'd like to run one."
                    : gate.reason === "account_too_new" ? `Communities open up after your first day (${Math.max(0, 24 - (gate.account_age_hours ?? 0))}h to go). Join a few communities and post in the meantime.`
                    : gate.reason === "community_limit" ? `You've created ${gate.count} of ${gate.cap ?? 3}. Owner upgrades with more communities are coming; for now, grow the ones you have.`
                    : "Communities are created from an account."}
                </Text>
                {gate.reason === "email_unverified" && email && (
                  <Pressable disabled={resent} onPress={() => void supabase.auth.resend({ type: "signup", email }).then(({ error: err }) => (err ? setError(err.message) : setResent(true)))} style={{ marginTop: 14, height: 36, paddingHorizontal: 16, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: resent ? "#17171c" : colors.yellow }}>
                    <Text style={{ color: resent ? "#c9c9d2" : colors.ink, fontFamily: fonts.bold, fontSize: 13 }}>{resent ? "Sent — check your inbox" : "Resend the link"}</Text>
                  </Pressable>
                )}
              </View>
            )}
            {created && (
              <View>
                {label(`Invite friends to ${created.name}`)}
                <InviteFriends communityId={created.id} communityName={created.name} isPrivate={isPrivate} />
              </View>
            )}
            {(!gate || gate.allowed) && !created && step === 0 && (
              <View>
                {label("Name")}
                <TextInput value={name} onChangeText={(t) => setName(t.slice(0, NAME_MAX + 10))} placeholder="e.g. Georgetown Debate Society" placeholderTextColor={colors.faint} maxLength={NAME_MAX} autoFocus style={field} />
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                  {nameIssue ? hint(nameIssue, true) : previewSlug(trimmed) ? hint(`Lives at agorasphere.net/communities/${previewSlug(trimmed)}`) : hint(`${NAME_MIN_LEN}–${NAME_MAX} characters.`)}
                  {hint(`${trimmed.length}/${NAME_MAX}`, trimmed.length > NAME_MAX)}
                </View>
                {label("Type")}
                <View style={{ gap: 8 }}>
                  {COMMUNITY_KINDS.map((k) => {
                    const on = k.key === kind;
                    return (
                      <Pressable key={k.key} onPress={() => setKind(k.key)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, backgroundColor: on ? colors.yellow : "#0b0b0d", borderWidth: 1, borderColor: on ? colors.yellow : "#2e2e38" }}>
                        <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: on ? colors.ink : "#16161a" }}><Ionicons name={k.icon} size={15} color={on ? colors.yellow : "#c0c0c8"} /></View>
                        <View style={{ minWidth: 0 }}>
                          <Text style={{ color: on ? colors.ink : "#eeeef5", fontFamily: fonts.semi, fontSize: 13 }}>{k.label}</Text>
                          <Text style={{ color: on ? "rgba(26,14,0,0.7)" : "rgba(238,238,245,0.45)", fontFamily: fonts.body, fontSize: 11 }}>{k.hint}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                {label("Description", "optional")}
                <TextInput value={description} onChangeText={(t) => setDescription(t.slice(0, DESC_MAX))} placeholder="What is this community for, and who is it for?" placeholderTextColor={colors.faint} multiline style={[field, { minHeight: 72, textAlignVertical: "top" }]} />
                {hint(`${description.length}/${DESC_MAX}`)}
                {label("Rules", "optional")}
                <TextInput value={rules} onChangeText={(t) => setRules(t.slice(0, RULES_MAX))} placeholder={"1. Stay on topic\n2. Argue the point, not the person"} placeholderTextColor={colors.faint} multiline style={[field, { minHeight: 90, textAlignVertical: "top" }]} />
                {hint("Pinned in the community's sidebar. You can edit everything later in the community's settings.")}
              </View>
            )}
            {(!gate || gate.allowed) && !created && step === 1 && (
              <View>
                <View style={{ marginTop: 14 }}>{preview}</View>
                {label("Accent colour")}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {COLORS.map((c) => <Pressable key={c} onPress={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: color === c ? 3 : 0, borderColor: "#fff", transform: [{ scale: color === c ? 1.05 : 1 }] }} />)}
                </View>
                {([["Avatar", "Square, shown beside the name.", avatar, setAvatar], ["Banner", "Wide, across the top of the community page.", banner, setBanner]] as const).map(([title, h, file, set]) => (
                  <View key={title} style={{ marginTop: 14, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#2e2e38", backgroundColor: "#0b0b0d" }}>
                    <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.7 }}>{title.toUpperCase()} <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, letterSpacing: 0 }}>(optional)</Text></Text>
                    <Text style={{ color: "rgba(238,238,245,0.42)", fontFamily: fonts.body, fontSize: 11.5, marginTop: 2, marginBottom: 10 }}>{h}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      {file && <Image source={{ uri: file.uri }} style={{ width: 44, height: 44, borderRadius: 8 }} />}
                      <Pressable onPress={() => void pick(set as (i: PickedImage | null) => void)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: "#17171c", borderWidth: 1, borderColor: "#2e2e38" }}>
                        <Ionicons name="image-outline" size={13} color="#e8e8ee" /><Text style={{ color: "#e8e8ee", fontFamily: fonts.semi, fontSize: 12 }}>{file ? "Replace" : "Upload"}</Text>
                      </Pressable>
                      {file && <Pressable onPress={() => (set as (i: PickedImage | null) => void)(null)}><Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 12 }}>Remove</Text></Pressable>}
                    </View>
                  </View>
                ))}
              </View>
            )}
            {(!gate || gate.allowed) && !created && step === 2 && (
              <View>
                {label("Who can join")}
                <View style={{ gap: 8 }}>
                  {([[false, "lock-open-outline", "Public", "Anyone can find it and join."], [true, "lock-closed-outline", "Private", "People request to join; you approve."]] as const).map(([priv, icon, title, h]) => {
                    const on = isPrivate === priv;
                    return (
                      <Pressable key={title} onPress={() => setIsPrivate(priv)} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, backgroundColor: on ? colors.yellow : "#0b0b0d", borderWidth: 1, borderColor: on ? colors.yellow : "#2e2e38" }}>
                        <Ionicons name={icon} size={15} color={on ? colors.ink : "#c0c0c8"} style={{ marginTop: 1 }} />
                        <View><Text style={{ color: on ? colors.ink : "#eeeef5", fontFamily: fonts.semi, fontSize: 13 }}>{title}</Text><Text style={{ color: on ? "rgba(26,14,0,0.72)" : "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 11.5, marginTop: 2 }}>{h}</Text></View>
                      </Pressable>
                    );
                  })}
                </View>
                {isPrivate && (
                  <View>
                    {label("Ask applicants", "optional")}
                    <TextInput value={prompt} onChangeText={(t) => setPrompt(t.slice(0, PROMPT_MAX))} placeholder="e.g. Which school are you at, and who do you know here?" placeholderTextColor={colors.faint} multiline style={[field, { minHeight: 60, textAlignVertical: "top" }]} />
                    {hint("Shown when someone requests to join; their answer comes with the request.")}
                  </View>
                )}
              </View>
            )}
            {(!gate || gate.allowed) && !created && step === 3 && (
              <View>
                <View style={{ marginTop: 14 }}>{preview}</View>
                {label("Everything, before it exists")}
                <View style={{ borderRadius: 12, borderWidth: 1, borderColor: "#2a2a34", backgroundColor: "#0b0b0d", overflow: "hidden" }}>
                  {([["Name", trimmed, 0], ["Type", kindMeta.label, 0], ["Description", description.trim() || "None", 0], ["Rules", rules.trim() ? `${rules.trim().split(/\n+/).filter(Boolean).length} rule${rules.trim().split(/\n+/).filter(Boolean).length === 1 ? "" : "s"}` : "None", 0], ["Look", `${avatar ? "Avatar" : "Initial"} · ${banner ? "banner" : "colour band"}`, 1], ["Access", isPrivate ? `Private — people apply${prompt.trim() ? ", with a question" : ""}` : "Public — anyone can join", 2]] as [string, string, number][]).map(([k, v, target], idx, arr) => (
                    <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: idx < arr.length - 1 ? 1 : 0, borderColor: "#1c1c22" }}>
                      <Text style={{ width: 84, color: "rgba(255,255,255,0.4)", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6 }}>{k.toUpperCase()}</Text>
                      <Text numberOfLines={1} style={{ flex: 1, color: "#eeeef5", fontFamily: fonts.body, fontSize: 13 }}>{v}</Text>
                      <Pressable onPress={() => setStep(target)}><Text style={{ color: "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: 12 }}>Edit</Text></Pressable>
                    </View>
                  ))}
                </View>
                {hint("You'll be the owner. Everything here can be changed later in the community's settings.")}
              </View>
            )}
            {error && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12.5, marginTop: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: "#5a2a2a", backgroundColor: "#1c1010" }}>{error}</Text>}
          </ScrollView>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 12, borderTopWidth: 1, borderColor: "#1c1c22" }}>
            {created ? (
              <>
                <Text style={{ flex: 1, color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, fontSize: 12 }}>You can invite more people from the community any time.</Text>
                {pill("Done", () => { const id = created.id; onClose(); setTimeout(() => router.push({ pathname: "/c/[id]", params: { id } }), 320); }, true)}
              </>
            ) : gate && !gate.allowed ? (
              <><View style={{ flex: 1 }} />{pill("Close", onClose)}</>
            ) : (
              <>
                {step > 0 ? pill("Back", () => setStep(step - 1)) : <View />}
                <View style={{ flex: 1 }} />
                {step < 3 ? pill("Next", () => canNext && setStep(step + 1), true, !canNext) : pill(busy ? "Creating…" : "Create community", () => void create(), true, !canCreate || busy)}
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
