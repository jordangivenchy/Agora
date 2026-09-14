/* Start a discussion, the site's create modal (components/CreateRoomModal.tsx)
   as it stands on a phone: a card over the middle of the screen, the header
   pinned (the title, Discussion | Community, the close button), the form
   scrolling — the topic, the category, the language; Schedule for later
   with the system date and time picker; an optional thumbnail for the
   room's card; Private Room with who can enter (the invite code, your
   followers, your friends, or the community's members) and whether
   spectators may watch — and the footer pinned under it: "Have an invite
   code?" and Create room. The invite code joins someone else's private
   room in a card of its own; a private room shows its code when it's made.
   Rooms are made through the site's create_room, one atomic call; the
   thumbnail follows once the room exists. The card lives in create.tsx's
   modal, trading places with the community card from the header's tabs. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Image, KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
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

/* The site's LANGUAGES (types/database.ts). */
const LANGS = [
  { value: "en", label: "English" }, { value: "es", label: "Spanish" }, { value: "fr", label: "French" }, { value: "zh", label: "Mandarin" },
  { value: "ar", label: "Arabic" }, { value: "pt", label: "Portuguese" }, { value: "de", label: "German" }, { value: "hi", label: "Hindi" },
];

/* The site's modal palette (globals.css tokens). */
const INK = "#1a0e00";
const TEXT = "#f4f4f5";
const MUTED = "rgba(244,244,245,0.55)";
const DIM = "rgba(244,244,245,0.32)";
const LINE = "rgba(255,255,255,0.08)";
const FIELD = "#0b0b0d";
const BLUE = "#3b82f6";
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

