/* Edit profile, the site's modal as a screen (components/
   EditProfileModal.tsx): the photo and the banner from the library or
   the camera, cropped by the picker and resized here, up to the avatars
   bucket; display name, the @handle with its availability check and
   its 7-day cooldown, the bio, up to five social links; saved through
   update_profile and update_profile_extras. */
import { useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/supabase";
import { useSession } from "../src/session";
import { bumpMe } from "../src/me";
import { ActionSheet, type SheetAction } from "../src/actionSheet";
import { BIO_MAX, DISPLAY_NAME_MAX, MAX_SOCIAL_LINKS, USERNAME_REGEX, findBlockedTerm, friendlyProfileError, normalizeBio, normalizeDisplayName, normalizeSocialLink, normalizeUsername } from "../src/profileText";
import { LoadingLine } from "../src/sky";
import { colors, fonts } from "../src/theme";
import { Screen } from "../src/ui";

const AVAILABILITY_DEBOUNCE_MS = 450;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const NEW_ACCOUNT_GRACE_MS = 60 * 60 * 1000;

interface Row { username: string; display_name: string | null; avatar_url: string | null; bio: string | null; banner_url: string | null; social_links: unknown; username_changed_at: string | null; created_at: string }

/* The picker crops (square for the photo, 3:1 for the banner); the
   manipulator brings the result down to size as a JPEG. */
async function pickImage(kind: "avatar" | "banner", fromCamera: boolean): Promise<{ uri: string } | { error: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ImagePicker = require("expo-image-picker") as typeof import("expo-image-picker");
  const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { error: fromCamera ? "Allow camera access in Settings to take a photo." : "Allow photo access in Settings to pick a picture." };
  const opts = { allowsEditing: true, aspect: (kind === "avatar" ? [1, 1] : [3, 1]) as [number, number], quality: 1 };
  const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync({ ...opts, mediaTypes: ["images"] });
  if (res.canceled || !res.assets?.[0]) return null;
  const asset = res.assets[0];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { manipulateAsync, SaveFormat } = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
  const resize = kind === "avatar" ? { width: 512, height: 512 } : { width: Math.min(1600, asset.width || 1600) };
  const out = await manipulateAsync(asset.uri, [{ resize }], { compress: 0.88, format: SaveFormat.JPEG });
  return { uri: out.uri };
}

async function upload(uri: string, path: string): Promise<string> {
  const buf = await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase.storage.from("avatars").upload(path, buf, { upsert: true, cacheControl: "3600", contentType: "image/jpeg" });
  if (error) throw new Error("Upload failed: " + error.message);
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

export default function EditProfile() {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [row, setRow] = useState<Row | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [uploading, setUploading] = useState<"avatar" | "banner" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"avatar" | "banner" | null>(null);
  const [availability, setAvailability] = useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!uid) return;
    let on = true;
    void supabase.from("users").select("username, display_name, avatar_url, bio, banner_url, social_links, username_changed_at, created_at").eq("id", uid).maybeSingle().then(({ data }) => {
      if (!on || !data) return;
      const r = data as Row;
      setRow(r);
      setUsername(r.username || "");
      setDisplayName(r.display_name || "");
      setBio(r.bio || "");
      setAvatarUrl(r.avatar_url || "");
      setBannerUrl(r.banner_url || "");
      setLinks(Array.isArray(r.social_links) ? r.social_links.filter((l: unknown): l is string => typeof l === "string") : []);
    });
    return () => { on = false; };
  }, [uid]);

  const cooldownUntil = (() => {
    if (!row?.username_changed_at) return null;
    const changed = new Date(row.username_changed_at).getTime();
    const created = row.created_at ? new Date(row.created_at).getTime() : 0;
    if (Date.now() - created < NEW_ACCOUNT_GRACE_MS) return null;
    const until = changed + COOLDOWN_MS;
    return until > Date.now() ? new Date(until) : null;
  })();
  const usernameLocked = !!cooldownUntil;

  useEffect(() => {
    if (!row || usernameLocked) return;
    if (timer.current) clearTimeout(timer.current);
    const trimmed = normalizeUsername(username);
    if (trimmed === row.username.toLowerCase()) { setAvailability("idle"); return; }
    if (!USERNAME_REGEX.test(trimmed)) { setAvailability("invalid"); return; }
    setAvailability("checking");
    timer.current = setTimeout(async () => {
      const { data, error: e } = await supabase.rpc("check_username_available", { p_username: trimmed });
      if (e) { setAvailability("invalid"); return; }
      setAvailability(data ? "ok" : "taken");
    }, AVAILABILITY_DEBOUNCE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [username, row, usernameLocked]);

  async function change(kind: "avatar" | "banner", fromCamera: boolean) {
    if (!uid) return;
    setError(null);
    try {
      const picked = await pickImage(kind, fromCamera);
      if (!picked) return;
      if ("error" in picked) { setError(picked.error); return; }
      setUploading(kind);
      if (kind === "avatar") setAvatarUrl(await upload(picked.uri, `${uid}/${Date.now()}.jpg`));
      else setBannerUrl(`${await upload(picked.uri, `${uid}/banner.jpg`)}?v=${Date.now()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change the picture.");
    } finally {
      setUploading(null);
    }
  }

  const displayNameBlocked = findBlockedTerm(displayName) !== null;
  const bioBlocked = findBlockedTerm(bio) !== null;
  const canSave = !!row && !saving && !uploading && availability !== "taken" && availability !== "invalid" && !displayNameBlocked && !bioBlocked;

  async function save() {
    if (!row || !canSave) return;
    setError(null);
    const trimmed = normalizeUsername(username);
    if (!usernameLocked && findBlockedTerm(trimmed)) { setError("Username contains a blocked term."); return; }
    if (!USERNAME_REGEX.test(trimmed)) { setError("Username must be 3–20 chars, lowercase letters, numbers, or underscores."); return; }
    setSaving(true);
    const { error: e1 } = await supabase.rpc("update_profile", {
      p_username: usernameLocked ? row.username : trimmed,
      p_avatar_url: avatarUrl,
      p_bio: normalizeBio(bio),
      p_display_name: normalizeDisplayName(displayName),
    });
    if (e1) { setSaving(false); setError(friendlyProfileError(e1.message || "") ?? "Could not save — " + e1.message); return; }
    const normalizedLinks = links.map((l) => normalizeSocialLink(l)).filter((l): l is string => l !== null).slice(0, MAX_SOCIAL_LINKS);
    const { error: e2 } = await supabase.rpc("update_profile_extras", { p_banner_url: bannerUrl, p_social_links: normalizedLinks });
    setSaving(false);
    if (e2) { setError(friendlyProfileError(e2.message || "") ?? "Could not save — " + e2.message); return; }
    bumpMe();
    router.back();
  }

  const sheetActions: SheetAction[] = sheet ? [
    { label: sheet === "avatar" ? "Choose a photo" : "Choose a picture", onPress: () => void change(sheet, false) },
    { label: "Take a photo", onPress: () => void change(sheet, true) },
    ...((sheet === "avatar" ? avatarUrl : bannerUrl) ? [{ label: sheet === "avatar" ? "Remove photo" : "Remove banner", danger: true, onPress: () => (sheet === "avatar" ? setAvatarUrl("") : setBannerUrl("")) }] : []),
  ] : [];

  const label = (text: string, hint?: string) => (
    <Text style={{ color: colors.muted, fontFamily: fonts.semi, fontSize: 11.5, letterSpacing: 0.2, marginBottom: 6, marginTop: 4 }}>{text}{hint ? <Text style={{ color: colors.faint, fontFamily: fonts.body }}> — {hint}</Text> : null}</Text>
  );
  const counter = (n: number, max: number, blocked: boolean, note: string) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", minHeight: 16, marginTop: 5, marginBottom: 14 }}>
      <Text style={{ color: blocked ? "#fca5a5" : colors.faint, fontFamily: fonts.body, fontSize: 11 }}>{blocked ? note : ""}</Text>
      <Text style={{ color: blocked ? "#fca5a5" : n >= max ? "#fbbf24" : colors.faint, fontFamily: fonts.body, fontSize: 11 }}>{n}/{max}</Text>
    </View>
  );

  return (
    <Screen style={{ paddingHorizontal: 16 }}>
      <Stack.Screen options={{ title: "Edit profile", headerBackTitle: "Back" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        {!row ? <LoadingLine /> : (
          <ScrollView contentContainerStyle={{ paddingTop: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {error && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, marginBottom: 14, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: "#5a2a2a", backgroundColor: "#1c1010" }}>{error}</Text>}

            <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 18 }}>
              <Pressable onPress={() => setSheet("avatar")} disabled={!!uploading} accessibilityLabel="Change photo">
                <View style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: avatarUrl ? colors.border : "#3a3a44", borderStyle: avatarUrl ? "solid" : "dashed", backgroundColor: colors.surface2, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
                  {avatarUrl ? <Image source={{ uri: avatarUrl }} style={{ width: 68, height: 68 }} /> : <Ionicons name="person-outline" size={26} color={colors.faint} />}
                </View>
                <View style={{ position: "absolute", right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.blue, borderWidth: 2.5, borderColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="camera" size={12} color="#fff" />
                </View>
              </Pressable>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 12.5 }}>{uploading === "avatar" ? "Uploading…" : "Tap the photo to change it"}</Text>
                <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11 }}>From your library or the camera, cropped square</Text>
              </View>
            </View>

            {label("Banner", "across the top of your profile, 3:1")}
            <Pressable onPress={() => setSheet("banner")} disabled={!!uploading} style={{ aspectRatio: 3, borderRadius: 12, overflow: "hidden", backgroundColor: colors.surface2, borderWidth: bannerUrl ? 1 : 2, borderStyle: bannerUrl ? "solid" : "dashed", borderColor: bannerUrl ? colors.border : "#3a3a44", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
              {bannerUrl ? <Image source={{ uri: bannerUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="image-outline" size={16} color={colors.faint} />
                  <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12 }}>{uploading === "banner" ? "Uploading…" : "Tap to add a banner"}</Text>
                </View>
              )}
            </Pressable>
            <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11, marginBottom: 16 }}>{uploading === "banner" ? "Uploading…" : "Resized to 1600px wide"}</Text>

            {label("Display name", "shown next to your handle, change anytime")}
            <TextInput value={displayName} onChangeText={(t) => setDisplayName(t.slice(0, DISPLAY_NAME_MAX))} onBlur={() => setDisplayName((v) => normalizeDisplayName(v))} maxLength={DISPLAY_NAME_MAX} placeholder="e.g. Jordan J." placeholderTextColor={colors.faint} style={[styles.input, displayNameBlocked && styles.inputBad]} />
            {counter(displayName.length, DISPLAY_NAME_MAX, displayNameBlocked, "Display name contains a blocked term")}

            {label("Username", "your @handle, once every 7 days")}
            <View>
              <Text style={{ position: "absolute", left: 14, top: 11, color: colors.faint, fontFamily: fonts.medium, fontSize: 14, zIndex: 1 }}>@</Text>
              <TextInput value={username} editable={!usernameLocked} onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))} autoCapitalize="none" autoCorrect={false} placeholder="your_handle" placeholderTextColor={colors.faint} style={[styles.input, { paddingLeft: 30, opacity: usernameLocked ? 0.55 : 1 }]} />
              {usernameLocked && <Ionicons name="lock-closed-outline" size={13} color={colors.faint} style={{ position: "absolute", right: 14, top: 13 }} />}
            </View>
            <Text style={{ minHeight: 18, marginTop: 5, marginBottom: 14, fontFamily: fonts.body, fontSize: 11.5, color: availability === "ok" ? "#22c55e" : availability === "taken" || availability === "invalid" ? "#fca5a5" : colors.faint }}>
              {usernameLocked ? `Locked — you can change it again on ${cooldownUntil!.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`
                : availability === "checking" ? "Checking availability…"
                : availability === "ok" ? "✓ Available"
                : availability === "taken" ? "Already taken"
                : availability === "invalid" ? "3–20 chars: a–z, 0–9, underscores"
                : "3–20 chars: lowercase letters, numbers, underscores"}
            </Text>

            {label("Bio", "optional")}
            <TextInput value={bio} onChangeText={(t) => setBio(t.slice(0, BIO_MAX))} onBlur={() => setBio((v) => normalizeBio(v))} maxLength={BIO_MAX} multiline placeholder="Tell the community something about you…" placeholderTextColor={colors.faint} style={[styles.input, { minHeight: 84, textAlignVertical: "top" }, bioBlocked && styles.inputBad]} />
            {counter(bio.length, BIO_MAX, bioBlocked, "Bio contains a blocked term")}

            {label("Social links", `up to ${MAX_SOCIAL_LINKS}, https only`)}
            {links.map((link, i) => {
              const invalid = link.trim() !== "" && normalizeSocialLink(link) === null;
              return (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <TextInput value={link} onChangeText={(t) => setLinks((prev) => prev.map((l, j) => (j === i ? t.slice(0, 200) : l)))} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="e.g. instagram.com/your_handle" placeholderTextColor={colors.faint} style={[styles.input, { flex: 1, marginBottom: 0 }, invalid && styles.inputBad]} />
                  <Pressable onPress={() => setLinks((prev) => prev.filter((_, j) => j !== i))} accessibilityLabel="Remove link" style={{ width: 36, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border }}>
                    <Ionicons name="close" size={14} color={colors.muted} />
                  </Pressable>
                </View>
              );
            })}
            {links.length < MAX_SOCIAL_LINKS && (
              <Pressable onPress={() => setLinks((prev) => [...prev, ""])} style={{ alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, marginBottom: 20 }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.semi, fontSize: 12 }}>+ Add link</Text>
              </Pressable>
            )}

            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Pressable onPress={() => router.back()} disabled={saving} style={{ flex: 1, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.semi, fontSize: 13.5 }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void save()} disabled={!canSave} style={{ flex: 1, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.blue, opacity: canSave ? 1 : 0.5 }}>
                <Text style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 13.5 }}>{saving ? "Saving…" : "Save changes"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
      <ActionSheet open={!!sheet} title={sheet === "avatar" ? "Profile photo" : "Banner"} onClose={() => setSheet(null)} actions={sheetActions} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.text, fontFamily: fonts.body, fontSize: 13.5, paddingHorizontal: 14, paddingVertical: 10, minHeight: 40 },
  inputBad: { borderColor: "#7a3535" },
});
