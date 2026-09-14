/* New room, as the site's Create a Discussion (components/CreateRoomModal.tsx)
   draws it on a phone: the motion, the field, the language; Schedule for
   later with the system date and time picker; an optional thumbnail for
   the room's card; Private room with who can enter (the invite code, your
   followers, your friends, or the community's members) and whether
   spectators may watch. "Have an invite code?" joins someone else's
   private room. Rooms are made through the site's create_room, one atomic
   call; the thumbnail follows once the room exists. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { TOPICS, darkInkOn } from "./topics";
import { DateTimeField, hasDatePicker } from "./dateField";
import { pickImage, type PickedImage } from "./postImages";
import { uploadRoomThumbnail } from "./roomThumbnail";
import { joinWithCode } from "./roomData";
import { cleanTextError, NAME_MIN } from "./cleanText";
import { copyToClipboard } from "./clipboard";
import { showToast } from "./toast";
import { colors, fonts } from "./theme";

export interface RoomPrefill { motion?: string; topic?: string; community?: { id: string; name: string } }

const LANGS = [
  { value: "en", label: "EN" }, { value: "es", label: "ES" }, { value: "fr", label: "FR" }, { value: "zh", label: "ZH" },
  { value: "ar", label: "AR" }, { value: "pt", label: "PT" }, { value: "de", label: "DE" }, { value: "hi", label: "HI" },
];
const MOTION_MAX = 300;
type Access = "code" | "followers" | "friends" | "community";

/* Without a system picker (the web preview), the old preset times. */
type Preset = "30m" | "1h" | "2h" | "tonight" | "tomorrow";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "30m", label: "In 30 min" }, { key: "1h", label: "In 1 hour" }, { key: "2h", label: "In 2 hours" }, { key: "tonight", label: "Tonight at 8" }, { key: "tomorrow", label: "Tomorrow at 8" },
];
function presetDate(p: Preset): Date {
  const now = new Date();
  if (p === "30m") return new Date(now.getTime() + 30 * 60_000);
  if (p === "1h") return new Date(now.getTime() + 60 * 60_000);
  if (p === "2h") return new Date(now.getTime() + 120 * 60_000);
  const d = new Date(now);
  d.setHours(20, 0, 0, 0);
  if (p === "tomorrow" || d.getTime() <= now.getTime() + 60_000) d.setDate(d.getDate() + 1);
  return d;
}
/* The site's default: an hour from now, on the minute (rounded up to five for the wheels). */
function defaultStart(): Date {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return d;
}

function accessNote(mode: Access, spectators: boolean, community: string | null): string {
  if (mode === "followers") return "Hidden from listings and search. Anyone who follows you can enter directly; your invite code also works for anyone else.";
  if (mode === "friends") return "Hidden from listings and search. Only friends (people you follow back) can enter directly; your invite code also works for anyone else.";
  if (mode === "community") return `Hidden from listings and search. Only members of ${community ?? "the community"} can enter directly; your invite code also works for anyone else.`;
  return spectators
    ? "Room will appear in public listings tagged “Private”. Visitors join as spectators only; speakers must use the invite code."
    : "Room is completely hidden from all listings and search. Only people with the invite code can enter.";
}

function inviteNote(mode: Access): string {
  if (mode === "followers") return "Your followers can enter straight from the room link — share this code with anyone else you want to let in.";
  if (mode === "friends") return "Your friends can enter straight from the room link — share this code with anyone else you want to let in.";
  return "Share this code with the people you want to invite. They can enter it via “Have an invite code?” in New room, or right on the room's door screen.";
}

