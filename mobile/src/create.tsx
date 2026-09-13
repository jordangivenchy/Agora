/* The Create button, from anywhere: the menu (New room, New post), the
   New room sheet modeled on the site's Create a Discussion (the motion,
   the field, the language, private, when), and New post — pick a
   community, then the same composer the community page uses. Rooms are
   made through the site's create_room, one atomic call. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { ActionSheet } from "./actionSheet";
import { ComposerSheet } from "./composer";
import { createPost, fetchCommunities, type Community } from "./communities";
import { CommunityTile } from "./postCard";
import { TOPICS, darkInkOn } from "./topics";
import { colors, fonts } from "./theme";

export interface RoomPrefill { motion?: string; topic?: string }
interface CreateState {
  openMenu(): void;
  openRoom(prefill?: RoomPrefill): void;
  openPost(): void;
}
const Ctx = createContext<CreateState | null>(null);
export function useCreate(): CreateState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCreate outside CreateProvider");
  return v;
}

export function CreateProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [menu, setMenu] = useState(false);
  const [room, setRoom] = useState<{ open: boolean; prefill: RoomPrefill }>({ open: false, prefill: {} });
  const [picking, setPicking] = useState(false);
  const [postIn, setPostIn] = useState<Community | null>(null);

  const needSignIn = useCallback(() => { router.push("/sign-in"); }, []);
  const value = useMemo<CreateState>(() => ({
    openMenu: () => (uid ? setMenu(true) : needSignIn()),
    openRoom: (prefill = {}) => (uid ? setRoom({ open: true, prefill }) : needSignIn()),
    openPost: () => (uid ? setPicking(true) : needSignIn()),
  }), [uid, needSignIn]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ActionSheet
        open={menu}
        title="Create"
        onClose={() => setMenu(false)}
        actions={[
          { label: "New room", primary: true, onPress: () => { setMenu(false); setRoom({ open: true, prefill: {} }); } },
          { label: "New post", onPress: () => { setMenu(false); setPicking(true); } },
        ]}
      />
      <NewRoomSheet open={room.open} prefill={room.prefill} onClose={() => setRoom({ open: false, prefill: {} })} />
      <CommunityPicker open={picking} uid={uid} onClose={() => setPicking(false)} onPick={(c) => { setPicking(false); setPostIn(c); }} />
      <ComposerSheet
        open={!!postIn}
        kind="post"
        context={postIn ? `in ${postIn.name}` : null}
        onClose={() => setPostIn(null)}
        onSubmit={async ({ title, body }) => {
          if (!uid || !postIn) return "Sign in to post.";
          try {
            const id = await createPost(supabase, { communityId: postIn.id, authorId: uid, title, body: body || null });
            setPostIn(null);
            router.push({ pathname: "/posts/[id]", params: { id } });
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : "Couldn't post.";
          }
        }}
      />
    </Ctx.Provider>
  );
}

/* ── New post: where to ── */
function CommunityPicker({ open, uid, onClose, onPick }: { open: boolean; uid: string | null; onClose: () => void; onPick: (c: Community) => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [list, setList] = useState<Community[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setList(null);
    fetchCommunities(supabase, uid)
      .then((cs) => setList(cs.filter((c) => (c.kind === "profile" ? c.my_role === "owner" : !c.is_private || c.joined)).sort((a, b) => Number(b.joined) - Number(a.joined) || a.name.localeCompare(b.name))))
      .catch(() => setList([]));
  }, [open, uid]);
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} />
      <View style={{ backgroundColor: colors.surface2, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#23232b", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 + insets.bottom, maxHeight: Math.round(height * 0.7) }}>
        <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17 }}>New post</Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, marginTop: 2, marginBottom: 10 }}>Where does it go?</Text>
        <ScrollView>
          {list === null && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 13, paddingVertical: 12 }}>Loading…</Text>}
          {list?.length === 0 && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 13, paddingVertical: 12 }}>Join a community first.</Text>}
          {list?.map((c) => (
            <Pressable key={c.id} onPress={() => onPick(c)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 10, backgroundColor: pressed ? "#1f1f26" : "transparent" })}>
              <CommunityTile name={c.name} color={c.color} avatarUrl={c.avatar_url} size={30} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 14 }}>{c.kind === "profile" ? `u/${c.name.replace(/^@/, "")}` : c.name}</Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5 }}>{c.kind === "profile" ? "your page" : `${c.members} member${c.members === 1 ? "" : "s"}${c.joined ? " · joined" : ""}`}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.faint} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ── New room ── */
