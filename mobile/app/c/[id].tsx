/* One community: the banner fills the top of the screen edge to edge,
   the tile hangs off it, then the name, description, members and the
   way in; its posts under Best / New / Top. The + starts a post. A
   round back button floats on the banner; a solid title bar takes over
   once the banner scrolls away. */
import { useCallback, useRef, useState } from "react";
import { Animated, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { createPost, fetchCommunities, fetchPosts, toggleJoin, votePost, type Community, type PostRow, type PostSort } from "../../src/communities";
import { CARD, META, PostCard, SortChips } from "../../src/postCard";
import { ComposerSheet } from "../../src/composer";
import { useMe } from "../../src/me";
import { attachPostTopic } from "../../src/postTopic";
import { showToast } from "../../src/toast";
import { ActionSheet } from "../../src/actionSheet";
import { colors, fonts } from "../../src/theme";
import { Note } from "../../src/ui";

const SORTS: { key: PostSort; label: string }[] = [{ key: "best", label: "Best" }, { key: "new", label: "New" }, { key: "top", label: "Top" }];

export default function CommunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const me = useMe();
  const [c, setC] = useState<Community | null>(null);
  const [sort, setSort] = useState<PostSort>("best");
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const insets = useSafeAreaInsets();
  const BANNER = insets.top + 150;
  const BAR = insets.top + 44;
  const scrollY = useRef(new Animated.Value(0)).current;
  const barOpacity = scrollY.interpolate({ inputRange: [BANNER - BAR - 24, BANNER - BAR], outputRange: [0, 1], extrapolate: "clamp" });

  const load = useCallback(async () => {
    try {
      const [cs, ps] = await Promise.all([fetchCommunities(supabase, uid), fetchPosts(supabase, { community: id, sort })]);
      setC(cs.find((x) => x.id === id) ?? null);
      setPosts(ps);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this community.");
    } finally {
      setLoading(false);
    }
  }, [id, uid, sort]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const vote = (p: PostRow, v: number) => {
    if (!uid) return router.push("/sign-in");
    setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, score: x.score + (v - x.my_vote), my_vote: v } : x)));
    votePost(supabase, p.id, v).catch(() => setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, score: p.score, my_vote: p.my_vote } : x))));
  };
  const join = async () => {
    if (!c) return;
    if (!uid) return router.push("/sign-in");
    if (c.joined) { setLeaving(true); return; }
    try { await toggleJoin(supabase, c, uid); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't join."); }
  };
  const leave = async () => {
    setLeaving(false);
    if (!c || !uid) return;
    try { await toggleJoin(supabase, c, uid); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't leave."); }
  };
  const canPost = !!uid && !!c && (!c.is_private || c.joined);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Animated.FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.yellow} />}
        ListHeaderComponent={
          <View>
            {c ? (
              <View style={{ marginBottom: 4 }}>
                {c.banner_url ? (
                  <Image source={{ uri: c.banner_url }} style={{ width: "100%", height: BANNER }} resizeMode="cover" />
                ) : (
                  <View style={{ height: BANNER, backgroundColor: c.color }} />
                )}
                <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
                  {/* The tile hangs off the banner; the way in and the + sit
                      centred on the tile's bottom edge, hanging 16 below it. */}
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
                    <View style={{ width: 76, height: 76, borderRadius: 20, marginTop: -41, borderWidth: 3, borderColor: colors.bg, backgroundColor: c.color, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
                      {c.avatar_url ? <Image source={{ uri: c.avatar_url }} style={{ width: 70, height: 70 }} /> : <Text style={{ color: "#fff", fontFamily: fonts.title, fontSize: 30 }}>{c.name.charAt(0).toUpperCase()}</Text>}
                    </View>
                    <View style={{ flex: 1 }} />
                    {c.my_role === "owner" ? (
                      <Text style={{ color: colors.gold, fontFamily: fonts.extra, fontSize: 9, letterSpacing: 0.8, marginBottom: -5 }}>OWNER</Text>
                    ) : (
                      <Pressable
                        onPress={() => void join()}
                        style={({ pressed }) => ({ height: 32, marginBottom: -16, paddingHorizontal: 14, borderRadius: 16, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1,
                          backgroundColor: c.joined ? colors.surface2 : c.requested ? "transparent" : colors.blue,
                          borderWidth: c.joined || c.requested ? StyleSheet.hairlineWidth : 0, borderColor: c.requested ? colors.gold : colors.border })}
                      >
                        <Text style={{ color: c.requested ? colors.gold : "#fff", fontFamily: fonts.bold, fontSize: 12.5 }}>{c.joined ? "Joined" : c.requested ? "Pending" : c.is_private ? "Request to join" : "Join"}</Text>
                      </Pressable>
                    )}
                    {canPost && (
                      <Pressable onPress={() => setComposing(true)} accessibilityLabel="New post" style={({ pressed }) => ({ width: 36, height: 36, marginBottom: -18, borderRadius: 18, backgroundColor: pressed ? "#ffc22e" : colors.yellow, alignItems: "center", justifyContent: "center" })}>
                        <Ionicons name="add" size={22} color={colors.ink} />
                      </Pressable>
                    )}
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 28 }}>
                    {c.is_private && <Ionicons name="lock-closed-outline" size={14} color={colors.text} />}
                    <Text style={{ flexShrink: 1, color: colors.text, fontFamily: fonts.title, fontSize: 20, letterSpacing: -0.3 }}>{c.name}</Text>
                  </View>
                  {!!c.description && <Text style={{ color: "#c9c9d2", fontFamily: fonts.body, fontSize: 13, lineHeight: 19, marginTop: 6 }}>{c.description}</Text>}
                  <Text style={{ color: META, fontFamily: fonts.body, fontSize: 11, marginTop: 8 }}>{c.members} member{c.members === 1 ? "" : "s"}{c.is_private ? " · private" : ""}</Text>
                </View>
              </View>
            ) : (
              <View style={{ height: BANNER, backgroundColor: colors.surface2 }} />
            )}
            <View style={{ paddingHorizontal: 16, marginTop: 10, marginBottom: 12 }}>
              <SortChips value={sort} options={SORTS} onChange={setSort} />
              {error && <Note tone="error">{error}</Note>}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 16 }}>
            <PostCard post={item} onVote={(v) => vote(item, v)} onOpen={() => router.push({ pathname: "/posts/[id]", params: { id: item.id } })} />
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <Text style={{ color: "rgba(238,238,245,0.32)", fontFamily: fonts.body, fontSize: 12, textAlign: "center", paddingVertical: 32 }}>Loading…</Text>
          ) : (
            <View style={[CARD, { padding: 32, marginHorizontal: 16, alignItems: "center" }]}>
              <Text style={{ color: "#eeeef5", fontFamily: fonts.body, fontSize: 13 }}>No posts in {c?.name ?? "this community"} yet</Text>
              <Text style={{ color: META, fontFamily: fonts.body, fontSize: 11, marginTop: 4, textAlign: "center" }}>Start the first thread — a question, a take, a topic worth arguing about.</Text>
            </View>
          )
        }
      />
      {/* The title bar, solid, once the banner has scrolled away. */}
      <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: BAR, paddingTop: insets.top, backgroundColor: colors.bg, opacity: barOpacity, alignItems: "center", justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17, paddingHorizontal: 60 }}>{c?.name ?? ""}</Text>
      </Animated.View>
      <Pressable onPress={() => router.back()} accessibilityLabel="Back" hitSlop={8} style={({ pressed }) => ({ position: "absolute", top: insets.top - 8, left: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: pressed ? colors.surface2 : colors.bg, alignItems: "center", justifyContent: "center" })}>
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
      <ComposerSheet
        open={composing}
        kind="post"
        communityId={id}
        userId={uid}
        canAttachTopic={!!me?.verified}
        onClose={() => setComposing(false)}
        onSubmit={async ({ title, body, imageUrl, tagId, topic }) => {
          if (!uid) return "Sign in to post.";
          try {
            const postId = await createPost(supabase, { communityId: id, authorId: uid, title, body: body || null, tagId, imageUrl });
            if (topic) { try { await attachPostTopic(supabase, postId, topic, title); } catch (e) { showToast(e instanceof Error ? `Posted, but the queue wasn't attached: ${e.message}` : "Posted, but the queue wasn't attached."); } }
            await load();
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : "Couldn't post.";
          }
        }}
      />
      <ActionSheet
        open={leaving}
        title={c ? `Leave ${c.name}?` : "Leave?"}
        sub="You can join again any time."
        onClose={() => setLeaving(false)}
        actions={[{ label: "Leave community", danger: true, onPress: () => void leave() }]}
      />
    </View>
  );
}
