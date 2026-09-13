/* Home: the website's phone home — the hero, the news strip and the
   board of fields — under the site's header, above its tab bar. */
import { useCallback, useEffect, useState } from "react";
import { AppState, RefreshControl, ScrollView, View, useWindowDimensions } from "react-native";
import { useFocusEffect } from "expo-router";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { fetchBoard, fetchFeatured, fetchHeroRooms, fetchNews, type BoardRoom, type FeaturedPost, type HeroRoom, type NewsStory, type TopicRow } from "../../src/home";
import { HomeHeader } from "../../src/header";
import { HeroCarousel } from "../../src/hero";
import { NewsTicker } from "../../src/ticker";
import { TopicBoard } from "../../src/board";
import { Starfield } from "../../src/starfield";
import { isQueued, leaveQueue, onQueueChanged, openQueue } from "../../src/queue";
import { colors } from "../../src/theme";

/* The hero takes the first stories; the strip gets the rest. */
const HERO_NEWS = 3;

export default function Home() {
  const { session, pass } = useSession();
  const { width } = useWindowDimensions();
  const [news, setNews] = useState<NewsStory[]>([]);
  const [posts, setPosts] = useState<FeaturedPost[]>([]);
  const [heroRooms, setHeroRooms] = useState<HeroRoom[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [rooms, setRooms] = useState<BoardRoom[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const token = session?.access_token ?? null;

  const load = useCallback(async () => {
    const [n, p, h, b] = await Promise.all([fetchNews({ token, pass }), fetchFeatured(supabase), fetchHeroRooms(supabase), fetchBoard(supabase)]);
    setNews(n);
    setPosts(p);
    setHeroRooms(h);
    setTopics(b.topics);
    setRooms(b.rooms);
  }, [token, pass]);

  /* Fresh on focus, every half minute in front, and back from the background. */
  useFocusEffect(
    useCallback(() => {
      void load();
      const tick = setInterval(() => void load(), 30_000);
      const sub = AppState.addEventListener("change", (s) => { if (s === "active") void load(); });
      return () => { clearInterval(tick); sub.remove(); };
    }, [load]),
  );

  /* A room going live shows up at once, as on the site. */
  useEffect(() => onQueueChanged(() => void load()), [load]);
  useEffect(() => {
    const ch = supabase
      .channel("home-rooms")
      .on("postgres_changes", { event: "*", schema: "public", table: "debate_rooms" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HomeHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.yellow} />}>
        <Starfield width={width} height={1100} />
        <HeroCarousel rooms={heroRooms} posts={posts} news={news.slice(0, HERO_NEWS)} />
        <NewsTicker stories={news.slice(HERO_NEWS)} />
        <TopicBoard topics={topics} rooms={rooms} onQueue={(t) => (t.am_queued || isQueued(t.id) ? void leaveQueue(t.id) : openQueue({ id: t.id, question: t.question, topicKey: t.topic_key, queueCount: t.queue_count, proCount: t.pro_count, conCount: t.con_count }))} />
      </ScrollView>
    </View>
  );
}
