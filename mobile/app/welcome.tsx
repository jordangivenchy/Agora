/* Welcome, the site's first-run flow (app/welcome): set up the profile
   — a photo, a display name, the @handle, a bio — then follow a few
   people. Skippable at every step. */
import { useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/supabase";
import { useSession } from "../src/session";
import { bumpMe } from "../src/me";
import { fetchSuggestions, type Suggestion } from "../src/feed";
import { setFollowing } from "../src/profile";
import { Avatar } from "../src/avatar";
import { friendlyProfileError, normalizeUsername, USERNAME_REGEX } from "../src/profileText";
import { LoadingLine } from "../src/sky";
import { colors, fonts } from "../src/theme";
import { Button, Screen, Sub, Title } from "../src/ui";

const AVAILABILITY_DEBOUNCE_MS = 450;

export default function Welcome() {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [loaded, setLoaded] = useState(false);
  const [initialUsername, setInitialUsername] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"profile" | "follow">("profile");
  const [people, setPeople] = useState<Suggestion[] | null>(null);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [availability, setAvailability] = useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!uid) { router.replace("/sign-in"); return; }
    let on = true;
    void supabase.from("users").select("username, display_name, avatar_url, bio").eq("id", uid).maybeSingle().then(({ data }) => {
      if (!on) return;
      const r = data as { username: string | null; display_name: string | null; avatar_url: string | null; bio: string | null } | null;
      const meta = (session?.user.user_metadata ?? {}) as { full_name?: string; name?: string };
      setInitialUsername(r?.username || "");
      setUsername(r?.username || "");
      setAvatarUrl(r?.avatar_url || "");
      setBio(r?.bio || "");
      setDisplayName(r?.display_name || meta.full_name || meta.name || "");
      setLoaded(true);
    });
    return () => { on = false; };
  }, [uid, session?.user.user_metadata]);

  useEffect(() => {
    if (!loaded) return;
    if (timer.current) clearTimeout(timer.current);
    const trimmed = normalizeUsername(username);
    if (trimmed === initialUsername.toLowerCase()) { setAvailability("idle"); return; }
    if (!USERNAME_REGEX.test(trimmed)) { setAvailability("invalid"); return; }
    setAvailability("checking");
    timer.current = setTimeout(async () => {
      const { data, error: e } = await supabase.rpc("check_username_available", { p_username: trimmed });
      if (e) { setAvailability("invalid"); return; }
      setAvailability(data ? "ok" : "taken");
    }, AVAILABILITY_DEBOUNCE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [username, loaded, initialUsername]);

  useEffect(() => {
    if (step !== "follow") return;
    void fetchSuggestions(supabase, 8).then((rows) => { if (rows.length === 0) router.replace("/"); else setPeople(rows); });
  }, [step]);

  async function pickPhoto() {
    if (!uid) return;
    setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ImagePicker = require("expo-image-picker") as typeof import("expo-image-picker");
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setError("Allow photo access in Settings to add a picture."); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
      if (res.canceled || !res.assets?.[0]) return;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { manipulateAsync, SaveFormat } = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
      const out = await manipulateAsync(res.assets[0].uri, [{ resize: { width: 512, height: 512 } }], { compress: 0.88, format: SaveFormat.JPEG });
      setUploading(true);
      const buf = await (await fetch(out.uri)).arrayBuffer();
      const path = `${uid}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, buf, { upsert: true, cacheControl: "3600", contentType: "image/jpeg" });
      if (upErr) { setError("Upload failed: " + upErr.message); return; }
      setAvatarUrl(supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the photo.");
    } finally {
      setUploading(false);
    }
  }

  async function next() {
    setError(null);
    const trimmed = normalizeUsername(username);
    if (!USERNAME_REGEX.test(trimmed)) { setError("Username must be 3–20 characters: lowercase letters, numbers, or underscores."); return; }
    if (availability === "taken") { setError("That username is already taken."); return; }
    setSaving(true);
    const { error: e } = await supabase.rpc("update_profile", { p_username: trimmed, p_avatar_url: avatarUrl || null, p_bio: bio || null, p_display_name: displayName });
    setSaving(false);
    if (e) { setError(friendlyProfileError(e.message || "") ?? "Could not save — " + e.message); return; }
    bumpMe();
    setStep("follow");
  }

  const toggleFollow = async (p: Suggestion) => {
    const on = !followed.has(p.id);
    setFollowed((f) => { const n = new Set(f); if (on) n.add(p.id); else n.delete(p.id); return n; });
    try { await setFollowing(supabase, p.id, on); } catch { setFollowed((f) => { const n = new Set(f); if (on) n.delete(p.id); else n.add(p.id); return n; }); }
  };

  const canContinue = !saving && !uploading && availability !== "taken" && availability !== "invalid";
  const hint = availability === "checking" ? "Checking availability…" : availability === "ok" ? "Available" : availability === "taken" ? "Already taken — try another" : availability === "invalid" ? "3–20 characters: a–z, 0–9, underscores" : "3–20 characters: lowercase letters, numbers, underscores";
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.text, fontFamily: fonts.body, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 } as const;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: 60 }} keyboardShouldPersistTaps="handled">
          <View style={{ maxWidth: 420, width: "100%", alignSelf: "center" }}>
            {step === "follow" ? (
              <>
                <Title>Follow a few people</Title>
                <Sub>Their discussions and posts will show up in your feed. Optional — you can always find more under People.</Sub>
                {!people ? <LoadingLine /> : people.map((p) => (
                  <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}>
                    <Avatar url={p.avatar_url} name={p.display_name || p.username} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 14 }}>{p.display_name?.trim() || `@${p.username}`}</Text>
                      <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>@{p.username}{p.reason ? ` · ${p.reason}` : ""}</Text>
                    </View>
                    <Pressable onPress={() => void toggleFollow(p)} style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: followed.has(p.id) ? colors.surface2 : colors.blue, borderWidth: followed.has(p.id) ? 1 : 0, borderColor: colors.border }}>
                      <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 12.5 }}>{followed.has(p.id) ? "Following" : "Follow"}</Text>
                    </Pressable>
                  </View>
                ))}
                <View style={{ height: 18 }} />
                <Button onPress={() => router.replace("/")}>{followed.size > 0 ? `Continue (${followed.size} followed)` : "Continue"}</Button>
                <Pressable onPress={() => router.replace("/")} style={{ marginTop: 16, alignSelf: "center" }}><Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 13 }}>Skip</Text></Pressable>
              </>
            ) : (
              <>
                <Title>Set up your profile</Title>
                <Sub>This is how other speakers will see you. You can change it anytime.</Sub>
                {error && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 12.5, marginBottom: 12 }}>{error}</Text>}
                {!loaded ? <LoadingLine label="Loading your profile" /> : (
                  <>
                    <View style={{ alignItems: "center", marginBottom: 18 }}>
                      <Pressable onPress={() => void pickPhoto()} disabled={uploading}>
                        <View style={{ width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface2, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
                          {avatarUrl ? <Image source={{ uri: avatarUrl }} style={{ width: 84, height: 84 }} /> : <Ionicons name="person-outline" size={32} color={colors.faint} />}
                        </View>
                        <View style={{ position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.blue, borderWidth: 2.5, borderColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="camera" size={13} color="#fff" />
                        </View>
                      </Pressable>
                      <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginTop: 8 }}>{uploading ? "Uploading…" : "Add a photo"}</Text>
                    </View>
                    <TextInput value={displayName} onChangeText={(t) => setDisplayName(t.slice(0, 40))} placeholder="Display name (optional)" placeholderTextColor={colors.faint} style={input} />
                    <View>
                      <Text style={{ position: "absolute", left: 14, top: 13, color: colors.faint, fontFamily: fonts.medium, fontSize: 15, zIndex: 1 }}>@</Text>
                      <TextInput value={username} onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))} placeholder="your_handle" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} style={[input, { paddingLeft: 32, marginBottom: 4 }]} />
                    </View>
                    <Text style={{ color: availability === "ok" ? "#22c55e" : availability === "taken" || availability === "invalid" ? "#fca5a5" : colors.faint, fontFamily: fonts.body, fontSize: 11.5, marginBottom: 12 }}>{hint}</Text>
                    <TextInput value={bio} onChangeText={(t) => setBio(t.slice(0, 240))} placeholder="Bio (optional) — tell the community something about you…" placeholderTextColor={colors.faint} multiline style={[input, { minHeight: 80, textAlignVertical: "top" }]} />
                    <Button onPress={() => void next()} disabled={!canContinue} busy={saving}>Continue</Button>
                  </>
                )}
                <Pressable onPress={() => router.replace("/")} style={{ marginTop: 16, alignSelf: "center" }}><Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 13 }}>Skip for now</Text></Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
