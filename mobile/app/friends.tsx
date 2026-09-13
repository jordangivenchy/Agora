/* Friends, as the site's panel: the people you follow who follow you
   back, favourites pinned first; who follows you and awaits an add
   back; and a search to add more. A friend opens their page, or a
   message on the web. */
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/supabase";
import { useSession } from "../src/session";
import { fetchFriends, searchPeople, setFavoriteFriend, type Friend } from "../src/friends";
import { setFollowing } from "../src/profile";
import { Avatar } from "../src/avatar";
import { openWeb } from "../src/web";
import { colors, fonts } from "../src/theme";
import { Note, Screen, Sub, Title, Button } from "../src/ui";

type Row = { kind: "label"; text: string } | { kind: "friend"; user: Friend; favorite: boolean } | { kind: "back"; user: Friend } | { kind: "found"; user: Friend };
const name = (u: Friend) => u.display_name?.trim() || `@${u.username}`;

export default function Friends() {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [friends, setFriends] = useState<Friend[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [followsMe, setFollowsMe] = useState<Friend[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Friend[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    try {
      const r = await fetchFriends(supabase, uid);
      setFriends(r.friends);
      setFavorites(r.favorites);
      setFollowsMe(r.followsMe);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your friends.");
    } finally {
      setLoading(false);
    }
  }, [uid]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !uid) { setFound([]); return; }
    const t = setTimeout(() => {
      const ids = new Set(friends.map((f) => f.id));
      void searchPeople(supabase, q, uid).then((rows) => setFound(rows.filter((u) => !ids.has(u.id))));
    }, 250);
    return () => clearTimeout(t);
  }, [query, uid, friends]);

  if (!uid) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Friends" }} />
        <View style={{ paddingTop: 24 }}>
          <Title>Friends are for members</Title>
          <Sub>Sign in to see who follows you back, and to add people.</Sub>
          <Button onPress={() => router.replace("/sign-in")}>Sign in</Button>
        </View>
      </Screen>
    );
  }

  const follow = async (u: Friend) => {
    setAdded((a) => new Set(a).add(u.id));
    try { await setFollowing(supabase, u.id, true); await load(); } catch { setAdded((a) => { const n = new Set(a); n.delete(u.id); return n; }); }
  };
  const star = (u: Friend) => {
    const on = !favorites.has(u.id);
    setFavorites((f) => { const n = new Set(f); if (on) n.add(u.id); else n.delete(u.id); return n; });
    setFavoriteFriend(supabase, uid, u.id, on).catch(() => setFavorites((f) => { const n = new Set(f); if (on) n.delete(u.id); else n.add(u.id); return n; }));
  };

  const sorted = [...friends].sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)) || name(a).localeCompare(name(b)));
  const rows: Row[] = [
    ...(found.length ? [{ kind: "label", text: "People" } as Row, ...found.map((user): Row => ({ kind: "found", user }))] : []),
    { kind: "label", text: `Friends · ${friends.length}` },
    ...sorted.map((user): Row => ({ kind: "friend", user, favorite: favorites.has(user.id) })),
    ...(followsMe.length ? [{ kind: "label", text: "Follows you" } as Row, ...followsMe.map((user): Row => ({ kind: "back", user }))] : []),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "Friends" }} />
      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.kind === "label" ? `l${i}` : `${r.kind}:${r.user.id}`)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.yellow} />}
        ListHeaderComponent={
          <View style={{ paddingTop: 12 }}>
            <View style={{ height: 40, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", paddingLeft: 12 }}>
              <Ionicons name="person-add-outline" size={15} color="rgba(255,255,255,0.3)" />
              <TextInput value={query} onChangeText={setQuery} placeholder="Add a friend by username" placeholderTextColor="rgba(255,255,255,0.25)" autoCapitalize="none" autoCorrect={false} style={{ flex: 1, height: 40, paddingHorizontal: 10, color: colors.text, fontFamily: fonts.body, fontSize: 14 }} />
            </View>
            {error && <Note tone="error">{error}</Note>}
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === "label") return <Text style={{ color: "rgba(238,238,245,0.38)", fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1, marginTop: 18, marginBottom: 6 }}>{item.text.toUpperCase()}</Text>;
          const u = item.user;
          return (
            <Pressable onPress={() => router.push({ pathname: "/u/[username]", params: { username: u.username } })} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 12, backgroundColor: pressed ? colors.surface2 : "transparent" })}>
              <Avatar url={u.avatar_url} name={name(u)} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 14.5 }}>{name(u)}</Text>
                <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>@{u.username}{item.kind === "friend" && u.since ? ` · friends since ${new Date(u.since).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : ""}</Text>
              </View>
              {item.kind === "friend" ? (
                <>
                  <Pressable onPress={() => star(u)} hitSlop={8} accessibilityLabel={item.favorite ? "Unpin" : "Pin"}>
                    <Ionicons name={item.favorite ? "star" : "star-outline"} size={18} color={item.favorite ? colors.gold : "rgba(238,238,245,0.3)"} />
                  </Pressable>
                  <Pressable onPress={() => openWeb(`/messages/${encodeURIComponent(u.username)}`)} hitSlop={8} accessibilityLabel="Message" style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="chatbubble-outline" size={16} color={colors.text} />
                  </Pressable>
                </>
              ) : (
                <Pressable onPress={() => void follow(u)} disabled={added.has(u.id)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: added.has(u.id) ? colors.surface2 : colors.blue }}>
                  <Text style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 12 }}>{added.has(u.id) ? "Added" : item.kind === "back" ? "Add back" : "Add"}</Text>
                </Pressable>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={loading ? <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 13, paddingVertical: 24, textAlign: "center" }}>Loading…</Text> : null}
        ListFooterComponent={!loading && friends.length === 0 ? <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 13, paddingVertical: 12 }}>No friends yet. Follow someone who follows you back, or add them above.</Text> : null}
      />
    </View>
  );
}
