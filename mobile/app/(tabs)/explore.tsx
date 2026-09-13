/* Explore, as the site's page: the figures, the search, the category,
   status and language pills, and the discussions as square blocks. */
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/supabase";
import { fetchExploreRooms, fetchExploreStats, type ExploreRoom, type ExploreStats } from "../../src/discover";
import { RoomSquare } from "../../src/roomCard";
import { TOPICS, darkInkOn } from "../../src/topics";
import { HomeHeader } from "../../src/header";
import { colors, fonts } from "../../src/theme";
import { Note } from "../../src/ui";

type StatusKey = "all" | "live" | "created" | "scheduled";
const STATUS: { key: StatusKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "● Live" },
  { key: "created", label: "Queue" },
  { key: "scheduled", label: "Scheduled" },
];
const LANGS = ["Any", "EN", "ES", "FR", "ZH", "AR"];
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default function Explore() {
  const { width } = useWindowDimensions();
  const [rooms, setRooms] = useState<ExploreRoom[] | null>(null);
  const [stats, setStats] = useState<ExploreStats | null>(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState<StatusKey>("all");
  const [lang, setLang] = useState("Any");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rs, st] = await Promise.all([fetchExploreRooms(supabase), fetchExploreStats(supabase)]);
      setRooms(rs);
      setStats(st);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load discussions.");
      setRooms((r) => r ?? []);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const list = useMemo(() => {
    if (!rooms) return null;
    const q = query.trim().toLowerCase();
    return rooms.filter((r) => {
      if (cat !== "all" && r.topic_key !== cat) return false;
      if (status !== "all" && r.status !== status) return false;
      if (lang !== "Any" && (r.language || "EN").toUpperCase() !== lang) return false;
      if (q) {
        const host = one(r.host);
        const hay = `${r.motion ?? ""} ${TOPICS.find((t) => t.key === r.topic_key)?.label ?? ""} ${host?.username ?? ""} ${host?.display_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rooms, query, cat, status, lang]);

  const size = Math.floor((width - 32 - 12) / 2);
  const pill = (key: string, active: boolean, onPress: () => void, label: string, tint?: string, icon?: React.ReactNode, live?: boolean) => {
    const bg = active ? (live ? "#e05a5a" : tint ?? colors.blue) : colors.surface;
    const ink = active ? (tint && darkInkOn(tint) && !live ? colors.ink : "#fff") : "#c9c9d2";
    return (
      <Pressable key={key} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: bg, borderWidth: 1, borderColor: active ? bg : colors.hairline }}>
        {icon}
        <Text style={{ color: ink, fontFamily: active ? fonts.semi : fonts.medium, fontSize: 12 }}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HomeHeader />
      <FlatList
        data={list ?? []}
        keyExtractor={(r) => r.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16, marginBottom: 12 }}
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.yellow} />}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 16 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 24, lineHeight: 36, letterSpacing: -0.3, marginTop: 8 }}>Explore discussions</Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>Find a live room, join a queue, or sign up for one coming up</Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}>
              {[["Active rooms", stats?.activeRooms], ["Members", stats?.members], ["Watching now", stats?.watching]].map(([label, value], i) => (
                <View key={String(label)} style={{ flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6, justifyContent: i === 0 ? "flex-start" : i === 1 ? "center" : "flex-end" }}>
                  <Text style={{ color: colors.yellow, fontFamily: fonts.title, fontSize: 20, letterSpacing: -0.5 }}>{value ?? "—"}</Text>
                  <Text style={{ color: "rgba(255,255,255,0.45)", fontFamily: fonts.medium, fontSize: 10, letterSpacing: 0.7 }}>{String(label).toUpperCase()}</Text>
                </View>
              ))}
            </View>
            <View style={{ marginTop: 12, height: 40, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", paddingLeft: 12 }}>
              <Ionicons name="search-outline" size={15} color="rgba(255,255,255,0.3)" />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search topics, people, or keywords…" placeholderTextColor="rgba(255,255,255,0.25)" autoCorrect={false} style={{ flex: 1, height: 40, paddingHorizontal: 10, color: "rgba(255,255,255,0.85)", fontFamily: fonts.body, fontSize: 14 }} />
            </View>
            <Text style={label}>Category</Text>
            <View style={pills}>
              {pill("all", cat === "all", () => setCat("all"), "All")}
              {TOPICS.map((t) => pill(t.key, cat === t.key, () => setCat(t.key), t.label, t.color, <Ionicons name={t.icon} size={14} color={cat === t.key ? (darkInkOn(t.color) ? colors.ink : "#fff") : t.color} />))}
            </View>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginTop: 12 }} />
            <Text style={label}>Status</Text>
            <View style={pills}>{STATUS.map((s) => pill(s.key, status === s.key, () => setStatus(s.key), s.label, undefined, undefined, s.key === "live"))}</View>
            <Text style={label}>Language</Text>
            <View style={pills}>{LANGS.map((l) => pill(l, lang === l, () => setLang(l), l))}</View>
            {error && <Note tone="error">{error}</Note>}
            <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11.5, marginTop: 14, marginBottom: 10 }}>
              {list === null ? "Loading…" : `Showing ${list.length} discussion${list.length === 1 ? "" : "s"}`}
            </Text>
          </View>
        }
        renderItem={({ item }) => <RoomSquare room={item} size={size} onPress={() => router.push({ pathname: "/room/[id]", params: { id: item.id } })} />}
        ListEmptyComponent={list && list.length === 0 ? <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5, paddingHorizontal: 16 }}>No discussions match. Loosen a filter, or start one.</Text> : null}
      />
    </View>
  );
}

const label = { color: "rgba(255,255,255,0.3)", fontFamily: fonts.semi, fontSize: 10, letterSpacing: 0.9, marginTop: 12, marginBottom: 7 } as const;
const pills = { flexDirection: "row", flexWrap: "wrap", gap: 5 } as const;
