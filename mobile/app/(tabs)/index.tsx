/* Home: the website's phone home — the hero, the news strip and the
   board of fields — under the site's header, above its tab bar. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { holdBoot } from "../../src/boot";
import { isQueued, leaveQueue, onQueueChanged, openQueue } from "../../src/queue";
import { colors } from "../../src/theme";

/* The hero takes up to three of the major stories (ranked by the feed);
   the strip gets the rest — all of them when none is major. */
const HERO_NEWS = 3;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export default function Home() {
  const { session, pass } = useSession();
  const { width } = useWindowDimensions();
  const [news, setNews] = useState<NewsStory[]>([]);
  const [posts, setPosts] = useState<FeaturedPost[]>([]);
  const [heroRooms, setHeroRooms] = useState<HeroRoom[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [rooms, setRooms] = useState<BoardRoom[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [tickerIn, setTickerIn] = useState(false);
  const token = session?.access_token ?? null;
  const [heroNews, tickerNews] = useMemo(() => {
    const majors = news.filter((s) => s.major);
    return majors.length ? [majors.slice(0, HERO_NEWS), news.filter((s) => !s.major)] : [news.slice(0, HERO_NEWS), news.slice(HERO_NEWS)];
  }, [news]);

  /* The opening sky (boot.tsx) waits, briefly, for the first load, so
     it fades to a whole page rather than one still filling in. Let go
     once that render is committed and the hero is at its height. */
  const bootHold = useRef<(() => void) | null>(null);
  const [firstLoad, setFirstLoad] = useState(false);
  const [heroSettled, setHeroSettled] = useState(false);
  const onHeroSettled = useCallback(() => setHeroSettled(true), []);
  useEffect(() => {
    bootHold.current = holdBoot();
    return () => { bootHold.current?.(); bootHold.current = null; };
  }, []);
  useEffect(() => {
    if (!firstLoad) return;
    /* The hero measures its posts after they mount; wait for its final height too. */
    if (!heroSettled && (heroRooms.length || posts.length || news.length)) return;
    bootHold.current?.();
    bootHold.current = null;
  }, [firstLoad, heroSettled, heroRooms.length, posts.length, news.length]);

  const load = useCallback(async () => {
    try {
      const [n, p, h, b] = await Promise.all([fetchNews({ token, pass }), fetchFeatured(supabase), fetchHeroRooms(supabase), fetchBoard(supabase)]);
      /* A frame apiece for the hero, the strip and the board: one mount of
         all three stalled the opening sky for a few frames. */
      setNews(n);
      setPosts(p);
      setHeroRooms(h);
      await nextFrame();
      setTickerIn(true);
      await nextFrame();
      setTopics(b.topics);
      setRooms(b.rooms);
    } finally {
      setFirstLoad(true);
    }
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
        <HeroCarousel rooms={heroRooms} posts={posts} news={heroNews} onSettled={onHeroSettled} />
        <NewsTicker stories={tickerIn ? tickerNews : []} />
        <TopicBoard topics={topics} rooms={rooms} onQueue={(t) => (t.am_queued || isQueued(t.id) ? void leaveQueue(t.id) : openQueue({ id: t.id, question: t.question, topicKey: t.topic_key, queueCount: t.queue_count, proCount: t.pro_count, conCount: t.con_count }))} />
      </ScrollView>
    </View>
  );
}