/** Mounted each time the modal opens it, so it starts fresh. */
export function NewRoomCard({ prefill, onClose, onCreateCommunity }: { prefill: RoomPrefill; onClose: () => void; onCreateCommunity?: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [view, setView] = useState<"form" | "join" | "invite">("form");
  const [motion, setMotion] = useState(prefill.motion ?? "");
  const [focused, setFocused] = useState(false);
  const [topic, setTopic] = useState(prefill.topic && TOPICS.some((t) => t.key === prefill.topic) ? prefill.topic : TOPICS[0].key);
  const [language, setLanguage] = useState("en");
  const [langOpen, setLangOpen] = useState(false);
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
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const community = prefill.community ?? null;

  const minimumStart = useMemo(() => new Date(Date.now() + 2 * 60_000), [schedule]); // eslint-disable-line react-hooks/exhaustive-deps
  /* The site checks the words as they're typed and holds the button while they're off. */
  const motionIssue = motion.trim() ? cleanTextError(motion, NAME_MIN) : null;

  /* Sections open and close, and the card changes what it shows, smoothly. */
  const animate = () => LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
  const go = (next: "form" | "join" | "invite") => { animate(); setView(next); };

  const submit = async () => {
    const m = motion.trim();
    if (busy) return;
    if (!m) { setError("Please enter a motion or topic"); return; }
    if (motionIssue) { setError(motionIssue); return; }
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
        : msg.replace(/^[a-z_]+:\s*/, "") || "Failed to create room");
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { room_id?: string; invite_code?: string | null } | null;
    const roomId = row?.room_id;
    if (!roomId) { setBusy(false); setError("Room creation failed — no room ID returned."); return; }
    /* Best effort: the room exists either way, and cards fall back to your picture. */
    if (thumb && uid) await uploadRoomThumbnail(uid, roomId, thumb).catch(() => undefined);
    setBusy(false);
    if (isPrivate && row?.invite_code) { setInvite({ code: row.invite_code, roomId }); go("invite"); return; }
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

  const copyCode = async () => {
    if (!invite) return;
    if (await copyToClipboard(invite.code, "Code copied")) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const cardH = Math.min(Math.round(height * 0.88), height - insets.top - insets.bottom - 24);

  return (
    /* The keyboard lifts the card's floor and the card gives up height to
       fit (flexShrink), header and footer staying on screen. KeyboardAvoidingView
       replaces its own bottom padding, so the safe-area padding sits on the
       view inside it, and the keyboard covers the home indicator's share. A
       percentage maxHeight clamped the card but Yoga still centred it by its
       full height, which sent the header off the top of the screen. */
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={-insets.bottom} pointerEvents="box-none" style={{ flex: 1 }}>
      <View pointerEvents="box-none" style={{ flex: 1, justifyContent: "center", paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, paddingHorizontal: 12 }}>
        {view === "form" ? (
          <View style={[CARD, { height: cardH, flexShrink: 1 }]}>
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingTop: 16, paddingRight: 16, paddingBottom: 12, paddingLeft: 20, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" }}>
              <View>
                <Text style={{ color: TEXT, fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.36 }}>Start a discussion</Text>
                {onCreateCommunity && (
                  <View accessibilityRole="tablist" style={{ flexDirection: "row", alignSelf: "flex-start", marginTop: 10, padding: 3, gap: 2, borderRadius: 999, backgroundColor: FIELD, borderWidth: 1, borderColor: LINE }}>
                    <View accessibilityRole="tab" accessibilityState={{ selected: true }} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.yellow }}>
                      <Ionicons name="mic" size={12} color={INK} />
                      <Text style={{ color: INK, fontFamily: fonts.bold, fontSize: 12 }}>Discussion</Text>
                    </View>
                    <Pressable accessibilityRole="tab" accessibilityState={{ selected: false }} onPress={onCreateCommunity} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, opacity: pressed ? 0.7 : 1 })}>
                      <Ionicons name="people-outline" size={12} color="rgba(238,238,245,0.7)" />
                      <Text style={{ color: "rgba(238,238,245,0.7)", fontFamily: fonts.semi, fontSize: 12 }}>Community</Text>
                    </Pressable>
                  </View>
                )}
              </View>
              <CloseButton onPress={onClose} />
            </View>

            {/* Body */}
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18, gap: 16 }}>
              {!!error && (
                <View style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: "#140909", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)" }}>
                  <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 13, lineHeight: 18 }}>{error}</Text>
                </View>
              )}

              <Group label="Topic">
                <TextInput
                  value={motion}
                  onChangeText={(t) => { setMotion(t.slice(0, MOTION_MAX)); if (error) setError(null); }}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="State the motion or topic..."
                  placeholderTextColor={DIM}
                  multiline
                  submitBehavior="blurAndSubmit"
                  returnKeyType="done"
                  maxLength={MOTION_MAX}
                  style={{ minHeight: 44, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 12, borderRadius: 10, backgroundColor: FIELD, borderWidth: 1, borderColor: focused ? "rgba(255,255,255,0.24)" : LINE, color: "rgba(255,255,255,0.9)", fontFamily: fonts.body, fontSize: 14, lineHeight: 19, textAlignVertical: "top" }}
                />
                {!!motionIssue && <Text style={{ color: "#ff8a80", fontFamily: fonts.body, fontSize: 12, marginTop: 6 }}>{motionIssue}</Text>}
              </Group>

              <Group label="Category">
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {TOPICS.map((t) => {
                    const on = topic === t.key;
                    const ink = on ? (darkInkOn(t.color) ? INK : "#fff") : "#c9c9d2";
                    return (
                      <Pill key={t.key} on={on} fill={t.color} onPress={() => setTopic(t.key)}>
                        <Ionicons name={t.icon} size={14} color={on ? ink : t.color} />
                        <Text style={{ color: ink, fontFamily: on ? fonts.semi : fonts.medium, fontSize: 12.5 }}>{t.label}</Text>
                      </Pill>
                    );
                  })}
                </View>
              </Group>

              <Group label="Language">
                <Pressable
                  onPress={() => { animate(); setLangOpen((v) => !v); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Language, ${LANGS.find((l) => l.value === language)?.label}`}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 44, paddingHorizontal: 13, borderRadius: 10, backgroundColor: pressed ? "#111114" : FIELD, borderWidth: 1, borderColor: langOpen ? "rgba(255,255,255,0.24)" : LINE })}
                >
                  <Text style={{ color: "rgba(255,255,255,0.9)", fontFamily: fonts.body, fontSize: 14 }}>{LANGS.find((l) => l.value === language)?.label}</Text>
                  <Ionicons name={langOpen ? "chevron-up" : "chevron-down"} size={15} color={MUTED} />
                </Pressable>
                {langOpen && (
                  <View style={{ marginTop: 6, borderRadius: 10, backgroundColor: FIELD, borderWidth: 1, borderColor: LINE, overflow: "hidden" }}>
                    {LANGS.map((l, i) => (
                      <Pressable
                        key={l.value}
                        onPress={() => { animate(); setLanguage(l.value); setLangOpen(false); }}
                        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 40, paddingHorizontal: 13, backgroundColor: pressed ? "#16161b" : "transparent", borderTopWidth: i ? 1 : 0, borderTopColor: "rgba(255,255,255,0.05)" })}
                      >
                        <Text style={{ color: language === l.value ? TEXT : "#c9c9d2", fontFamily: language === l.value ? fonts.semi : fonts.body, fontSize: 14 }}>{l.label}</Text>
                        {language === l.value && <Ionicons name="checkmark" size={16} color={colors.yellow} />}
                      </Pressable>
                    ))}
                  </View>
                )}
              </Group>

              {/* Schedule */}
              <Box>
                {community && (
                  <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: "#0f0d07", borderWidth: 1, borderColor: "rgba(201,176,106,0.25)", marginBottom: 10 }}>
                    <Ionicons name="business-outline" size={13} color="#c9b06a" style={{ marginTop: 2 }} />
                    <Text style={{ flex: 1, color: "#c9b06a", fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16 }}>
                      This discussion belongs to <Text style={{ fontFamily: fonts.bold }}>{community.name}</Text> — members will be notified.
                    </Text>
                  </View>
                )}
                <Toggle label="Schedule for later" value={schedule} onChange={(v) => { animate(); setSchedule(v); }} />
                {schedule && (
                  <>
                    <Divider />
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.semi, fontSize: 11, letterSpacing: 0.66 }}>STARTS AT</Text>
                      {hasDatePicker && <DateTimeField value={startAt} minimumDate={minimumStart} onChange={setStartAt} />}
                    </View>
                    {!hasDatePicker && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                        {PRESETS.map((pr) => (
                          <Pill key={pr.key} on={preset === pr.key} fill={BLUE} onPress={() => setPreset(pr.key)}>
                            <Text style={{ color: preset === pr.key ? "#fff" : "#c9c9d2", fontFamily: fonts.medium, fontSize: 12.5 }}>{pr.label}</Text>
                          </Pill>
                        ))}
                      </View>
                    )}
                    <Note>Scheduled discussions appear on Explore under the Scheduled filter. People can queue up, but the room only goes live when you hit Start. You can have at most 3 scheduled at once.</Note>
                  </>
                )}
              </Box>

              {/* Thumbnail */}
              <Box>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Pressable onPress={() => void addThumb()} accessibilityLabel={thumb ? "Change thumbnail" : "Add a thumbnail"} style={({ pressed }) => ({ width: 56, height: 56, borderRadius: 12, overflow: "hidden", backgroundColor: pressed ? "#141418" : FIELD, borderWidth: 1, borderStyle: thumb ? "solid" : "dashed", borderColor: thumb ? LINE : "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" })}>
                    {thumb ? <Image source={{ uri: thumb.uri }} style={{ width: 56, height: 56 }} resizeMode="cover" /> : <Ionicons name="add" size={22} color="rgba(255,255,255,0.5)" />}
                  </Pressable>
                  <Pressable onPress={() => void addThumb()} style={{ flex: 1 }}>
                    <Text style={{ color: "rgba(255,255,255,0.78)", fontFamily: fonts.semi, fontSize: 13 }}>Thumbnail</Text>
                    <Text style={{ color: DIM, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, marginTop: 2 }}>Optional cover for your room's card — defaults to your profile picture.</Text>
                  </Pressable>
                  {thumb && (
                    <Pressable onPress={() => setThumb(null)} style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: pressed ? "#141418" : FIELD, borderWidth: 1, borderColor: LINE })}>
                      <Text style={{ color: MUTED, fontFamily: fonts.semi, fontSize: 11.5 }}>Remove</Text>
                    </Pressable>
                  )}
                </View>
              </Box>

              {/* Private Room */}
              <Box>
                <Toggle label="Private Room" value={isPrivate} onChange={(v) => { animate(); setPrivate(v); }} />
                {isPrivate && (
                  <>
                    <Divider />
                    <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.semi, fontSize: 11, letterSpacing: 0.66, marginBottom: 8 }}>WHO CAN ENTER</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                      {([["code", "Invite code"], ["followers", "My followers"], ["friends", "Friends only"], ...(community ? [["community", `${community.name} members`]] : [])] as [Access, string][]).map(([key, lab]) => (
                        <Pill key={key} on={access === key} fill="#2f7fe0" onPress={() => { animate(); setAccess(key); }}>
                          <Text style={{ color: access === key ? "#fff" : "#c9c9d2", fontFamily: fonts.medium, fontSize: 12.5 }}>{lab}</Text>
                        </Pill>
                      ))}
                    </View>
                    {access === "code" && <Toggle label="Allow spectators to watch" value={spectators} onChange={setSpectators} />}
                    <Note>{accessNote(access, spectators, community?.name ?? null)}</Note>
                  </>
                )}
              </Box>
            </ScrollView>

            {/* Footer */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" }}>
              <Pressable onPress={() => { setCodeError(null); go("join"); }} hitSlop={8} style={{ paddingVertical: 9, paddingHorizontal: 4 }}>
                <Text style={{ color: MUTED, fontFamily: fonts.body, fontSize: 13, textDecorationLine: "underline" }}>Have an invite code?</Text>
              </Pressable>
              <YellowButton label={busy ? "Creating…" : schedule ? "Schedule discussion" : "Create room"} disabled={busy || !motion.trim() || !!motionIssue} onPress={() => void submit()} />
            </View>
          </View>
        ) : view === "join" ? (
          <View style={[CARD, { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20 }]}>
            <Text style={{ color: TEXT, fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, marginBottom: 6 }}>Join a private room</Text>
            <Text style={{ color: MUTED, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, marginBottom: 18 }}>Enter the 6-character invite code the host shared with you.</Text>
            <TextInput
              value={code}
              onChangeText={(t) => { setCode(t.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6)); setCodeError(null); }}
              onSubmitEditing={() => void joinByCode()}
              placeholder="ABC123"
              placeholderTextColor="#5c5442"
              autoFocus
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              style={{ height: 58, borderRadius: 14, paddingHorizontal: 12, backgroundColor: "#0d0b07", borderWidth: 1, borderColor: codeError ? "rgba(239,68,68,0.5)" : "rgba(226,185,107,0.35)", color: TEXT, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 24, fontWeight: "700", letterSpacing: 7, textAlign: "center" }}
            />
            {!!codeError && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12.5, marginTop: 10 }}>{codeError}</Text>}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18 }}>
              <Pressable onPress={() => go("form")} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 9, paddingHorizontal: 4 }}>
                <Ionicons name="arrow-back" size={14} color={MUTED} />
                <Text style={{ color: MUTED, fontFamily: fonts.body, fontSize: 13.5 }}>Back</Text>
              </Pressable>
              <Pressable onPress={() => void joinByCode()} disabled={busy || code.length < 6} style={({ pressed }) => ({ paddingHorizontal: 26, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#e2ad45" : "#d9a238", opacity: busy || code.length < 6 ? 0.5 : 1 })}>
                <Text style={{ color: "#2b1a02", fontFamily: fonts.semi, fontSize: 14 }}>{busy ? "Joining…" : "Join room"}</Text>
              </Pressable>
            </View>
          </View>
        ) : invite ? (
          <View style={[CARD, { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20 }]}>
            <Text style={{ color: TEXT, fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, marginBottom: 6 }}>Private room created</Text>
            <Text style={{ color: MUTED, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, marginBottom: 20 }}>{inviteNote(access)}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 16, borderRadius: 14, backgroundColor: "#0d0b07", borderWidth: 1, borderColor: "rgba(226,185,107,0.35)", marginBottom: 16 }}>
              <Text selectable style={{ color: "#ffdd85", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 26, fontWeight: "700", letterSpacing: 5.5 }}>{invite.code}</Text>
              <Pressable onPress={() => void copyCode()} accessibilityLabel="Copy the invite code" style={({ pressed }) => ({ paddingHorizontal: 14, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#241c0c" : "#1a1508", borderWidth: 1, borderColor: "rgba(226,185,107,0.45)" })}>
                <Text style={{ color: "#ffdd85", fontFamily: fonts.semi, fontSize: 12 }}>{copied ? "Copied!" : "Copy"}</Text>
              </Pressable>
            </View>
            <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: "#060607", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", marginBottom: 18 }}>
              <Text style={{ color: MUTED, fontFamily: fonts.body, fontSize: 12, lineHeight: 18 }}>
                {spectators ? "This room will appear in public listings marked “Private”. Anyone can watch as a spectator, but only invited users can speak." : "This room is fully hidden — it won't appear anywhere. Only people with the code can enter."}
              </Text>
            </View>
            <Pressable
              onPress={() => { const id = invite.roomId; onClose(); if (!schedule) router.push({ pathname: "/room/[id]", params: { id } }); }}
              style={({ pressed }) => ({ height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#5b9bf8" : BLUE })}
            >
              <Text style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 14.5 }}>{schedule ? "Done" : "Enter room"}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

/* ── The site's pieces (CreateRoomModal.tsx FieldGroup, PillSelect, Toggle) ── */

const CARD = { backgroundColor: "#000", borderRadius: 20, borderWidth: 1, borderColor: LINE, overflow: "hidden" } as const;

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View>
      <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.semi, fontSize: 11, letterSpacing: 0.66, marginBottom: 8 }}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Box({ children }: { children: ReactNode }) {
  return <View style={{ paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: "#060607", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}>{children}</View>;
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)", marginVertical: 10 }} />;
}

function Note({ children }: { children: ReactNode }) {
  return <Text style={{ color: DIM, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 17, marginTop: 8 }}>{children}</Text>;
}

/* Solid pills, no translucency: the colour when chosen, near-black with a hairline when not. */
function Pill({ on, fill, onPress, children }: { on: boolean; fill: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 13, borderRadius: 16, backgroundColor: on ? fill : pressed ? "#141418" : FIELD, borderWidth: 1, borderColor: on ? fill : "rgba(255,255,255,0.14)" })}
    >
      {children}
    </Pressable>
  );
}

/* The site's small switch, the knob gliding across. */
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: value ? 1 : 0, duration: 160, useNativeDriver: false }).start();
  }, [value, t]);
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28 }}>
      <Text style={{ color: TEXT, fontFamily: fonts.medium, fontSize: 14 }}>{label}</Text>
      <Animated.View style={{ width: 40, height: 22, borderRadius: 11, justifyContent: "center", borderWidth: 1, borderColor: t.interpolate({ inputRange: [0, 1], outputRange: ["rgba(255,255,255,0.12)", BLUE] }), backgroundColor: t.interpolate({ inputRange: [0, 1], outputRange: ["#141418", BLUE] }) }}>
        <Animated.View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff", transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [2, 20] }) }] }} />
      </Animated.View>
    </Pressable>
  );
}

function YellowButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({ height: 38, paddingHorizontal: 18, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#ffc22e" : colors.yellow, opacity: disabled ? 0.5 : 1 })}
    >
      <Text style={{ color: INK, fontFamily: fonts.bold, fontSize: 13.5 }}>{label}</Text>
    </Pressable>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel="Close" style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#141418" : FIELD, borderWidth: 1, borderColor: LINE })}>
      <Ionicons name="close" size={15} color={MUTED} />
    </Pressable>
  );
}
