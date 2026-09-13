/* Report a person, the site's modal (components/ReportModal.tsx): a
   reason, a note, submit_report. Confidential. */
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { colors, fonts } from "./theme";

export interface ReportTarget {
  userId: string;
  username: string;
  context: "room" | "profile" | "chat" | "history";
  roomId?: string | null;
  messageId?: string | null;
  /** Shown to the reporter as a quote so they can confirm what they're reporting. */
  messagePreview?: string | null;
}

const REASONS: { value: string; label: string }[] = [
  { value: "harassment", label: "Harassment" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "threats_violence", label: "Threats / violence" },
  { value: "spam", label: "Spam" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "misinformation", label: "Misinformation" },
  { value: "impersonation", label: "Impersonation" },
  { value: "inappropriate_username", label: "Inappropriate username" },
  { value: "other", label: "Other" },
];

export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (target) { setReason(null); setDescription(""); setError(null); setDone(false); }
  }, [target]);

  async function submit() {
    if (!target) return;
    setError(null);
    if (!reason) { setError("Pick a reason first."); return; }
    if (reason === "other" && !description.trim()) { setError("Please describe the problem when choosing Other."); return; }
    setBusy(true);
    const { error: e } = await supabase.rpc("submit_report", {
      p_reported: target.userId,
      p_reason: reason,
      p_description: description.trim() || null,
      p_context: target.context,
      p_room: target.roomId ?? null,
      p_message: target.messageId ?? null,
    });
    setBusy(false);
    if (e) {
      const m = e.message || "";
      if (m.includes("not_authenticated")) setError("Sign in to report users.");
      else if (m.includes("cannot_report_self")) setError("You can't report yourself.");
      else if (m.includes("description_required")) setError("Please describe the problem when choosing Other.");
      else setError("Could not submit report — " + m);
      return;
    }
    setDone(true);
  }

  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: "#121215", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16 + insets.bottom }}>
          {done ? (
            <View style={{ alignItems: "center" }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: "#0f2a1a", borderWidth: 1, borderColor: "#1f5a35", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <Ionicons name="checkmark" size={24} color="#22c55e" />
              </View>
              <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 17, marginBottom: 6 }}>Report submitted</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, lineHeight: 20, textAlign: "center", marginBottom: 18 }}>Thanks for helping keep AgoraSphere safe. Our team will review this report.</Text>
              <Pressable onPress={onClose} style={{ alignSelf: "stretch", height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13.5 }}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 17 }}>Report @{target?.username}</Text>
                <Pressable onPress={onClose} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border }}>
                  <Ionicons name="close" size={14} color={colors.muted} />
                </Pressable>
              </View>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, marginTop: 4, marginBottom: 16 }}>Your report is confidential — @{target?.username} won't know who reported them.</Text>
              {!!target?.messagePreview && (
                <View style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.surface, borderLeftWidth: 2, borderLeftColor: "#7a3535", marginBottom: 14 }}>
                  <Text numberOfLines={3} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 }}>“{target.messagePreview}”</Text>
                </View>
              )}
              {error && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, marginBottom: 14, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: "#5a2a2a", backgroundColor: "#1c1010" }}>{error}</Text>}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                {REASONS.map((r) => {
                  const active = reason === r.value;
                  return (
                    <Pressable key={r.value} onPress={() => setReason(r.value)} style={{ width: "48.5%", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: active ? "#2a1414" : colors.surface, borderWidth: 1, borderColor: active ? "#7a3535" : colors.border }}>
                      <Text style={{ color: active ? "#fca5a5" : colors.muted, fontFamily: active ? fonts.semi : fonts.medium, fontSize: 12.5 }}>{r.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={description}
                onChangeText={(t) => setDescription(t.slice(0, 1000))}
                placeholder={reason === "other" ? "Describe the problem (required)…" : "Add details (optional)…"}
                placeholderTextColor={colors.faint}
                multiline
                style={{ minHeight: 76, textAlignVertical: "top", paddingHorizontal: 13, paddingVertical: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.text, fontFamily: fonts.body, fontSize: 13, marginBottom: 16 }}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={onClose} disabled={busy} style={{ flex: 1, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontFamily: fonts.semi, fontSize: 13.5 }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={() => void submit()} disabled={busy || !reason} style={{ flex: 1, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "#ef4444", opacity: busy || !reason ? 0.5 : 1 }}>
                  <Text style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 13.5 }}>{busy ? "Submitting…" : "Submit report"}</Text>
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
