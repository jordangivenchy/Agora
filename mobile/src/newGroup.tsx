/* Start a group chat: a name and at least one friend (people who follow
   each other, as for DMs). The site's NewGroupModal as a sheet. */
import { useEffect, useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { createGroup, displayName, fetchGroupCandidates, GROUP_NAME_MAX, type GroupMember } from "./messages";
import { Avatar } from "./avatar";
import { colors, fonts } from "./theme";

export function NewGroupSheet({ open, onClose, onCreated, initialMembers }: { open: boolean; onClose: () => void; onCreated: (chatId: string) => void; initialMembers?: string[] }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [friends, setFriends] = useState<GroupMember[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(""); setQ(""); setError(null); setBusy(false); setPicked(new Set(initialMembers ?? [])); setFriends(null);
    void fetchGroupCandidates(supabase).then(setFriends);
  }, [open, initialMembers]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (friends ?? []).filter((f) => !needle || f.username.toLowerCase().includes(needle) || (f.display_name ?? "").toLowerCase().includes(needle)), [friends, needle]);
  const canCreate = !busy && name.trim().length > 0 && picked.size > 0;
  const toggle = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    const r = await createGroup(supabase, name.trim(), [...picked]);
    setBusy(false);
    if (!r.id) { setError(r.error ?? "Couldn't create the group."); return; }
    onCreated(r.id);
  };
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: "#000", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, borderColor: "#2e2e38", paddingHorizontal: 20, paddingTop: 18, paddingBottom: insets.bottom + 12, maxHeight: Math.round(height * 0.86) }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 18 }}>New group</Text>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38" }}><Ionicons name="close" size={14} color="rgba(238,238,245,0.6)" /></Pressable>
          </View>
          <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.7, marginBottom: 8 }}>NAME</Text>
          <TextInput value={name} onChangeText={(t) => setName(t.slice(0, GROUP_NAME_MAX))} placeholder="What's the group called?" placeholderTextColor={colors.faint} autoFocus style={{ height: 38, borderRadius: 10, borderWidth: 1, borderColor: "#2e2e38", backgroundColor: "#0b0b0d", color: "#fff", fontFamily: fonts.body, fontSize: 13.5, paddingHorizontal: 12, marginBottom: 16 }} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.7 }}>FRIENDS</Text>
            <Text style={{ color: picked.size ? colors.yellow : "rgba(238,238,245,0.4)", fontFamily: fonts.semi, fontSize: 11.5 }}>{picked.size ? `${picked.size} picked` : "Pick at least one"}</Text>
          </View>
          {friends !== null && friends.length > 4 && (
            <TextInput value={q} onChangeText={setQ} placeholder="Search friends" placeholderTextColor={colors.faint} autoCapitalize="none" style={{ height: 34, borderRadius: 10, borderWidth: 1, borderColor: "#2e2e38", backgroundColor: "#0b0b0d", color: "#fff", fontFamily: fonts.body, fontSize: 13, paddingHorizontal: 12, marginBottom: 8 }} />
          )}
          <FlatList
            data={shown}
            keyExtractor={(f) => f.id}
            style={{ maxHeight: 300 }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={friends === null ? <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, fontSize: 12, paddingVertical: 8 }}>Finding friends…</Text> : friends.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 18, borderRadius: 12, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#1f1f26" }}>
                <Ionicons name="people-outline" size={18} color="rgba(238,238,245,0.4)" />
                <Text style={{ color: "rgba(238,238,245,0.6)", fontFamily: fonts.body, fontSize: 12.5, marginTop: 6 }}>No friends to add yet.</Text>
                <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, fontSize: 11.5, marginTop: 4, textAlign: "center", paddingHorizontal: 16 }}>Group chats are for people who follow each other. Follow someone back and they'll show up here.</Text>
              </View>
            ) : <Text style={{ color: "rgba(238,238,245,0.4)", fontFamily: fonts.body, fontSize: 12, paddingVertical: 8 }}>No matches.</Text>}
            renderItem={({ item: f }) => {
              const on = picked.has(f.id);
              return (
                <Pressable onPress={() => toggle(f.id)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 12, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: on ? "#7a5a10" : "#1f1f26", marginBottom: 6 }}>
                  <Avatar url={f.avatar_url} name={f.username} size={30} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 13 }}>{displayName(f)}</Text>
                    <Text style={{ color: "rgba(238,238,245,0.45)", fontFamily: fonts.body, fontSize: 11 }}>@{f.username}</Text>
                  </View>
                  <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: on ? colors.yellow : "#0b0b0d", borderWidth: 1, borderColor: on ? colors.yellow : "rgba(255,255,255,0.2)" }}>{on && <Ionicons name="checkmark" size={13} color={colors.ink} />}</View>
                </Pressable>
              );
            }}
          />
          {error && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 12, marginTop: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: "#1a0b0b", borderWidth: 1, borderColor: "#5a2a2a" }}>{error}</Text>}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Pressable onPress={onClose} style={{ height: 32, paddingHorizontal: 14, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38" }}><Text style={{ color: "#c9c9d2", fontFamily: fonts.bold, fontSize: 12.5 }}>Cancel</Text></Pressable>
            <Pressable onPress={() => void create()} disabled={!canCreate} style={{ height: 32, paddingHorizontal: 14, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.yellow, opacity: canCreate ? 1 : 0.45 }}><Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 12.5 }}>{busy ? "Creating…" : "Create group"}</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
