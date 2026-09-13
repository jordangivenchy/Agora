/* One community, as the site shows it on a phone: the banner and the
   tile, name, description, members and the way in; then its posts under
   Best / New / Top. The + up top starts a post. */
import { useCallback, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { createPost, fetchCommunities, fetchPosts, toggleJoin, votePost, type Community, type PostRow, type PostSort } from "../../src/communities";
import { CARD, META, PostCard, SortChips } from "../../src/postCard";
import { ComposerSheet } from "../../src/composer";
import { ActionSheet } from "../../src/actionSheet";
import { colors, fonts } from "../../src/theme";
import { Note } from "../../src/ui";

const SORTS: { key: PostSort; label: string }[] = [{ key: "best", label: "Best" }, { key: "new", label: "New" }, { key: "top", label: "Top" }];

export default function CommunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [c, setC] = useState<Community | null>(null);
  const [sort, setSort] = useState<PostSort>("best");
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [leaving, setLeaving] = useState(false);

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
      <Stack.Screen options={{ title: c?.name ?? "Community" }} />
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.yellow} />}
        ListHeaderComponent={
          <View>
            {c && (
              <View style={[CARD, { overflow: "hidden", marginBottom: 12 }]}>
                {c.banner_url ? (
                  <Image source={{ uri: c.banner_url }} style={{ width: "100%", height: 140 }} resizeMode="cover" />
                ) : (
                  <View style={{ height: 140, backgroundColor: c.color }} />
                )}
                <View style={{ paddingHorizontal: 20, paddingBottom: 18 }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
                    <View style={{ width: 76, height: 76, borderRadius: 20, marginTop: -41, borderWidth: 3, borderColor: colors.bg, backgroundColor: c.color, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
                      {c.avatar_url ? <Image source={{ uri: c.avatar_url }} style={{ width: 70, height: 70 }} /> : <Text style={{ color: "#fff", fontFamily: fonts.title, fontSize: 30 }}>{c.name.charAt(0).toUpperCase()}</Text>}
                    </View>
                    <View style={{ flex: 1 }} />
                    {c.my_role === "owner" ? (
                      <Text style={{ color: colors.gold, fontFamily: fonts.extra, fontSize: 9, letterSpacing: 0.8, marginBottom: 12 }}>OWNER</Text>
                    ) : (
                      <Pressable
                        onPress={() => void join()}
                        style={({ pressed }) => ({ height: 32, paddingHorizontal: 14, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 6, opacity: pressed ? 0.85 : 1,
                          backgroundColor: c.joined ? colors.surface2 : c.requested ? "transparent" : colors.blue,
                          borderWidth: c.joined || c.requested ? StyleSheet.hairlineWidth : 0, borderColor: c.requested ? colors.gold : colors.border })}
                      >
                        <Text style={{ color: c.requested ? colors.gold : "#fff", fontFamily: fonts.bold, fontSize: 12.5 }}>{c.joined ? "Joined" : c.requested ? "Pending" : c.is_private ? "Request to join" : "Join"}</Text>
                      </Pressable>
                    )}
                    {canPost && (
                      <Pressable onPress={() => setComposing(true)} accessibilityLabel="New post" style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, marginBottom: 4, backgroundColor: pressed ? "#ffc22e" : colors.yellow, alignItems: "center", justifyContent: "center" })}>
                        <Ionicons name="add" size={22} color={colors.ink} />
                      </Pressable>
                    )}
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
                    {c.is_private && <Ionicons name="lock-closed-outline" size={14} color={colors.text} />}
                    <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 20, letterSpacing: -0.3 }}>{c.name}</Text>
                  </View>
                  {!!c.description && <Text style={{ color: "#c9c9d2", fontFamily: fonts.body, fontSize: 13, lineHeight: 19, marginTop: 6 }}>{c.description}</Text>}
                  <Text style={{ color: META, fontFamily: fonts.body, fontSize: 11, marginTop: 8 }}>{c.members} member{c.members === 1 ? "" : "s"}{c.is_private ? " · private" : ""}</Text>
                </View>
              </View>
            )}
            <View style={{ marginBottom: 12 }}>
              <SortChips value={sort} options={SORTS} onChange={setSort} />
            </View>
            {error && <Note tone="error">{error}</Note>}
          </View>
        }
        renderItem={({ item }) => (
          <PostCard post={item} onVote={(v) => vote(item, v)} onOpen={() => router.push({ pathname: "/posts/[id]", params: { id: item.id } })} />
        )}
        ListEmptyComponent={
          loading ? (
            <Text style={{ color: "rgba(238,238,245,0.32)", fontFamily: fonts.body, fontSize: 12, textAlign: "center", paddingVertical: 32 }}>Loading…</Text>
          ) : (
            <View style={[CARD, { padding: 32, alignItems: "center" }]}>
              <Text style={{ color: "#eeeef5", fontFamily: fonts.body, fontSize: 13 }}>No posts in {c?.name ?? "this community"} yet</Text>
              <Text style={{ color: META, fontFamily: fonts.body, fontSize: 11, marginTop: 4, textAlign: "center" }}>Start the first thread — a question, a take, a topic worth arguing about.</Text>
            </View>
          )
        }
      />
      <ComposerSheet
        open={composing}
        kind="post"
        onClose={() => setComposing(false)}
        onSubmit={async ({ title, body }) => {
          if (!uid) return "Sign in to post.";
          try {
            await createPost(supabase, { communityId: id, authorId: uid, title, body: body || null });
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
