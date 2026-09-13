/* Messages: the inbox, the site's rail (components/messages/
   MessagesPage.tsx) — direct messages and groups in one list, newest
   activity first, unread counts, a search, New group. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { displayName, fetchGroups, fetchThreads, groupPreview, relTime, type GroupRow, type Thread } from "../../src/messages";
import { Avatar } from "../../src/avatar";
import { GroupTile } from "../../src/groupTile";
import { NewGroupSheet } from "../../src/newGroup";
import { LoadingLine } from "../../src/sky";
import { colors, fonts } from "../../src/theme";
import { Button, Screen, Sub, Title } from "../../src/ui";

type RailItem = { kind: "dm"; at: string; t: Thread } | { kind: "group"; at: string; g: GroupRow };

export default function Messages() {
  const { session } = useSession();
  const me = session?.user.id ?? null;
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [newGroup, setNewGroup] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    const [t, g] = await Promise.all([fetchThreads(supabase), fetchGroups(supabase)]);
    setThreads(t);
    setGroups(g);
  }, [me]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (!me) return;
    const ch = supabase
      .channel("dm-inbox-app")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${me}` }, () => void fetchThreads(supabase).then(setThreads))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "direct_messages" }, () => void fetchThreads(supabase).then(setThreads))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages" }, () => void fetchGroups(supabase).then(setGroups))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "group_messages" }, () => void fetchGroups(supabase).then(setGroups))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_chat_members", filter: `user_id=eq.${me}` }, () => void fetchGroups(supabase).then(setGroups))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "group_chat_members" }, () => void fetchGroups(supabase).then(setGroups))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [me]);

  const q = search.trim().toLowerCase();
  const items = useMemo<RailItem[]>(() => {
    const dms: RailItem[] = (threads ?? []).filter((t) => !q || t.peer_username.toLowerCase().includes(q) || (t.peer_display_name ?? "").toLowerCase().includes(q)).map((t) => ({ kind: "dm", at: t.last_at, t }));
    const gs: RailItem[] = (groups ?? []).filter((g) => !q || g.name.toLowerCase().includes(q) || g.members.some((m) => m.username.toLowerCase().includes(q) || (m.display_name ?? "").toLowerCase().includes(q))).map((g) => ({ kind: "group", at: g.last_at, g }));
    return [...dms, ...gs].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [threads, groups, q]);
  const loaded = threads !== null && groups !== null;
  const total = (threads?.length ?? 0) + (groups?.length ?? 0);

  if (!me) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Messages" }} />
        <View style={{ paddingTop: 24 }}>
          <Title>Messages are for members</Title>
          <Sub>Sign in to talk with your friends.</Sub>
          <Button onPress={() => router.replace("/sign-in")}>Sign in</Button>
        </View>
      </Screen>
    );
  }

  const badge = (n: number) => n > 0 && (
    <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 999, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 10.5 }}>{n}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "Messages", headerBackTitle: "Back", headerRight: () => (
        <Pressable onPress={() => setNewGroup(true)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 11, borderRadius: 999, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38" }}>
          <Ionicons name="people-outline" size={13} color="#c9c9d2" />
          <Text style={{ color: "#c9c9d2", fontFamily: fonts.bold, fontSize: 12 }}>New group</Text>
        </Pressable>
      ) }} />
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 36, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, gap: 8 }}>
          <Ionicons name="search-outline" size={14} color={colors.faint} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search conversations" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 13 }} />
        </View>
      </View>
      {!loaded ? <LoadingLine label="Loading conversations" /> : (
        <FlatList
          data={items}
          keyExtractor={(it) => (it.kind === "dm" ? `d-${it.t.peer_id}` : `g-${it.g.chat_id}`)}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={<Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, textAlign: "center", paddingVertical: 32, paddingHorizontal: 24 }}>{total === 0 ? "No conversations yet. Open a friend's profile and hit Message, or start a group with New group." : "No matches."}</Text>}
          renderItem={({ item: it }) => {
            const unread = it.kind === "dm" ? it.t.unread : it.g.unread;
            const title = it.kind === "dm" ? displayName({ display_name: it.t.peer_display_name, username: it.t.peer_username }) : it.g.name;
            const preview = it.kind === "dm" ? `${it.t.last_from_me ? "You: " : ""}${it.t.last_content}` : groupPreview(it.g);
            return (
              <Pressable
                onPress={() => (it.kind === "dm" ? router.push({ pathname: "/messages/[username]", params: { username: it.t.peer_username } }) : router.push({ pathname: "/messages/g/[id]", params: { id: it.g.chat_id } }))}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: pressed ? "#141418" : "transparent", borderBottomWidth: 1, borderColor: "#121216" })}
              >
                {it.kind === "dm" ? <Avatar url={it.t.peer_avatar_url} name={it.t.peer_username} size={44} /> : <GroupTile members={it.g.members} size={44} />}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                    <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontFamily: unread > 0 ? fonts.bold : fonts.medium, fontSize: 14.5 }}>{title}</Text>
                    <Text style={{ color: "#6f6f7a", fontFamily: fonts.body, fontSize: 11 }}>{relTime(it.at)}</Text>
                  </View>
                  <Text numberOfLines={1} style={{ color: unread > 0 ? "#c9c9d4" : colors.muted, fontFamily: fonts.body, fontSize: 13 }}>{preview}</Text>
                </View>
                {badge(unread)}
              </Pressable>
            );
          }}
        />
      )}
      <NewGroupSheet open={newGroup} onClose={() => setNewGroup(false)} onCreated={(chatId) => { setNewGroup(false); void load(); router.push({ pathname: "/messages/g/[id]", params: { id: chatId } }); }} />
    </View>
  );
}
