/* Followers or following, the site's list behind the profile counts
   (components/FollowListModal.tsx): get_followers / get_following, a
   filter, each row to the person's page. */
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { supabase } from "../src/supabase";
import { Avatar } from "../src/avatar";
import { LoadingLine } from "../src/sky";
import { colors, fonts } from "../src/theme";
import { Screen } from "../src/ui";

interface Row { id: string; username: string; display_name: string | null; avatar_url: string | null; bio: string | null }

export default function People() {
  const params = useLocalSearchParams<{ user: string; mode: string }>();
  const userId = typeof params.user === "string" ? params.user : "";
  const mode = params.mode === "following" ? "following" : "followers";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!userId) return;
    let on = true;
    void supabase.rpc(mode === "followers" ? "get_followers" : "get_following", { p_user: userId }).then(({ data, error: e }) => {
      if (!on) return;
      if (e) { setError(e.message || "Could not load list"); setRows([]); }
      else setRows((data as Row[]) || []);
    });
    return () => { on = false; };
  }, [userId, mode]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (rows ?? []).filter((r) => !q || r.username.toLowerCase().includes(q) || (r.display_name ?? "").toLowerCase().includes(q)), [rows, q]);
  const title = mode === "followers" ? "Followers" : "Following";

  return (
    <Screen style={{ paddingHorizontal: 16 }}>
      <Stack.Screen options={{ title: rows ? `${title} (${rows.length})` : title, headerBackTitle: "Back" }} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search…"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ marginTop: 10, marginBottom: 8, height: 38, borderRadius: 10, paddingHorizontal: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.text, fontFamily: fonts.body, fontSize: 13.5 }}
      />
      {error && <Text style={{ color: "#ff6b6b", fontFamily: fonts.body, fontSize: 12, marginBottom: 8 }}>{error}</Text>}
      {rows === null ? <LoadingLine /> : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingBottom: 40, gap: 4 }}
          ListEmptyComponent={<Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 13, textAlign: "center", paddingVertical: 32 }}>{rows.length === 0 ? (mode === "followers" ? "No followers yet." : "Not following anyone yet.") : "No matches."}</Text>}
          renderItem={({ item: r }) => (
            <Pressable onPress={() => router.push({ pathname: "/u/[username]", params: { username: r.username } })} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 12, backgroundColor: pressed ? colors.surface2 : colors.surface, borderWidth: 1, borderColor: colors.hairline })}>
              <Avatar url={r.avatar_url} name={r.display_name || r.username} size={36} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13.5 }}>{r.display_name?.trim() || r.username}</Text>
                <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, marginTop: 2 }}>@{r.username}{r.bio ? ` — ${r.bio}` : ""}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
