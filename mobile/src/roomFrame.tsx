/* About this room (components/agora/RoomFrame.tsx): the frame, what is
   being argued and on what terms, written by the host; and one line per
   person on the stage saying where they stand, written by each of them.
   Changes ride on the room row, so realtime brings them to everyone. */
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { Avatar } from "./avatar";
import { RichText } from "./richText";
import { BODY_MIN, cleanTextError } from "./cleanText";
import { ABOUT_MAX, FRAME_MAX_LINES, STANCE_MAX, clearRoomStance, frameLength, frameLines, setRoomFrame, setRoomStance, type RoomDetail, type RoomFraming } from "./roomData";
import { ROLE_LABEL, deriveStageRole, isHostRole, onStage, seatName, seatUser, type Seat, type StageRole } from "./stageModel";
import { colors, fonts } from "./theme";

interface FramePerson { id: string; username: string; name: string; avatarUrl: string | null; role: StageRole; stance: { text: string; at: string } | null }
const rank = (r: StageRole) => (r === "host" ? 0 : r === "cohost" ? 1 : 2);

export function framePeople(seats: Seat[], room: RoomDetail, me: { id: string; role: StageRole } | null): FramePerson[] {
  const stances = room.framing?.stances ?? {};
  const list: FramePerson[] = seats
    .map((s) => ({ s, role: deriveStageRole(s, room.host_id) }))
    .filter(({ role }) => onStage(role))
    .map(({ s, role }) => ({ id: s.user_id, username: seatUser(s)?.username ?? "", name: seatName(s), avatarUrl: seatUser(s)?.avatar_url ?? null, role, stance: stances[s.user_id] ?? null }));
  if (me && onStage(me.role) && !list.some((x) => x.id === me.id)) list.push({ id: me.id, username: "", name: "You", avatarUrl: null, role: me.role, stance: stances[me.id] ?? null });
  return list.sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name));
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function RoomFrameSheet({ open, onClose, room, seats, myRole, meId, onChange }: {
  open: boolean; onClose: () => void; room: RoomDetail; seats: Seat[]; myRole: StageRole; meId: string | null; onChange: (framing: RoomFraming) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const framing = room.framing ?? null;
  const canFrame = isHostRole(myRole);
  const canSpeak = !!meId && onStage(myRole);
  const me = useMemo(() => (meId ? { id: meId, role: myRole } : null), [meId, myRole]);
  const people = useMemo(() => framePeople(seats, room, me), [seats, room, me]);
  const [aboutDraft, setAboutDraft] = useState<string | null>(null);
  const [lineDraft, setLineDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<"about" | "line" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) { setAboutDraft(null); setLineDraft(null); setError(null); }
  }, [open]);

  const serverAbout = framing?.about ?? "";
  const about = aboutDraft ?? serverAbout;
  const aboutDirty = about.trim() !== serverAbout.trim();
  const aboutLen = frameLength(about);
  const aboutLinesN = frameLines(about);
  const aboutOver = aboutLen > ABOUT_MAX || aboutLinesN > FRAME_MAX_LINES;
  const myStance = meId ? (framing?.stances?.[meId]?.text ?? "") : "";
  const line = lineDraft ?? myStance;
  const setter = framing?.about_by ? people.find((p) => p.id === framing.about_by) : null;

  const apply = (r: { framing?: RoomFraming; error?: string }) => {
    if (r.error) { setError(r.error); return false; }
    if (r.framing) onChange(r.framing);
    return true;
  };
  const saveAbout = async () => {
    if (aboutOver || busy) return;
    const issue = cleanTextError(about, BODY_MIN);
    if (issue) { setError(issue); return; }
    setBusy("about");
    setError(null);
    if (apply(await setRoomFrame(supabase, room.id, about.trim()))) setAboutDraft(null);
    setBusy(null);
  };
  const saveLine = async () => {
    if (lineDraft === null || busy) return;
    if (lineDraft.trim() === myStance.trim()) { setLineDraft(null); return; }
    const issue = cleanTextError(lineDraft, BODY_MIN);
    if (issue) { setError(issue); return; }
    setBusy("line");
    setError(null);
    if (apply(await setRoomStance(supabase, room.id, lineDraft.trim()))) setLineDraft(null);
    setBusy(null);
  };
  const clearLine = async (userId: string) => {
    setBusy("clear");
    apply(await clearRoomStance(supabase, room.id, userId));
    setBusy(null);
  };

  const label = (t: string) => <Text style={{ color: "rgba(255,255,255,0.38)", fontFamily: fonts.semi, fontSize: 10, letterSpacing: 0.9, marginBottom: 8 }}>{t.toUpperCase()}</Text>;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1 }} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ maxHeight: Math.round(height * 0.8), backgroundColor: "#0b0b0d", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#26262e" }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
            <Ionicons name="information-circle-outline" size={16} color={colors.gold} />
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15, marginLeft: 6 }}>About this room</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close" style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }} keyboardShouldPersistTaps="handled">
            {label("The frame")}
            {canFrame ? (
              <View>
                <TextInput
                  value={about}
                  onChangeText={setAboutDraft}
                  multiline
                  placeholder="What are we arguing? Set the question, the terms, and what's out of bounds."
                  placeholderTextColor={colors.faint}
                  style={{ minHeight: 88, maxHeight: 200, borderRadius: 10, borderWidth: 1, borderColor: aboutOver ? colors.red : "#2a2a33", backgroundColor: "#111114", color: colors.text, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, padding: 10, textAlignVertical: "top" }}
                />
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                  <Text style={{ color: aboutOver ? colors.red : colors.faint, fontFamily: fonts.body, fontSize: 11 }}>
                    {aboutLen}/{ABOUT_MAX} · {aboutLinesN}/{FRAME_MAX_LINES} lines{aboutLen > ABOUT_MAX ? " · too long" : aboutLinesN > FRAME_MAX_LINES ? " · too many lines" : framing?.about_at ? ` · set ${timeAgo(framing.about_at)}` : ""}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={() => void saveAbout()} disabled={!aboutDirty || aboutOver || busy === "about"} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.yellow, opacity: !aboutDirty || aboutOver || busy === "about" ? 0.45 : 1 }}>
                    <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 12.5 }}>{busy === "about" ? "Saving…" : "Save"}</Text>
                  </Pressable>
                </View>
              </View>
            ) : serverAbout.trim() ? (
              <View>
                <RichText text={serverAbout} style={{ color: "#e6e6ee", fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20 }} />
                <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11, marginTop: 6 }}>Set by {setter?.name ?? "the host"}{framing?.about_at ? ` · ${timeAgo(framing.about_at)}` : ""}</Text>
              </View>
            ) : (
              <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5 }}>The host hasn't set the frame yet.</Text>
            )}

            <View style={{ height: 18 }} />
            {label("Where people stand")}
            {people.length === 0 ? (
              <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5 }}>Nobody is on the stage yet.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {people.map((p) => {
                  const mine = p.id === meId;
                  return (
                    <View key={p.id} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                      <Avatar url={p.avatarUrl} name={p.name} size={26} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 12.5 }}>
                          {p.name} <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 10.5 }}>{ROLE_LABEL[p.role]}</Text>
                        </Text>
                        {mine && canSpeak ? (
                          <TextInput
                            value={line}
                            onChangeText={(t) => setLineDraft(t.slice(0, STANCE_MAX))}
                            onBlur={() => void saveLine()}
                            onSubmitEditing={() => void saveLine()}
                            returnKeyType="done"
                            placeholder="Your position, in a line"
                            placeholderTextColor={colors.faint}
                            editable={busy !== "line"}
                            style={{ marginTop: 4, height: 34, borderRadius: 8, borderWidth: 1, borderColor: "#2a2a33", backgroundColor: "#111114", color: colors.text, fontFamily: fonts.body, fontSize: 12.5, paddingHorizontal: 10 }}
                          />
                        ) : (
                          <Text style={{ color: p.stance ? "#d6d6de" : colors.faint, fontFamily: fonts.body, fontSize: 12.5, marginTop: 2 }}>{p.stance?.text ?? "Hasn't said yet"}</Text>
                        )}
                      </View>
                      {p.stance && !mine && canFrame && (
                        <Pressable onPress={() => void clearLine(p.id)} disabled={busy === "clear"} hitSlop={8} accessibilityLabel={`Clear ${p.name}'s line`} style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="close" size={16} color={colors.muted} />
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
            {!canSpeak && !serverAbout.trim() && people.every((p) => !p.stance) && (
              <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12, marginTop: 10 }}>Once the host sets the frame and speakers take a side, it shows here.</Text>
            )}
            {error && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12, marginTop: 12 }}>{error}</Text>}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
