/* Your feed, as the site's page: All, Following, My communities,
   Popular; the live rooms across the top; then the stream — posts,
   reposts, comments, replays and what's coming up — with why each is
   here. A guest gets the way in. */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { FEED_FILTERS, fetchFeed, fetchSuggestions, whenLabel, type FeedFilter, type FeedItem, type FeedRoom, type Suggestion } from "../../src/feed";
import { setFollowing } from "../../src/profile";
import { timeAgo, votePost, type PostRow } from "../../src/communities";
import { PostCard, META } from "../../src/postCard";
import { RoomSquare } from "../../src/roomCard";
import { RichText, plainPreview } from "../../src/richText";
import { personName } from "../../src/home";
import { Avatar } from "../../src/avatar";
import { HomeHeader } from "../../src/header";
import { colors, fonts } from "../../src/theme";
import { Note } from "../../src/ui";

const card = { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 14 } as const;

export default function Feed() {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const rows = await fetchFeed(supabase, filter, null);
      setItems(rows);
      setError(null);
      if (rows.filter((r) => r.kind !== "live" && r.kind !== "scheduled").length < 5) setSuggestions(await fetchSuggestions(supabase, 8));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your feed.");
      setItems((i) => i ?? []);
    } finally {
      setLoading(false);
    }
  }, [uid, filter]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel("feed-rooms").on("postgres_changes", { event: "*", schema: "public", table: "debate_rooms" }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid, load]);

  const vote = (p: PostRow, v: number) => {
    setItems((its) => (its ?? []).map((it) => (it.kind === "post" || it.kind === "repost") && it.payload.id === p.id ? { ...it, payload: { ...it.payload, score: it.payload.score + (v - it.payload.my_vote), my_vote: v } } : it));
    votePost(supabase, p.id, v).catch(() => void load());
  };
  const follow = async (s: Suggestion) => {
    setFollowed((f) => new Set(f).add(s.id));
    try { await setFollowing(supabase, s.id, true); } catch { setFollowed((f) => { const n = new Set(f); n.delete(s.id); return n; }); }
  };

  const live = (items ?? []).filter((it) => it.kind === "live");
  const stream = (items ?? []).filter((it) => it.kind !== "live");

  const renderItem = ({ item: it }: { item: FeedItem }): ReactNode => {
    const reason = <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 }}><Ionicons name="sparkles-outline" size={11} color="rgba(238,238,245,0.38)" /><Text style={{ color: "rgba(238,238,245,0.38)", fontFamily: fonts.body, fontSize: 10.5 }}>{it.reason}</Text></View>;
    if (it.kind === "post" || it.kind === "repost") {
      const p = it.payload;
      return (
        <View>
          {reason}
          <PostCard post={p} showCommunity communityArt={{ name: p.community_name, color: p.community_color, avatarUrl: p.community_avatar_url ?? null }} onVote={(v) => vote(p, v)} onOpen={() => router.push({ pathname: "/posts/[id]", params: { id: p.id } })} onOpenCommunity={() => router.push({ pathname: "/c/[id]", params: { id: p.community_id } })} />
        </View>
      );
    }
    if (it.kind === "comment") {
      const c = it.payload;
      return (
        <View style={{ marginBottom: 12 }}>
          {reason}
          <Pressable onPress={() => router.push({ pathname: "/posts/[id]", params: { id: c.post_id } })} style={[card, { padding: 14 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Avatar url={c.author.avatar_url} name={c.author.username} size={22} />
              <Text style={{ color: "#c3c3ce", fontFamily: fonts.semi, fontSize: 12 }} onPress={() => router.push({ pathname: "/u/[username]", params: { username: c.author.username } })}>@{c.author.username}</Text>
              <Text style={{ color: "#71717e", fontFamily: fonts.body, fontSize: 11.5 }}>· {timeAgo(c.created_at)}</Text>
            </View>
            <RichText text={c.body} numberOfLines={3} style={{ color: "#e6e6ee", fontFamily: fonts.body, fontSize: 13, lineHeight: 19, marginTop: 6 }} />
            <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, marginTop: 6 }}>on <Text style={{ color: "#c9c9d2", fontFamily: fonts.semi }}>{plainPreview(c.post_title)}</Text> · <Text style={{ color: colors.gold }}>{c.community_name}</Text></Text>
          </Pressable>
        </View>
      );
    }
    const r = it.payload as FeedRoom;
    const replay = it.kind === "replay";
    return (
      <View style={{ marginBottom: 12 }}>
        {reason}
        <Pressable onPress={() => (replay ? router.push({ pathname: "/replay/[id]", params: { id: r.id } }) : router.push({ pathname: "/room/[id]", params: { id: r.id } }))} style={[card, { padding: 12, flexDirection: "row", gap: 12, alignItems: "center" }]}>
          <View style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden", backgroundColor: colors.surface2 }}>
            {(r.thumbnail_url || r.host?.avatar_url) && <Image source={{ uri: (r.thumbnail_url || r.host?.avatar_url)! }} style={{ width: 64, height: 64 }} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: replay ? "#c0c0c8" : colors.purple, fontFamily: fonts.extra, fontSize: 10, letterSpacing: 0.6 }}>{replay ? "REPLAY" : whenLabel(r.scheduled_start).toUpperCase()}</Text>
            <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 14, marginTop: 3 }}>{r.motion}</Text>
            <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, marginTop: 3 }}>{r.community ? r.community.name : personName(r.host)}{!replay && r.reminder_count ? ` · ${r.reminder_count} reminded` : ""}</Text>
          </View>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HomeHeader />
      <FlatList
        data={uid ? stream : []}
        keyExtractor={(it) => `${it.kind}:${it.item_id}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.yellow} />}
        ListHeaderComponent={
          <View>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 24, lineHeight: 36, letterSpacing: -0.3, marginTop: 8 }}>Your feed</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 14 }}>
              {FEED_FILTERS.map((f) => {
                const on = f.id === filter;
                return (
                  <Pressable key={f.id} onPress={() => setFilter(f.id)} style={{ paddingHorizontal: 14, paddingVertical: 5, borderRadius: 8, backgroundColor: on ? colors.yellow : colors.surface, borderWidth: 1, borderColor: on ? colors.yellow : colors.hairline }}>
                    <Text style={{ color: on ? colors.ink : "#c0c0c8", fontFamily: on ? fonts.bold : fonts.body, fontSize: 12 }}>{f.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {!uid && (
              <View style={[card, { padding: 28, alignItems: "center" }]}>
                <Text style={{ color: "#eeeef5", fontFamily: fonts.title, fontSize: 15 }}>Your feed is for members</Text>
                <Text style={{ color: META, fontFamily: fonts.body, fontSize: 12, textAlign: "center", marginTop: 6, marginBottom: 14 }}>Sign in to see live discussions from people you follow, posts from your communities, and what's coming up.</Text>
                <Pressable onPress={() => router.push("/sign-in")} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.blueText }}><Text style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 12 }}>Sign in</Text></Pressable>
              </View>
            )}
            {error && <Note tone="error">{error}</Note>}
            {uid && live.length > 0 && (
              <View style={{ marginBottom: 18 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#ef4444" }} />
                  <Text style={{ color: "rgba(238,238,245,0.7)", fontFamily: fonts.semi, fontSize: 12 }}>Live now</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
                  {live.map((it) => it.kind === "live" && (
                    <View key={it.item_id} style={{ width: 168 }}>
                      <RoomSquare room={it.payload} onPress={() => router.push({ pathname: "/room/[id]", params: { id: it.payload.id } })} />
                      <Text numberOfLines={1} style={{ color: "rgba(238,238,245,0.38)", fontFamily: fonts.body, fontSize: 10, marginTop: 4 }}>{it.reason}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}
            {uid && items !== null && !loading && stream.length === 0 && (
              <View style={[card, { padding: 28, alignItems: "center", marginBottom: 14 }]}>
                <Text style={{ color: "#eeeef5", fontFamily: fonts.title, fontSize: 15 }}>{filter === "all" ? "Your feed is empty" : `Nothing under ${FEED_FILTERS.find((f) => f.id === filter)?.label}`}</Text>
                <Text style={{ color: META, fontFamily: fonts.body, fontSize: 12, textAlign: "center", marginTop: 6 }}>Follow people and join communities to build your feed.</Text>
              </View>
            )}
            {uid && suggestions.length > 0 && stream.length < 5 && (
              <View style={{ marginBottom: 14 }}>
                <Text style={{ color: "rgba(238,238,245,0.38)", fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1, marginBottom: 8 }}>WHO TO FOLLOW</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
                  {suggestions.filter((s) => s.id !== uid).map((s) => (
                    <Pressable key={s.id} onPress={() => router.push({ pathname: "/u/[username]", params: { username: s.username } })} style={[card, { width: 150, padding: 12, alignItems: "center" }]}>
                      <Avatar url={s.avatar_url} name={s.display_name || s.username} size={44} />
                      <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13, marginTop: 8 }}>{s.display_name || s.username}</Text>
                      <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11 }}>@{s.username}</Text>
                      <Text numberOfLines={1} style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 10.5, marginTop: 2 }}>{s.reason}</Text>
                      <Pressable onPress={() => void follow(s)} disabled={followed.has(s.id)} style={{ marginTop: 8, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999, backgroundColor: followed.has(s.id) ? colors.surface2 : colors.blue }}>
                        <Text style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 11.5 }}>{followed.has(s.id) ? "Following" : "Follow"}</Text>
                      </Pressable>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
            {uid && loading && items === null && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12, textAlign: "center", paddingVertical: 24 }}>Loading your feed…</Text>}
          </View>
        }
        renderItem={renderItem as ({ item }: { item: FeedItem }) => React.ReactElement}
      />
    </View>
  );
}
