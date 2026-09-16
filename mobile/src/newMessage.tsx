/* Starting a conversation: the sheet behind the + on the inbox.

   The inbox only ever showed people you had already written to, so
   messaging someone new meant leaving it, finding them, and coming back
   through their profile. This is the way in: your friends, searchable,
   whether or not there's a thread with them yet — and a group, since
   that used to be the only thing the header offered.

   A direct message needs the two of you to follow each other (the
   database says so, not the app), so friends come first. Anyone else
   found by searching is shown honestly: you can open their profile and
   follow them, and message them once they follow back. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, FlatList, InteractionManager, Modal, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { displayName, fetchGroupCandidates, type GroupMember } from "./messages";
import { searchPeople, type Friend } from "./friends";
import { Avatar } from "./avatar";
import { colors, fonts } from "./theme";

type Row =
  | { kind: "friend"; person: GroupMember }
  | { kind: "other"; person: Friend };

export function NewMessageSheet({ open, onClose, meId, onPick, onNewGroup, onOpenProfile }: {
  open: boolean;
  onClose: () => void;
  /** Me, for the search that looks beyond my friends. */
  meId: string | null;
  /** Message this person: the inbox opens the thread. */
  onPick: (username: string) => void;
  /** The group sheet, which used to live in the header. */
  onNewGroup: () => void;
  /** Someone who isn't a friend yet: their profile, to follow them. */
  onOpenProfile: (username: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  /* It falls from under the top bar, where the + is: a panel that rose
     from the far edge of the screen had nothing to do with the button
     that opened it. */
  const drop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!open) { drop.setValue(0); return; }
    Animated.timing(drop, { toValue: 1, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open, drop]);
  /* One height, whatever the search turns up. Sizing to the rows meant
     the panel closed up on itself as you typed and the list got shorter
     — the row you were reaching for moved while you reached. */
  const panelH = Math.min(Math.round(height * 0.62), 520);
  const [q, setQ] = useState("");
  const [friends, setFriends] = useState<GroupMember[] | null>(null);
  const [others, setOthers] = useState<Friend[]>([]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setOthers([]);
    setFriends(null);
    /* After the sheet has finished sliding, not during it: the answer
       lands as a render, and a render in the middle of an animation is
       the stutter you see. */
    const task = InteractionManager.runAfterInteractions(() => {
      void fetchGroupCandidates(supabase).then(setFriends, () => setFriends([]));
    });
    return () => task.cancel();
  }, [open]);

  const needle = q.trim().toLowerCase();
  const mine = useMemo(
    () => (friends ?? []).filter((f) => !needle || f.username.toLowerCase().includes(needle) || (f.display_name ?? "").toLowerCase().includes(needle)),
    [friends, needle],
  );

  /* Past your own friends only once there's something to go on, and
     never anyone already listed above. */
  useEffect(() => {
    if (!open || !meId || needle.length < 2) { setOthers([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      void searchPeople(supabase, needle, meId).then(
        (found) => { if (alive) setOthers(found); },
        () => undefined,
      );
    }, 220);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, needle, meId]);

  const rows: Row[] = useMemo(() => {
    const known = new Set(mine.map((f) => f.id));
    return [
      ...mine.map((person) => ({ kind: "friend" as const, person })),
      ...others.filter((o) => !known.has(o.id)).map((person) => ({ kind: "other" as const, person })),
    ];
  }, [mine, others]);

  const person = (r: Row) => (
    <Pressable
      onPress={() => (r.kind === "friend" ? onPick(r.person.username) : onOpenProfile(r.person.username))}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 10, backgroundColor: pressed ? "#141418" : "transparent" })}
    >
      <Avatar url={r.person.avatar_url} name={r.person.username} size={38} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 14 }}>{displayName(r.person)}</Text>
        <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>
          @{r.person.username}{r.kind === "other" ? " · follow each other to message" : ""}
        </Text>
      </View>
      <Ionicons name={r.kind === "friend" ? "chatbubble-outline" : "person-add-outline"} size={16} color={colors.muted} />
    </Pressable>
  );

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)" }} accessibilityLabel="Close" />
      <Animated.View
        style={{
          position: "absolute", left: 10, right: 10, top: insets.top + 6, height: panelH,
          opacity: drop,
          transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-26, 0] }) }],
        }}
      >
        <View style={{ flex: 1, backgroundColor: "#000", borderRadius: 18, borderWidth: 1, borderColor: "#2e2e38", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 18 }}>New message</Text>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38" }}>
              <Ionicons name="close" size={14} color="rgba(238,238,245,0.6)" />
            </Pressable>
          </View>

          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search people"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            style={{ height: 38, borderRadius: 10, borderWidth: 1, borderColor: "#2e2e38", backgroundColor: "#0b0b0d", color: "#fff", fontFamily: fonts.body, fontSize: 13.5, paddingHorizontal: 12 }}
          />

          <Pressable
            onPress={onNewGroup}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 11, marginTop: 12, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 10, backgroundColor: pressed ? "#141418" : "transparent" })}
          >
            <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#15151b", borderWidth: 1, borderColor: "#2e2e38" }}>
              <Ionicons name="people-outline" size={17} color={colors.gold} />
            </View>
            <Text style={{ flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 14 }}>New group</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.muted} />
          </Pressable>

          <View style={{ height: 1, backgroundColor: "#16161c", marginVertical: 6 }} />

          {friends === null ? (
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 14 }}>Looking…</Text>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(r) => `${r.kind}-${r.person.id}`}
              keyboardShouldPersistTaps="handled"
              /* Fills what's left of the panel and scrolls inside it:
                 the panel's height never follows the list's. */
              style={{ flex: 1 }}
              renderItem={({ item }) => person(item)}
              ListEmptyComponent={
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, paddingVertical: 16 }}>
                  {needle
                    ? "Nobody by that name. You can message anyone who follows you back."
                    : "No friends yet — follow someone, and message them once they follow you back."}
                </Text>
              }
            />
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}
