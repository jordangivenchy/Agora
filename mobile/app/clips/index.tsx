/* Clips: the most watched across the Agora, two across, and yours. */
import { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { fetchClips, fetchUserClips, type ClipTileData } from "../../src/clips";
import { ClipTile } from "../../src/clipTile";
import { LoadingLine } from "../../src/sky";
import { colors, fonts } from "../../src/theme";

export default function Clips() {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<"top" | "mine">("top");
  const [top, setTop] = useState<ClipTileData[] | null>(null);
  const [mine, setMine] = useState<ClipTileData[] | null>(null);
  useFocusEffect(useCallback(() => {
    void fetchClips(supabase, { limit: 40 }).then(setTop);
    if (uid) void fetchUserClips(supabase, uid).then(setMine);
  }, [uid]));
  const list = tab === "top" ? top : mine;
  const tile = (width - 16 * 2 - 12) / 2;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "Clips", headerBackTitle: "Back" }} />
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }}>
        {(["top", "mine"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: tab === t ? colors.yellow : colors.surface, borderWidth: 1, borderColor: tab === t ? colors.yellow : colors.hairline }}>
            <Text style={{ color: tab === t ? colors.ink : "#eeeef5", fontFamily: fonts.semi, fontSize: 12.5 }}>{t === "top" ? "Most watched" : "Yours"}</Text>
          </Pressable>
        ))}
      </View>
      {list === null ? <LoadingLine label="Loading clips" /> : (
        <FlatList
          data={list}
          numColumns={2}
          keyExtractor={(c) => c.id}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{ gap: 14, paddingBottom: 40 }}
          ListEmptyComponent={<Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 13, textAlign: "center", paddingVertical: 40, paddingHorizontal: 24 }}>{tab === "mine" ? (uid ? "No clips yet. Open a replay and press the scissors to make one." : "Sign in to see your clips.") : "No clips yet."}</Text>}
          renderItem={({ item }) => <ClipTile clip={item} width={tile} onPress={() => router.push({ pathname: "/clips/[id]", params: { id: item.id } })} />}
        />
      )}
    </View>
  );
}
