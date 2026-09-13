/* News, as the site's page: today's headlines from the same feed, the
   major stories as picture cards with the outlet link, Start a
   discussion and Queue a conversation, then the rest as rows. */
import { useCallback, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { fetchNews, type NewsStory } from "../../src/home";
import { newsTimeAgo, outletIcon } from "../../src/discover";
import { HomeHeader } from "../../src/header";
import { openUrl, openWeb } from "../../src/web";
import { colors, fonts } from "../../src/theme";
import { Note } from "../../src/ui";

const CARD = { backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12 } as const;
type Row = { kind: "major"; story: NewsStory } | { kind: "label"; text: string } | { kind: "more"; story: NewsStory };

export default function News() {
  const { session, pass } = useSession();
  const token = session?.access_token ?? null;
  const [stories, setStories] = useState<NewsStory[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  void supabase;

  const load = useCallback(async () => {
    try {
      setStories(await fetchNews({ token, pass }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the headlines.");
      setStories((s) => s ?? []);
    }
  }, [token, pass]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const majors = (stories ?? []).filter((s) => s.major);
  const rest = (stories ?? []).filter((s) => !s.major);
  const rows: Row[] = [
    ...(majors.length ? [{ kind: "label", text: "Major stories" } as Row, ...majors.map((story): Row => ({ kind: "major", story }))] : []),
    ...(rest.length ? [{ kind: "label", text: "More headlines" } as Row, ...rest.map((story): Row => ({ kind: "more", story }))] : []),
  ];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HomeHeader />
      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.kind === "label" ? `l${i}` : `${r.kind}:${r.story.id}`)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.yellow} />}
        ListHeaderComponent={
          <View style={{ marginTop: 8, marginBottom: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
              <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 24, lineHeight: 36, letterSpacing: -0.3 }}>News</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>{today}</Text>
            </View>
            <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>Today's headlines, turned into topics</Text>
            {error && <Note tone="error">{error}</Note>}
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === "label") return <Text style={{ color: "#9a9aa4", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1, marginBottom: 10, marginTop: 6 }}>{item.text.toUpperCase()}</Text>;
          const st = item.story;
          const src = st.sources[0];
          if (item.kind === "major") {
            return (
              <View style={[CARD, { overflow: "hidden", marginBottom: 16 }]}>
                <View style={{ aspectRatio: 16 / 9, backgroundColor: "#0d1b3e" }}>
                  {st.imageUrl && <Image source={{ uri: st.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
                </View>
                <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18, gap: 10 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17, lineHeight: 22 }}>{st.headline}</Text>
                  {!!st.summary && <Text numberOfLines={3} style={{ color: "#a9a9b4", fontFamily: fonts.body, fontSize: 13, lineHeight: 19.5 }}>{st.summary}</Text>}
                  <Outlets story={st} />
                  {st.url && <Btn kind="read" label={`Read at ${src?.name ?? "source"} ↗`} onPress={() => openUrl(st.url!)} />}
                  <Btn kind="discuss" label="Start a discussion" onPress={() => openWeb("/?create=1")} />
                  <Btn kind="queue" label="Queue a conversation" onPress={() => openWeb("/news")} />
                </View>
              </View>
            );
          }
          return (
            <View style={[CARD, { paddingHorizontal: 18, paddingVertical: 14, marginBottom: 10 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                {st.imageUrl ? (
                  <Image source={{ uri: st.imageUrl }} style={{ width: 76, height: 76, borderRadius: 10 }} resizeMode="cover" />
                ) : (
                  <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.blueText }} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 15, lineHeight: 20 }}>{st.headline}</Text>
                  <View style={{ marginTop: 3 }}><Outlets story={st} max={2} /></View>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                {st.url && <View style={{ flex: 1 }}><Btn kind="read" label={`Read at ${src?.name ?? "source"} ↗`} onPress={() => openUrl(st.url!)} /></View>}
                <View style={{ flex: 1 }}><Btn kind="discuss" label="Start a discussion" onPress={() => openWeb("/?create=1")} /></View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          stories === null ? (
            <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12 }}>Loading headlines…</Text>
          ) : (
            <View style={[CARD, { paddingHorizontal: 16, paddingVertical: 32, alignItems: "center" }]}>
              <Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 13 }}>No headlines right now</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11, marginTop: 4 }}>The news feed is off until a provider is configured.</Text>
            </View>
          )
        }
      />
    </View>
  );
}

function Outlets({ story, max = 3 }: { story: NewsStory; max?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      {story.sources.slice(0, max).map((s) => (
        <View key={s.name} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {!!s.domain && <Image source={{ uri: outletIcon(s.domain) }} style={{ width: 12, height: 12, borderRadius: 3, opacity: 0.85 }} />}
          <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 10.5 }}>{s.name}</Text>
        </View>
      ))}
      {story.sources.length > max && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 10.5 }}>+{story.sources.length - max}</Text>}
      {!!story.publishedAt && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 10.5 }}>· {newsTimeAgo(story.publishedAt)}</Text>}
    </View>
  );
}

/* Outline for the outbound link, solid blue to start, solid purple to queue. */
function Btn({ kind, label, onPress }: { kind: "read" | "discuss" | "queue"; label: string; onPress: () => void }) {
  const solid = kind === "discuss" ? "#2f7fe0" : kind === "queue" ? "#6d55c8" : null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ height: 36, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, backgroundColor: solid ?? "transparent", borderWidth: solid ? 0 : StyleSheet.hairlineWidth, borderColor: "#3f3f48", opacity: pressed ? 0.85 : 1 })}>
      <Text numberOfLines={1} style={{ color: solid ? "#fff" : "#e5e5ec", fontFamily: solid ? fonts.semi : fonts.medium, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}