const LANGS = [
  { value: "en", label: "EN" }, { value: "es", label: "ES" }, { value: "fr", label: "FR" }, { value: "zh", label: "ZH" },
  { value: "ar", label: "AR" }, { value: "pt", label: "PT" }, { value: "de", label: "DE" }, { value: "hi", label: "HI" },
];
type When = "now" | "30m" | "1h" | "2h" | "tonight" | "tomorrow";
const WHENS: { key: When; label: string }[] = [
  { key: "now", label: "Now" }, { key: "30m", label: "In 30 min" }, { key: "1h", label: "In 1 hour" }, { key: "2h", label: "In 2 hours" },
  { key: "tonight", label: "Tonight at 8" }, { key: "tomorrow", label: "Tomorrow at 8" },
];
function whenIso(w: When): string | null {
  const now = new Date();
  if (w === "now") return null;
  if (w === "30m") return new Date(now.getTime() + 30 * 60000).toISOString();
  if (w === "1h") return new Date(now.getTime() + 60 * 60000).toISOString();
  if (w === "2h") return new Date(now.getTime() + 120 * 60000).toISOString();
  const d = new Date(now);
  d.setHours(20, 0, 0, 0);
  if (w === "tomorrow" || d.getTime() <= now.getTime() + 60000) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
const MOTION_MAX = 300;

function NewRoomSheet({ open, prefill, onClose }: { open: boolean; prefill: RoomPrefill; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [motion, setMotion] = useState("");
  const [topic, setTopic] = useState(TOPICS[0].key);
  const [language, setLanguage] = useState("en");
  const [isPrivate, setPrivate] = useState(false);
  const [listeners, setListeners] = useState(true);
  const [when, setWhen] = useState<When>("now");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string; roomId: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    setMotion(prefill.motion ?? "");
    setTopic(prefill.topic && TOPICS.some((t) => t.key === prefill.topic) ? prefill.topic : TOPICS[0].key);
    setLanguage("en"); setPrivate(false); setListeners(true); setWhen("now"); setBusy(false); setError(null); setInvite(null);
  }, [open, prefill]);

  const submit = async () => {
    const m = motion.trim();
    if (!m || busy) return;
    setBusy(true);
    setError(null);
    const scheduled = whenIso(when);
    const { data, error: err } = await supabase.rpc("create_room", {
      p_motion: m,
      p_topic_key: topic,
      p_language: language,
      p_stance: "PRO",
      p_is_private: isPrivate,
      p_allow_spectators: isPrivate ? listeners : true,
      p_pro_size: 10,
      p_con_size: 10,
      p_time_limit_seconds: null,
      p_scheduled_start: scheduled,
      p_community: null,
      p_access_mode: "code",
    });
    setBusy(false);
    if (err) {
      const msg = err.message || "";
      setError(msg.includes("max_scheduled_rooms") || msg.includes("schedule at most 3")
        ? "You can only have 3 scheduled discussions at once. End or cancel one first."
        : msg.includes("scheduled_start_too_soon") ? "Scheduled time must be at least 1 minute from now."
        : msg.replace(/^[a-z_]+:\s*/, "") || "Couldn't create the room.");
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { room_id?: string; invite_code?: string | null } | null;
    const roomId = row?.room_id;
    if (!roomId) { setError("Room creation failed — no room came back."); return; }
    if (isPrivate && row?.invite_code) { setInvite({ code: row.invite_code, roomId }); return; }
    onClose();
    if (!scheduled) router.push({ pathname: "/room/[id]", params: { id: roomId } });
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

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: colors.surface2, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#23232b", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 + insets.bottom, maxHeight: Math.round(height * 0.88) }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 }}>
            <Pressable onPress={onClose} hitSlop={8}><Text style={{ color: "#c3c3ce", fontFamily: fonts.body, fontSize: 15 }}>Cancel</Text></Pressable>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 16 }}>New room</Text>
            <View style={{ width: 48 }} />
          </View>
          {invite ? (
            <View style={{ paddingVertical: 16 }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13 }}>Your room is private. People get in with this code:</Text>
              <Text selectable style={{ color: colors.yellow, fontFamily: fonts.title, fontSize: 30, letterSpacing: 4, marginVertical: 14 }}>{invite.code}</Text>
              <Pressable onPress={() => { const id = invite.roomId; onClose(); router.push({ pathname: "/room/[id]", params: { id } }); }} style={{ height: 46, borderRadius: 23, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 14.5 }}>Continue to the room</Text>
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
              {label("Field")}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {TOPICS.map((t) => chip(topic === t.key, t.label, () => setTopic(t.key), t.color, <Ionicons name={t.icon} size={13} color={topic === t.key ? (darkInkOn(t.color) ? colors.ink : "#fff") : t.color} />))}
              </View>
              {label("Language")}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{LANGS.map((l) => chip(language === l.value, l.label, () => setLanguage(l.value)))}</View>
              {label("When")}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{WHENS.map((w) => chip(when === w.key, w.label, () => setWhen(w.key), colors.purple))}</View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18 }}>
                <View>
                  <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 14 }}>Private</Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5 }}>Only people with the invite code get in.</Text>
                </View>
                <Switch value={isPrivate} onValueChange={setPrivate} trackColor={{ true: colors.yellow, false: colors.border }} thumbColor="#fff" />
              </View>
              {isPrivate && (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 14 }}>Allow listeners</Text>
                  <Switch value={listeners} onValueChange={setListeners} trackColor={{ true: colors.yellow, false: colors.border }} thumbColor="#fff" />
                </View>
              )}
              {error && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 12.5, marginTop: 12 }}>{error}</Text>}
              <Pressable onPress={() => void submit()} disabled={!motion.trim() || busy} style={{ marginTop: 18, height: 46, borderRadius: 23, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", opacity: !motion.trim() || busy ? 0.45 : 1 }}>
                <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 14.5 }}>{busy ? "Creating…" : when === "now" ? "Start the room" : "Schedule the room"}</Text>
              </Pressable>
              <View style={{ height: 8 }} />
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

