/* News, as the site's page: today's headlines from the same feed, the
   major stories as picture cards with the outlet link, Start a
   discussion and Queue a conversation, then the rest as rows. A tap on
   a story in the home hero arrives with ?story=<id>: that card scrolls
   into view and wears a yellow ring for a moment (NewsPage.tsx). */
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { fetchNews, type NewsStory } from "../../src/home";
import { newsTimeAgo, outletIcon, topicFor } from "../../src/discover";
import { useCreate } from "../../src/create";
import { HomeHeader } from "../../src/header";
import { withProgress } from "../../src/progress";
import { openUrl } from "../../src/web";
import { isQueuedFor, openQueue } from "../../src/queue";
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
  const { openRoom } = useCreate();
  void supabase;
  const { story: wanted } = useLocalSearchParams<{ story?: string }>();
  const listRef = useRef<FlatList<Row>>(null);
  const [hit, setHit] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStories(await fetchNews({ token, pass }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the headlines.");
      setStories((s) => s ?? []);
    }
  }, [token, pass]);
  useFocusEffect(useCallback(() => { void withProgress(load()); }, [load]));

  const majors = (stories ?? []).filter((s) => s.major);
  const rest = (stories ?? []).filter((s) => !s.major);
  const rows: Row[] = [
    ...(majors.length ? [{ kind: "label", text: "Major stories" } as Row, ...majors.map((story): Row => ({ kind: "major", story }))] : []),
    ...(rest.length ? [{ kind: "label", text: "More headlines" } as Row, ...rest.map((story): Row => ({ kind: "more", story }))] : []),
  ];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  /* The story the hero sent: scroll to it, ring it, then drop the param
     so coming back to the tab doesn't do it again. */
  const hitIndex = wanted ? rows.findIndex((r) => r.kind !== "label" && r.story.id === wanted) : -1;
  const [pending, setPending] = useState<{ id: string; index: number } | null>(null);
  useEffect(() => {
    if (!wanted || hitIndex < 0) return;
    setPending({ id: wanted, index: hitIndex });
    router.setParams({ story: "" });
  }, [wanted, hitIndex]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: pending.index, viewPosition: 0.35, animated: true });
      setHit(pending.id);
      setPending(null);
    }, 120);
    return () => clearTimeout(t);
  }, [pending]);
  useEffect(() => {
    if (!hit) return;
    const t = setTimeout(() => setHit(null), 3600);
    return () => clearTimeout(t);
  }, [hit]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HomeHeader />
      <FlatList
        ref={listRef}
        data={rows}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.35, animated: true }), 80);
        }}
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
                {hit === st.id && <Ring />}
                <View style={{ aspectRatio: 16 / 9, backgroundColor: "#0d1b3e" }}>
                  {st.imageUrl && <Image source={{ uri: st.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
                </View>
                <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18, gap: 10 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17, lineHeight: 22 }}>{st.headline}</Text>
                  {!!st.summary && <Text numberOfLines={3} style={{ color: "#a9a9b4", fontFamily: fonts.body, fontSize: 13, lineHeight: 19.5 }}>{st.summary}</Text>}
                  <Outlets story={st} />
                  {st.url && <Btn kind="read" label={`Read at ${src?.name ?? "source"} ↗`} onPress={() => openUrl(st.url!)} />}
                  <Btn kind="discuss" label="Start a discussion" onPress={() => openRoom({ motion: st.headline, topic: topicFor(st.category) })} />
                  <Btn kind="queue" label={isQueuedFor(st.headline) ? "In line" : "Queue a conversation"} onPress={() => openQueue({ id: null, question: st.headline, topicKey: topicFor(st.category), queueCount: 0, sourceUrl: st.url ?? null })} />
                </View>
              </View>
            );
          }
          return (
            <View style={[CARD, { paddingHorizontal: 18, paddingVertical: 14, marginBottom: 10 }]}>
              {hit === st.id && <Ring />}
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
                <View style={{ flex: 1 }}><Btn kind="discuss" label="Start a discussion" onPress={() => openRoom({ motion: st.headline, topic: topicFor(st.category) })} /></View>
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

/* The yellow ring on the story the hero sent: in quickly, out slowly.
   On the JS driver: a native-driven fade on a view mounted in the same
   moment never drew on iOS (toast.tsx). */
function Ring() {
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.sequence([
      Animated.timing(o, { toValue: 1, duration: 250, useNativeDriver: false }),
      Animated.delay(2400),
      Animated.timing(o, { toValue: 0, duration: 900, useNativeDriver: false }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [o]);
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 2, borderRadius: 12, borderWidth: 2, borderColor: colors.yellow, opacity: o }]} />;
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
