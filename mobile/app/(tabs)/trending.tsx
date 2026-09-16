/* Trending, as the site's page: the chips, "updated in real time", and
   the rooms as wide tiles — live first, then open, then replays. */
import { useCallback, useEffect, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Img } from "../../src/img";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/supabase";
import { TRENDING_CHIPS, agoDays, fetchTrendingRooms, fmtCount, roomDuration, type TrendingRoom } from "../../src/discover";
import { personName } from "../../src/home";
import { Avatar } from "../../src/avatar";
import { HomeHeader } from "../../src/header";
import { same, useFocusRefresh } from "../../src/refresh";
import { useCreate } from "../../src/create";
import { colors, fonts } from "../../src/theme";
import { Note } from "../../src/ui";

const GRADIENT_STANDINS = ["#0d1b4b", "#0a2e1a", "#1a0a00", "#0d0a2e", "#2d0a1a", "#001e2e"];
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default function Trending() {
  const [rooms, setRooms] = useState<TrendingRoom[] | null>(null);
  const [chip, setChip] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { openRoom } = useCreate();

  const load = useCallback(async () => {
    try {
      setRooms(same(await fetchTrendingRooms(supabase)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load trending.");
      setRooms((r) => r ?? []);
    }
  }, []);
  useFocusRefresh(load);
  useEffect(() => {
    const ch = supabase.channel("trending-rooms").on("postgres_changes", { event: "*", schema: "public", table: "debate_rooms" }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [load]);

  const shown = (rooms ?? []).filter((r) => !chip || r.topic_key === chip);
  const open = (r: TrendingRoom) => (r.status === "ended" ? router.push({ pathname: "/replay/[id]", params: { id: r.id } }) : router.push({ pathname: "/room/[id]", params: { id: r.id } }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HomeHeader />
      <FlatList
        data={shown}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.yellow} />}
        ListHeaderComponent={
          <View>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 24, lineHeight: 36, letterSpacing: -0.3, marginTop: 8 }}>Trending</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {TRENDING_CHIPS.map((c) => {
                const on = c.key === chip;
                return (
                  <Pressable key={c.label} onPress={() => setChip(c.key)} style={{ paddingHorizontal: 14, paddingVertical: 5, borderRadius: 8, backgroundColor: on ? colors.yellow : colors.surface, borderWidth: 1, borderColor: on ? colors.yellow : colors.hairline }}>
                    <Text style={{ color: on ? colors.ink : "#c0c0c8", fontFamily: on ? fonts.bold : fonts.body, fontSize: 12 }}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, marginTop: 8, marginBottom: 12 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#ef4444" }} />
              <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11 }}>updated in real time</Text>
            </View>
            {error && <Note tone="error">{error}</Note>}
          </View>
        }
        renderItem={({ item: r, index }) => {
          const host = one(r.host);
          const img = r.thumbnail_url || host?.avatar_url || null;
          const live = r.status === "live";
          const count = r.status === "ended" ? (r.replay_views ?? 0) : (r.viewer_count ?? 0);
          const dur = r.status === "ended" ? roomDuration(r.started_at, r.ended_at) : null;
          return (
            <Pressable onPress={() => open(r)} style={({ pressed }) => ({ marginBottom: 18, opacity: pressed ? 0.9 : 1 })}>
              <View style={{ aspectRatio: 16 / 9, borderRadius: 12, overflow: "hidden", backgroundColor: GRADIENT_STANDINS[index % GRADIENT_STANDINS.length], borderWidth: StyleSheet.hairlineWidth, borderColor: "#3a3a44" }}>
                {img && <Img uri={img} style={StyleSheet.absoluteFill} />}
                <View style={{ position: "absolute", top: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: live ? "#e24b4a" : r.status === "created" ? "#33291a" : colors.bg, borderWidth: r.status === "created" ? StyleSheet.hairlineWidth : 0, borderColor: colors.gold }}>
                  {live && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" }} />}
                  <Text style={{ color: live ? "#fcebeb" : r.status === "created" ? colors.gold : "#c0c0c8", fontFamily: fonts.medium, fontSize: 10 }}>{live ? "LIVE" : r.status === "created" ? "OPEN — JOIN" : "ENDED"}</Text>
                </View>
                <View style={{ position: "absolute", bottom: 8, right: 8, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.bg }}>
                  <Ionicons name="eye-outline" size={11} color="#e5e5ec" />
                  <Text style={{ color: "#e5e5ec", fontFamily: fonts.body, fontSize: 10 }}>{fmtCount(count)}{dur ? ` · ${dur}` : ""}</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                <Avatar url={host?.avatar_url} name={personName(host)} size={32} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13, lineHeight: 18 }}>{r.motion}</Text>
                  <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11, marginTop: 2 }}>{personName(host)} · {live ? "watching now" : agoDays(r.created_at)}</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          rooms === null ? (
            <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12, textAlign: "center", paddingVertical: 24 }}>Loading…</Text>
          ) : (
            <View style={{ padding: 16, alignItems: "center", borderRadius: 12, backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
              <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 14 }}>Nothing trending yet</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginTop: 6, marginBottom: 12 }}>Discussions appear here the moment they go live.</Text>
              <Pressable onPress={() => openRoom()} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: pressed ? "#ffc22e" : colors.yellow })}>
                <Ionicons name="sparkles-outline" size={12} color={colors.ink} />
                <Text style={{ color: colors.ink, fontFamily: fonts.semi, fontSize: 12 }}>Start the first one</Text>
              </Pressable>
            </View>
          )
        }
      />
    </View>
  );
}
