/* About this room (components/agora/RoomFrame.tsx): what the call is
   about, written by the host. Changes ride on the room row, so realtime
   brings them to everyone. */
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { RichText } from "./richText";
import { BODY_MIN, cleanTextError } from "./cleanText";
import { ABOUT_MAX, FRAME_MAX_LINES, frameLength, frameLines, setRoomFrame, type RoomDetail, type RoomFraming } from "./roomData";
import { isHostRole, seatName, type Seat, type StageRole } from "./stageModel";
import { colors, fonts } from "./theme";

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function RoomFrameSheet({ open, onClose, room, seats, myRole, onChange }: {
  open: boolean; onClose: () => void; room: RoomDetail; seats: Seat[]; myRole: StageRole; meId: string | null; onChange: (framing: RoomFraming) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const framing = room.framing ?? null;
  const canWrite = isHostRole(myRole);
  const [aboutDraft, setAboutDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) { setAboutDraft(null); setError(null); }
  }, [open]);

  const serverAbout = framing?.about ?? "";
  const about = aboutDraft ?? serverAbout;
  const aboutDirty = about.trim() !== serverAbout.trim();
  const aboutLen = frameLength(about);
  const aboutLinesN = frameLines(about);
  const aboutOver = aboutLen > ABOUT_MAX || aboutLinesN > FRAME_MAX_LINES;
  const writerSeat = framing?.about_by ? seats.find((s) => s.user_id === framing.about_by) : null;
  const writer = writerSeat ? seatName(writerSeat) : "the host";

  const saveAbout = async () => {
    if (aboutOver || busy) return;
    const issue = cleanTextError(about, BODY_MIN);
    if (issue) { setError(issue); return; }
    setBusy(true);
    setError(null);
    const r = await setRoomFrame(supabase, room.id, about.trim());
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    if (r.framing) onChange(r.framing);
    setAboutDraft(null);
  };

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
            {canWrite ? (
              <View>
                <TextInput
                  value={about}
                  onChangeText={setAboutDraft}
                  multiline
                  placeholder="What's this room about?"
                  placeholderTextColor={colors.faint}
                  style={{ minHeight: 88, maxHeight: 200, borderRadius: 10, borderWidth: 1, borderColor: aboutOver ? colors.red : "#2a2a33", backgroundColor: "#111114", color: colors.text, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, padding: 10, textAlignVertical: "top" }}
                />
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                  <Text style={{ color: aboutOver ? colors.red : colors.faint, fontFamily: fonts.body, fontSize: 11 }}>
                    {aboutLen}/{ABOUT_MAX} · {aboutLinesN}/{FRAME_MAX_LINES} lines{aboutLen > ABOUT_MAX ? " · too long" : aboutLinesN > FRAME_MAX_LINES ? " · too many lines" : framing?.about_at ? ` · updated ${timeAgo(framing.about_at)}` : ""}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={() => void saveAbout()} disabled={!aboutDirty || aboutOver || busy} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.yellow, opacity: !aboutDirty || aboutOver || busy ? 0.45 : 1 }}>
                    <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 12.5 }}>{busy ? "Saving…" : "Save"}</Text>
                  </Pressable>
                </View>
              </View>
            ) : serverAbout.trim() ? (
              <View>
                <RichText text={serverAbout} style={{ color: "#e6e6ee", fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20 }} />
                <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11, marginTop: 6 }}>Written by {writer}{framing?.about_at ? ` · ${timeAgo(framing.about_at)}` : ""}</Text>
              </View>
            ) : (
              <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5 }}>The host hasn&apos;t written anything yet.</Text>
            )}
            {error && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12, marginTop: 12 }}>{error}</Text>}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
