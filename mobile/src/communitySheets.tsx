/* The community page's sheets, from the site's dialogs
   (components/CommunitiesPage.tsx): apply to join a private community,
   invite friends, and ban a member with a reason. */
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { InviteFriends } from "./inviteFriends";
import { cleanTextError, BODY_MIN } from "./cleanText";
import { colors, fonts } from "./theme";

type Target = { id: string; name: string; application_prompt: string | null; is_private: boolean };

function Sheet({ open, onClose, title, action, children }: { open: boolean; onClose: () => void; title: string; action?: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: colors.surface2, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#23232b", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 + insets.bottom, maxHeight: Math.round(height * 0.86) }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 }}>
            <Pressable onPress={onClose} hitSlop={8}><Text style={{ color: "#c3c3ce", fontFamily: fonts.body, fontSize: 15 }}>{action ? "Cancel" : "Close"}</Text></Pressable>
            <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.text, fontFamily: fonts.title, fontSize: 15, marginHorizontal: 8 }}>{title}</Text>
            {action ? (
              <Pressable onPress={action.onPress} disabled={action.disabled} style={{ height: 34, paddingHorizontal: 16, borderRadius: 999, backgroundColor: action.danger ? colors.red : colors.yellow, alignItems: "center", justifyContent: "center", opacity: action.disabled ? 0.45 : 1 }}>
                <Text style={{ color: action.danger ? "#fff" : colors.ink, fontFamily: fonts.bold, fontSize: 13 }}>{action.label}</Text>
              </Pressable>
            ) : <View style={{ width: 44 }} />}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false} style={{ marginTop: 8 }}>{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const field = { color: colors.text, fontFamily: fonts.body, fontSize: 15, lineHeight: 21, minHeight: 88, maxHeight: 180, padding: 12, borderRadius: 12, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38", textAlignVertical: "top" as const };

/* A private community is join-by-approval: the request carries a short
   pitch, required when the moderators ask a question (request_to_join). */
export function ApplySheet({ community, onClose, onApplied }: { community: Target | null; onClose: () => void; onApplied: () => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (community) { setMessage(""); setBusy(false); setError(null); } }, [community]);
  const prompt = community?.application_prompt?.trim() || null;
  const send = async () => {
    if (!community || busy) return;
    const text = message.trim();
    const issue = text ? cleanTextError(text, BODY_MIN) : null;
    if (issue) { setError(issue); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("request_to_join", { p_community: community.id, p_message: text || null });
    setBusy(false);
    if (err) { setError(err.message.replace(/^[a-z_]+:\s*/, "")); return; }
    onClose();
    onApplied();
  };
  return (
    <Sheet open={!!community} onClose={onClose} title="Apply to join" action={{ label: busy ? "Sending…" : "Send", onPress: () => void send(), disabled: busy || (!!prompt && !message.trim()) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name="lock-closed-outline" size={14} color={colors.text} />
        <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.text, fontFamily: fonts.title, fontSize: 16 }}>{community?.name}</Text>
      </View>
      <Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, marginTop: 4, marginBottom: 12 }}>
        {prompt ? "A moderator reviews every application — answer their questions below." : "A moderator reviews every application. A line about why you want in helps."}
      </Text>
      {prompt && (
        <View style={{ padding: 10, borderRadius: 10, backgroundColor: "#17150e", borderWidth: 1, borderColor: "#4a4127", marginBottom: 10 }}>
          <Text style={{ color: "#e2b96b", fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }}>{prompt}</Text>
        </View>
      )}
      <TextInput value={message} onChangeText={(t) => setMessage(t.slice(0, 500))} placeholder={prompt ? "Your answer…" : "Why do you want to join? (optional)"} placeholderTextColor={colors.faint} multiline maxLength={500} autoFocus style={field} />
      {error && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 12.5, marginTop: 8 }}>{error}</Text>}
    </Sheet>
  );
}

export function InviteSheet({ community, onClose }: { community: Target | null; onClose: () => void }) {
  return (
    <Sheet open={!!community} onClose={onClose} title="Invite friends">
      {community && <InviteFriends communityId={community.id} communityName={community.name} isPrivate={community.is_private} />}
    </Sheet>
  );
}

/* Ban a member: they leave, their request goes, and they can't come back
   until a moderator unbans them. The reason is optional and logged. */
export function BanSheet({ target, communityName, onClose, onBan }: { target: { userId: string; name: string } | null; communityName: string; onClose: () => void; onBan: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (target) { setReason(""); setBusy(false); setError(null); } }, [target]);
  const ban = async () => {
    if (!target || busy) return;
    setBusy(true);
    const err = await onBan(reason);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Sheet open={!!target} onClose={onClose} title="Ban member" action={{ label: busy ? "Banning…" : "Ban", onPress: () => void ban(), disabled: busy, danger: true }}>
      <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 14, lineHeight: 20, marginBottom: 4 }}>Ban {target?.name} from {communityName}?</Text>
      <Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, marginBottom: 12 }}>They leave the community and can't rejoin until a moderator unbans them.</Text>
      <TextInput value={reason} onChangeText={(t) => setReason(t.slice(0, 300))} placeholder="Reason (optional)" placeholderTextColor={colors.faint} multiline maxLength={300} style={[field, { minHeight: 64 }]} />
      {error && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 12.5, marginTop: 8 }}>{error}</Text>}
    </Sheet>
  );
}
