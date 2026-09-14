/* Communities, as the site's phone page: the feed across every community
   under Best / New / Top, then the rail — find a community, yours, the
   ones to discover, and the live and scheduled discussions your
   communities host. Communities you blocked stay out of all of it. */
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { fetchCommunities, fetchPosts, setFavorite, toggleJoin, votePost, type Community, type PostRow, type PostSort } from "../../src/communities";
import { CARD, CommunityTile, META, PostCard, SortChips } from "../../src/postCard";
import { HomeHeader } from "../../src/header";
import { fetchCommunityRooms, type CommunityRoom } from "../../src/communityAdmin";
import { ApplySheet } from "../../src/communitySheets";
import { showToast } from "../../src/toast";
import { useCreate } from "../../src/create";
import { colors, fonts } from "../../src/theme";
import { Note } from "../../src/ui";

const SORTS: { key: PostSort; label: string }[] = [{ key: "best", label: "Best" }, { key: "new", label: "New" }, { key: "top", label: "Top" }];

export default function Communities() {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [communities, setCommunities] = useState<Community[]>([]);
  const [sort, setSort] = useState<PostSort>("best");
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [rooms, setRooms] = useState<CommunityRoom[]>([]);
  const [applyFor, setApplyFor] = useState<Community | null>(null);
  const { openCommunity } = useCreate();

  const load = useCallback(async () => {
    try {
      const [cs, ps] = await Promise.all([fetchCommunities(supabase, uid), fetchPosts(supabase, { community: null, sort })]);
      setCommunities(cs);
      setPosts(ps);
      setError(null);
      setRooms(await fetchCommunityRooms(supabase, cs.filter((c) => c.joined && !c.blocked).map((c) => c.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load communities.");
    } finally {
      setLoading(false);
    }
  }, [uid, sort]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const needSignIn = () => { router.push("/sign-in"); };

  const vote = useCallback((p: PostRow, v: number) => {
    if (!uid) return needSignIn();
    setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, score: x.score + (v - x.my_vote), my_vote: v } : x)));
    votePost(supabase, p.id, v).catch(() => setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, score: p.score, my_vote: p.my_vote } : x))));
  }, [uid]);

  const join = useCallback(async (c: Community) => {
    if (!uid) return needSignIn();
    /* A private community takes an application first. */
    if (c.is_private && !c.requested) { setApplyFor(c); return; }
    try {
      await toggleJoin(supabase, c, uid);
      setCommunities(await fetchCommunities(supabase, uid));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join.");
    }
  }, [uid]);

  const favorite = useCallback(async (c: Community) => {
    setCommunities((cs) => cs.map((x) => (x.id === c.id ? { ...x, favorite: !c.favorite } : x)));
    setFavorite(supabase, c.id, !c.favorite).catch(() => setCommunities((cs) => cs.map((x) => (x.id === c.id ? { ...x, favorite: c.favorite } : x))));
  }, []);

  const byId = new Map(communities.map((c) => [c.id, c]));
  const q = query.trim().toLowerCase();
  const match = (c: Community) => !q || c.name.toLowerCase().includes(q);
  /* u/ boards live on profiles, not in the directory. */
  const joined = communities.filter((c) => c.kind !== "profile" && c.joined && !c.blocked && match(c)).sort((a, b) => Number(b.favorite) - Number(a.favorite));
  const discover = communities.filter((c) => c.kind !== "profile" && !c.joined && !c.blocked && match(c));
  const blocked = new Set(communities.filter((c) => c.blocked).map((c) => c.id));
  const visiblePosts = posts.filter((p) => !blocked.has(p.community_id));
  const liveRooms = rooms.filter((r) => r.status === "live");
  const upcoming = rooms.filter((r) => r.status !== "live");
  const roomRow = (r: CommunityRoom, live: boolean) => {
    const c = byId.get(r.community_id);
    return (
      <Pressable key={r.id} onPress={() => router.push({ pathname: "/room/[id]", params: { id: r.id } })} style={({ pressed }) => ({ marginBottom: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: live ? "#170d0e" : colors.surface, borderWidth: 1, borderColor: live ? "#5a2626" : colors.hairline, opacity: pressed ? 0.85 : 1 })}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 3, backgroundColor: c?.color ?? colors.blue }} />
          <Text numberOfLines={1} style={{ flex: 1, color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 10.5 }}>{c?.name ?? "Community"}</Text>
          <Text style={{ color: live ? "#e84040" : "#e2b96b", fontFamily: fonts.semi, fontSize: 10.5 }}>{live ? "● LIVE — join" : r.scheduled_start ? new Date(r.scheduled_start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Scheduled"}</Text>
        </View>
        <Text numberOfLines={2} style={{ color: "rgba(238,238,245,0.88)", fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 17, marginTop: 3 }}>{r.motion}</Text>
      </Pressable>
    );
  };

  const row = (c: Community) => (
    <Pressable key={c.id} onPress={() => router.push({ pathname: "/c/[id]", params: { id: c.id } })} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: pressed ? colors.surface2 : "transparent" })}>
      <CommunityTile name={c.name} color={c.color} avatarUrl={c.avatar_url} size={26} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: "#eeeef5", fontFamily: fonts.body, fontSize: 12.5 }}>
          {c.is_private && <Ionicons name="lock-closed-outline" size={11} color="#eeeef5" />}{c.is_private ? " " : ""}{c.name}
        </Text>
        <Text style={{ color: "rgba(238,238,245,0.32)", fontFamily: fonts.body, fontSize: 10 }}>{c.members} member{c.members === 1 ? "" : "s"}</Text>
      </View>
      {c.joined ? (
        <Pressable onPress={() => void favorite(c)} hitSlop={8} accessibilityLabel={c.favorite ? "Remove bookmark" : "Bookmark this community"}>
          <Ionicons name={c.favorite ? "bookmark" : "bookmark-outline"} size={15} color={c.favorite ? colors.gold : "rgba(238,238,245,0.28)"} />
        </Pressable>
      ) : (
        <Pressable
          onPress={() => void join(c)}
          style={c.requested
            ? { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.gold }
            : { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.blue }}
        >
          <Text style={{ color: c.requested ? colors.gold : "#fff", fontFamily: fonts.semi, fontSize: 10 }}>{c.requested ? "Pending" : c.is_private ? "Request" : "Join"}</Text>
        </Pressable>
      )}
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HomeHeader />
      <FlatList
        data={visiblePosts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.yellow} />}
        ListHeaderComponent={
          <View>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 22, letterSpacing: -0.3 }}>Communities</Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, marginTop: 4 }}>Communities for your school, team, or topic</Text>
              </View>
              <Pressable onPress={() => openCommunity()} accessibilityLabel="New community" style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: pressed ? "#ffc22e" : colors.yellow, alignItems: "center", justifyContent: "center" })}>
                <Ionicons name="add" size={26} color={colors.ink} />
              </Pressable>
            </View>
            <View style={{ marginTop: 14, marginBottom: 12 }}>
              <SortChips value={sort} options={SORTS} onChange={setSort} />
            </View>
            {error && <Note tone="error">{error}</Note>}
          </View>
        }
        renderItem={({ item }) => {
          const c = byId.get(item.community_id);
          return (
            <PostCard
              post={item}
              showCommunity
              communityArt={{ name: item.community_name, color: c?.color, avatarUrl: c?.avatar_url ?? null }}
              onVote={(v) => vote(item, v)}
              onOpen={() => router.push({ pathname: "/posts/[id]", params: { id: item.id } })}
              onOpenCommunity={() => router.push({ pathname: "/c/[id]", params: { id: item.community_id } })}
              onChanged={(patch) => setPosts((ps) => ps.map((x) => (x.id === item.id ? { ...x, ...patch } : x)))}
              onRemoved={() => setPosts((ps) => ps.filter((x) => x.id !== item.id))}
            />
          );
        }}
        ListEmptyComponent={
          loading ? (
            <Text style={{ color: "rgba(238,238,245,0.32)", fontFamily: fonts.body, fontSize: 12, textAlign: "center", paddingVertical: 32 }}>Loading…</Text>
          ) : (
            <View style={[CARD, { padding: 32, alignItems: "center" }]}>
              <Text style={{ color: "#eeeef5", fontFamily: fonts.body, fontSize: 13 }}>No posts yet</Text>
              <Text style={{ color: META, fontFamily: fonts.body, fontSize: 11, marginTop: 4, textAlign: "center" }}>Start the first thread — a question, a take, a topic worth arguing about.</Text>
            </View>
          )
        }
        ListFooterComponent={
          <View style={{ marginTop: 16 }}>
            {communities.length > 3 && (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Find a community…"
                placeholderTextColor={colors.faint}
                style={{ backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: colors.text, fontFamily: fonts.body, fontSize: 13, marginBottom: 6 }}
              />
            )}
            {joined.length > 0 && <Label>Your communities</Label>}
            {joined.map(row)}
            {discover.length > 0 && <Label>Discover</Label>}
            {discover.map(row)}
            {liveRooms.length > 0 && <Label>Live discussions</Label>}
            {liveRooms.map((r) => roomRow(r, true))}
            {upcoming.length > 0 && <Label>Scheduled discussions</Label>}
            {upcoming.map((r) => roomRow(r, false))}
          </View>
        }
      />
      <ApplySheet community={applyFor} onClose={() => setApplyFor(null)} onApplied={() => { showToast("Application sent"); void load(); }} />
    </View>
  );
}

function Label({ children }: { children: string }) {
  return <Text style={{ color: "rgba(238,238,245,0.38)", fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}>{children.toUpperCase()}</Text>;
}
