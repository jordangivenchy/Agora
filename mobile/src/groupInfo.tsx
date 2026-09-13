/* Group info (the site's GroupInfoModal): the name (the owner renames
   it), the members (the owner removes), friends to add, Leave. */
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { addGroupMembers, displayName, fetchGroupCandidates, groupErrorText, leaveGroup, removeGroupMember, renameGroup, GROUP_NAME_MAX, type GroupMember, type GroupMemberRow } from "./messages";
import { Avatar } from "./avatar";
import { colors, fonts } from "./theme";

export function GroupInfoSheet({ open, chatId, name, me, members, onClose, onRenamed, onMembersChanged, onLeft }: {
  open: boolean; chatId: string; name: string; me: string; members: GroupMemberRow[];
  onClose: () => void; onRenamed: (n: string) => void; onMembersChanged: () => void; onLeft: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [draft, setDraft] = useState(name);
  const [candidates, setCandidates] = useState<GroupMember[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = members.some((m) => m.id === me && m.is_owner);
  useEffect(() => {
    if (!open) return;
    setDraft(name);
    setError(null);
    setCandidates(null);
    void fetchGroupCandidates(supabase, chatId).then(setCandidates);
  }, [open, name, chatId]);

  const rename = async () => {
    const next = draft.trim();
    if (!next || next === name) return;
    setBusy("rename");
    const { error: err } = await renameGroup(supabase, chatId, next);
    setBusy(null);
    if (err) setError(groupErrorText(err.message)); else onRenamed(next);
  };
  const add = async (u: GroupMember) => {
    setBusy(u.id);
    const { error: err } = await addGroupMembers(supabase, chatId, [u.id]);
    setBusy(null);
    if (err) { setError(groupErrorText(err.message)); return; }
    setCandidates((c) => (c ?? []).filter((x) => x.id !== u.id));
    onMembersChanged();
  };
  const remove = (u: GroupMemberRow) => Alert.alert(`Remove ${displayName(u)}?`, "They can be added back later.", [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: () => void removeGroupMember(supabase, chatId, u.id).then(({ error: err }) => { if (err) setError(groupErrorText(err.message)); else onMembersChanged(); }) },
  ]);
  const leave = () => Alert.alert("Leave this group?", "You'll stop getting its messages. Someone can add you back.", [
    { text: "Cancel", style: "cancel" },
    { text: "Leave", style: "destructive", onPress: () => void leaveGroup(supabase, chatId).then(({ error: err }) => { if (err) setError(groupErrorText(err.message)); else onLeft(); }) },
  ]);
  const label = (t: string) => <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.7, marginBottom: 8, marginTop: 6 }}>{t.toUpperCase()}</Text>;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: "#000", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, borderColor: "#2e2e38", paddingHorizontal: 20, paddingTop: 18, paddingBottom: insets.bottom + 12, maxHeight: Math.round(height * 0.86) }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 18 }}>Group info</Text>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38" }}><Ionicons name="close" size={14} color="rgba(238,238,245,0.6)" /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {label("Name")}
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput value={draft} onChangeText={(t) => setDraft(t.slice(0, GROUP_NAME_MAX))} editable={isOwner} placeholderTextColor={colors.faint} style={{ flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: "#2e2e38", backgroundColor: "#0b0b0d", color: "#fff", fontFamily: fonts.body, fontSize: 13.5, paddingHorizontal: 12, opacity: isOwner ? 1 : 0.7 }} />
              {isOwner && <Pressable onPress={() => void rename()} disabled={busy === "rename" || !draft.trim() || draft.trim() === name} style={{ height: 32, paddingHorizontal: 14, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.yellow, opacity: !draft.trim() || draft.trim() === name ? 0.45 : 1 }}><Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 12.5 }}>Save</Text></Pressable>}
            </View>
            {!isOwner && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11.5, marginTop: 6 }}>Only the group's owner can rename it.</Text>}
            {label(`Members · ${members.length}`)}
            {members.map((m) => (
              <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 12, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#1f1f26", marginBottom: 6 }}>
                <Avatar url={m.avatar_url} name={m.username} size={30} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 13 }}>{displayName(m)}{m.id === me ? " (you)" : ""}</Text>
                  <Text style={{ color: "rgba(238,238,245,0.45)", fontFamily: fonts.body, fontSize: 11 }}>@{m.username}{m.is_owner ? " · owner" : ""}</Text>
                </View>
                {isOwner && m.id !== me && <Pressable onPress={() => remove(m)} hitSlop={8}><Text style={{ color: "#ff8a80", fontFamily: fonts.semi, fontSize: 12 }}>Remove</Text></Pressable>}
              </View>
            ))}
            {label("Add friends")}
            {candidates === null ? <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, fontSize: 12 }}>Finding friends…</Text> : candidates.length === 0 ? <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, fontSize: 12 }}>Every friend of yours is already here.</Text> : candidates.map((u) => (
              <View key={u.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 12, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#1f1f26", marginBottom: 6 }}>
                <Avatar url={u.avatar_url} name={u.username} size={30} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 13 }}>{displayName(u)}</Text>
                  <Text style={{ color: "rgba(238,238,245,0.45)", fontFamily: fonts.body, fontSize: 11 }}>@{u.username}</Text>
                </View>
                <Pressable onPress={() => void add(u)} disabled={busy === u.id} style={{ height: 30, paddingHorizontal: 12, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.yellow, opacity: busy === u.id ? 0.6 : 1 }}><Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 12 }}>{busy === u.id ? "Adding…" : "Add"}</Text></Pressable>
              </View>
            ))}
            {error && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 12, marginTop: 10 }}>{error}</Text>}
            <Pressable onPress={leave} style={{ marginTop: 16, height: 42, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: colors.red }}>
              <Text style={{ color: "#ff8a80", fontFamily: fonts.bold, fontSize: 13.5 }}>Leave group</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