export function NewRoomSheet({ open, prefill, onClose }: { open: boolean; prefill: RoomPrefill; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [view, setView] = useState<"form" | "join" | "invite">("form");
  const [motion, setMotion] = useState("");
  const [topic, setTopic] = useState(TOPICS[0].key);
  const [language, setLanguage] = useState("en");
  const [schedule, setSchedule] = useState(false);
  const [startAt, setStartAt] = useState<Date>(defaultStart);
  const [preset, setPreset] = useState<Preset>("1h");
  const [thumb, setThumb] = useState<PickedImage | null>(null);
  const [isPrivate, setPrivate] = useState(false);
  const [access, setAccess] = useState<Access>("code");
  const [spectators, setSpectators] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string; roomId: string } | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const community = prefill.community ?? null;

  useEffect(() => {
    if (!open) return;
    setView("form");
    setMotion(prefill.motion ?? "");
    setTopic(prefill.topic && TOPICS.some((t) => t.key === prefill.topic) ? prefill.topic : TOPICS[0].key);
    setLanguage("en"); setSchedule(false); setStartAt(defaultStart()); setPreset("1h"); setThumb(null);
    setPrivate(false); setAccess("code"); setSpectators(false);
    setBusy(false); setError(null); setInvite(null); setCode(""); setCodeError(null);
  }, [open, prefill]);

  const minimumStart = useMemo(() => new Date(Date.now() + 2 * 60_000), [open, schedule]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const m = motion.trim();
    if (busy) return;
    if (!m) { setError("Please enter a motion or topic"); return; }
    const issue = cleanTextError(m, NAME_MIN);
    if (issue) { setError(issue); return; }
    let scheduledIso: string | null = null;
    if (schedule) {
      const at = hasDatePicker ? startAt : presetDate(preset);
      if (at.getTime() <= Date.now() + 60_000) { setError("Scheduled time must be at least 1 minute from now"); return; }
      scheduledIso = at.toISOString();
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("create_room", {
      p_motion: m,
      p_topic_key: topic,
      p_language: language,
      p_stance: "PRO",
      p_is_private: isPrivate,
      p_allow_spectators: isPrivate ? spectators : true,
      p_pro_size: 10,
      p_con_size: 10,
      p_time_limit_seconds: null,
      p_scheduled_start: scheduledIso,
      p_community: community?.id ?? null,
      p_access_mode: isPrivate ? (access === "community" && !community ? "code" : access) : "code",
    });
    if (err) {
      setBusy(false);
      const msg = err.message || "";
      setError(msg.includes("max_scheduled_rooms") || msg.includes("schedule at most 3")
        ? "You can only have 3 scheduled discussions at once. End or cancel one first."
        : msg.includes("scheduled_start_too_soon") ? "Scheduled time must be at least 1 minute from now."
        : msg.includes("not_a_mod") ? "Only moderators can start discussions for the community."
        : msg.replace(/^[a-z_]+:\s*/, "") || "Couldn't create the room.");
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { room_id?: string; invite_code?: string | null } | null;
    const roomId = row?.room_id;
    if (!roomId) { setBusy(false); setError("Room creation failed — no room came back."); return; }
    /* Best effort: the room exists either way, and cards fall back to your picture. */
    if (thumb && uid) await uploadRoomThumbnail(uid, roomId, thumb).catch(() => undefined);
    setBusy(false);
    if (isPrivate && row?.invite_code) { setInvite({ code: row.invite_code, roomId }); setView("invite"); return; }
    onClose();
    if (scheduledIso) { showToast("Discussion scheduled"); return; }
    router.push({ pathname: "/room/[id]", params: { id: roomId } });
  };

  const joinByCode = async () => {
    const c = code.trim().toUpperCase();
    if (c.length < 6 || busy) return;
    setBusy(true);
    setCodeError(null);
    const r = await joinWithCode(supabase, c);
    setBusy(false);
    if (!r.roomId) { setCodeError(r.error ?? "That code doesn't match a live room."); return; }
    onClose();
    router.push({ pathname: "/room/[id]", params: { id: r.roomId } });
  };

  const addThumb = async () => {
    try { const img = await pickImage(); if (img) setThumb(img); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't pick a picture."); }
  };

  const chip = (on: boolean, label: string, onPress: () => void, tint?: string, icon?: ReactNode) => {
    const ink = on ? (tint && darkInkOn(tint) ? colors.ink : "#fff") : "#c9c9d2";
    return (
      <Pressable key={label} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: on ? tint ?? colors.blue : colors.surface, borderWidth: 1, borderColor: on ? tint ?? colors.blue : colors.hairline }}>
        {icon}
        <Text style={{ color: ink, fontFamily: on ? fonts.semi : fonts.medium, fontSize: 12.5 }}>{label}</Text>
      </Pressable>
    );
  };
  const label = (t: string) => <Text style={{ color: "rgba(255,255,255,0.3)", fontFamily: fonts.semi, fontSize: 10, letterSpacing: 0.9, marginTop: 16, marginBottom: 8 }}>{t.toUpperCase()}</Text>;
  const note = (t: string) => <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, marginTop: 8 }}>{t}</Text>;
  const switchRow = (title: string, value: boolean, onChange: (v: boolean) => void, sub?: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 14 }}>{title}</Text>
        {!!sub && <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, marginTop: 1 }}>{sub}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.yellow, false: colors.border }} thumbColor="#fff" />
    </View>
  );

  const title = view === "join" ? "Join a private room" : view === "invite" ? "Private room created" : "New room";
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: colors.surface2, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#23232b", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 + insets.bottom, maxHeight: Math.round(height * 0.9) }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 }}>
            {view === "join" ? (
              <Pressable onPress={() => setView("form")} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Ionicons name="chevron-back" size={18} color="#c3c3ce" />
                <Text style={{ color: "#c3c3ce", fontFamily: fonts.body, fontSize: 15 }}>Back</Text>
              </Pressable>
            ) : (
              <Pressable onPress={onClose} hitSlop={8}><Text style={{ color: "#c3c3ce", fontFamily: fonts.body, fontSize: 15 }}>{view === "invite" ? "Close" : "Cancel"}</Text></Pressable>
            )}
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 16 }}>{title}</Text>
            <View style={{ width: 52 }} />
          </View>

          {view === "invite" && invite ? (
            <View style={{ paddingVertical: 14 }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }}>{inviteNote(access)}</Text>
              <Pressable onPress={() => void copyToClipboard(invite.code, "Code copied")} accessibilityLabel="Copy the invite code" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 14, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: "#17150e", borderWidth: 1, borderColor: "#5a4a26" }}>
                <Text selectable style={{ color: colors.yellow, fontFamily: fonts.title, fontSize: 30, letterSpacing: 6 }}>{invite.code}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Ionicons name="copy-outline" size={15} color="#e2b96b" />
                  <Text style={{ color: "#e2b96b", fontFamily: fonts.semi, fontSize: 12.5 }}>Copy</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => { const id = invite.roomId; onClose(); router.push({ pathname: "/room/[id]", params: { id } }); }} style={{ height: 46, borderRadius: 23, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 14.5 }}>Continue to the room</Text>
              </Pressable>
            </View>
          ) : view === "join" ? (
            <View style={{ paddingVertical: 12 }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>Enter the 6-character invite code the host shared with you.</Text>
              <TextInput
                value={code}
                onChangeText={(t) => { setCode(t.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6)); setCodeError(null); }}
                onSubmitEditing={() => void joinByCode()}
                placeholder="ABC123"
                placeholderTextColor="#6b6450"
                autoFocus
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                style={{ height: 60, borderRadius: 14, paddingHorizontal: 14, backgroundColor: "#17150e", borderWidth: 1, borderColor: codeError ? "#7a2a2a" : "#5a4a26", color: "#f5f5f0", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 24, fontWeight: "700", letterSpacing: 7, textAlign: "center" }}
              />
              {codeError && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12.5, marginTop: 10 }}>{codeError}</Text>}
              <Pressable onPress={() => void joinByCode()} disabled={busy || code.length < 6} style={{ marginTop: 18, height: 46, borderRadius: 23, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", opacity: busy || code.length < 6 ? 0.45 : 1 }}>
                <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 14.5 }}>{busy ? "Joining…" : "Join room"}</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput
                value={motion}
                onChangeText={(t) => setMotion(t.slice(0, MOTION_MAX))}
                placeholder="What's the discussion?"
                placeholderTextColor={colors.faint}
                autoFocus={!prefill.motion}
                multiline
                style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 17, lineHeight: 23, minHeight: 64, paddingVertical: 10, textAlignVertical: "top" }}
              />
              <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11, textAlign: "right" }}>{motion.length}/{MOTION_MAX}</Text>
              {community && (
                <View style={{ flexDirection: "row", gap: 8, padding: 10, borderRadius: 10, backgroundColor: "#17150e", borderWidth: 1, borderColor: "#4a4127", marginTop: 8 }}>
                  <Ionicons name="business-outline" size={14} color="#c9b06a" style={{ marginTop: 1 }} />
                  <Text style={{ flex: 1, color: "#c9b06a", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 }}>
                    This discussion belongs to <Text style={{ fontFamily: fonts.bold }}>{community.name}</Text> — members will be notified.
                  </Text>
                </View>
              )}
              {label("Field")}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {TOPICS.map((t) => chip(topic === t.key, t.label, () => setTopic(t.key), t.color, <Ionicons name={t.icon} size={13} color={topic === t.key ? (darkInkOn(t.color) ? colors.ink : "#fff") : t.color} />))}
              </View>
              {label("Language")}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{LANGS.map((l) => chip(language === l.value, l.label, () => setLanguage(l.value)))}</View>

              {switchRow("Schedule for later", schedule, setSchedule)}
              {schedule && (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.semi, fontSize: 11, letterSpacing: 0.7 }}>STARTS AT</Text>
                    {hasDatePicker && <DateTimeField value={startAt} minimumDate={minimumStart} onChange={setStartAt} />}
                  </View>
                  {!hasDatePicker && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>{PRESETS.map((p) => chip(preset === p.key, p.label, () => setPreset(p.key), colors.purple))}</View>}
                  {note("Scheduled discussions appear on Explore under the Scheduled filter. People can queue up, but the room only goes live when you hit Start. You can have at most 3 scheduled at once.")}
                </>
              )}

              {label("Thumbnail")}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Pressable onPress={() => void addThumb()} accessibilityLabel={thumb ? "Change thumbnail" : "Add a thumbnail"} style={{ width: 58, height: 58, borderRadius: 12, overflow: "hidden", backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38", borderStyle: thumb ? "solid" : "dashed", alignItems: "center", justifyContent: "center" }}>
                  {thumb ? <Image source={{ uri: thumb.uri }} style={{ width: 58, height: 58 }} resizeMode="cover" /> : <Ionicons name="image-outline" size={20} color={colors.muted} />}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16 }}>Optional cover for your room's card — defaults to your profile picture.</Text>
                  <View style={{ flexDirection: "row", gap: 14, marginTop: 5 }}>
                    <Text onPress={() => void addThumb()} style={{ color: colors.blueText, fontFamily: fonts.semi, fontSize: 12.5 }}>{thumb ? "Change" : "Add a thumbnail"}</Text>
                    {thumb && <Text onPress={() => setThumb(null)} style={{ color: "#ee8888", fontFamily: fonts.semi, fontSize: 12.5 }}>Remove</Text>}
                  </View>
                </View>
              </View>

              {switchRow("Private room", isPrivate, setPrivate)}
              {isPrivate && (
                <>
                  {label("Who can enter")}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {chip(access === "code", "Invite code", () => setAccess("code"), colors.yellow)}
                    {chip(access === "followers", "My followers", () => setAccess("followers"), colors.blue)}
                    {chip(access === "friends", "Friends only", () => setAccess("friends"), colors.blue)}
                    {community && chip(access === "community", `${community.name} members`, () => setAccess("community"), colors.blue)}
                  </View>
                  {access === "code" && switchRow("Allow spectators to watch", spectators, setSpectators)}
                  {note(accessNote(access, spectators, community?.name ?? null))}
                </>
              )}

              {error && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 12.5, marginTop: 12 }}>{error}</Text>}
              <Pressable onPress={() => void submit()} disabled={!motion.trim() || busy} style={{ marginTop: 18, height: 46, borderRadius: 23, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", opacity: !motion.trim() || busy ? 0.45 : 1 }}>
                <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 14.5 }}>{busy ? "Creating…" : schedule ? "Schedule the room" : "Start the room"}</Text>
              </Pressable>
              <Pressable onPress={() => { setView("join"); setCodeError(null); }} hitSlop={6} style={{ alignSelf: "center", paddingVertical: 12 }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.semi, fontSize: 13 }}>Have an invite code?</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
