/* A person's page, modeled on the site's profile on a phone, with the
   head full bleed: the banner runs edge to edge and under the status
   bar, the avatar hangs off it, the way in sits on its bottom edge;
   then the name, the handle, the bio, the counts, and the tabs —
   past discussions, scheduled, posts, reposts, comments, communities. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Image, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Img } from "./img";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { same, useFocusRefresh, useScreenOpened } from "./refresh";
import { useSession } from "./session";
import { fetchDebates, fetchProfile, fetchUserComments, fetchUserCommunities, fetchUserPosts, setFollowing, type DebateRow, type Profile, type UserComment, type UserCommunity } from "./profile";
import { timeAgo, votePost, type PostRow } from "./communities";
import { PostCard, META } from "./postCard";
import { RichText, plainPreview } from "./richText";
import { ActionSheet, type SheetAction } from "./actionSheet";
import { topicOf } from "./topics";
import { whenLabel } from "./feed";
import { useUserMenu } from "./userMenu";
import { SITE } from "./api";
import { ReminderBell, useReminders } from "./reminders";
import { colors, fonts } from "./theme";
import { Note } from "./ui";

type Tab = "debates" | "scheduled" | "posts" | "reposts" | "comments" | "communities";
const TABS: { key: Tab; label: string }[] = [
  { key: "debates", label: "Past discussions" },
  { key: "scheduled", label: "Scheduled" },
  { key: "posts", label: "Posts" },
  { key: "reposts", label: "Reposts" },
  { key: "comments", label: "Comments" },
  { key: "communities", label: "Communities" },
];

export function ProfileScreen({ username, menu, back = true }: { username: string; /** Extra actions for the person's own page (settings, sign out). */ menu?: SheetAction[]; back?: boolean }) {
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const viewerId = session?.user.id ?? null;
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [debates, setDebates] = useState<DebateRow[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [comments, setComments] = useState<UserComment[]>([]);
  const [communities, setCommunities] = useState<UserCommunity[]>([]);
  const [tab, setTab] = useState<Tab>("debates");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { openUserMenu } = useUserMenu();
  const BANNER = insets.top + 130;
  const BAR = insets.top + 44;
  const scrollY = useRef(new Animated.Value(0)).current;
  const barOpacity = scrollY.interpolate({ inputRange: [BANNER - BAR - 24, BANNER - BAR], outputRange: [0, 1], extrapolate: "clamp" });

  const opened = useScreenOpened();
  /* One render with everything, after the page has slid in (refresh.ts). */
  const load = useCallback(async () => {
    try {
      const p = await fetchProfile(supabase, username);
      if (!p) { await opened(); setProfile(null); return; }
      const [d, ps, cs, ms] = await Promise.all([fetchDebates(supabase, p.id), fetchUserPosts(supabase, p.id), fetchUserComments(supabase, p.id), fetchUserCommunities(supabase, p.id)]);
      await opened();
      setProfile(same(p));
      setDebates(same(d));
      setPosts(same(ps));
      setComments(same(cs));
      setCommunities(same(ms));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this profile.");
      setProfile((p) => p ?? null);
    }
  }, [username, opened]);
  useFocusRefresh(load, { progress: false });

  const isSelf = !!profile && profile.id === viewerId;
  const follow = async () => {
    if (!profile) return;
    if (!viewerId) return router.push("/sign-in");
    setBusy(true);
    try {
      await setFollowing(supabase, profile.id, !profile.is_following);
      setProfile(await fetchProfile(supabase, username));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't follow.");
    } finally {
      setBusy(false);
    }
  };
  const vote = (p: PostRow, v: number) => {
    if (!viewerId) return router.push("/sign-in");
    setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, score: x.score + (v - x.my_vote), my_vote: v } : x)));
    votePost(supabase, p.id, v).catch(() => setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, score: p.score, my_vote: p.my_vote } : x))));
  };

  const recorded = debates.filter((d) => d.status === "ended" && !!d.recording_url);
  const upcoming = debates.filter((d) => d.status !== "ended" && d.status !== "live" && !!d.scheduled_start && new Date(d.scheduled_start) > new Date());
  /* The site's "Notify me" bells on scheduled rows (public rooms only). */
  const { reminders, toggle: toggleReminder, busy: reminderBusy } = useReminders(upcoming.filter((d) => !d.is_private).map((d) => d.id));
  const own = posts.filter((p) => !p.is_repost);
  const reposts = posts.filter((p) => p.is_repost);
  const counts: Record<Tab, number> = { debates: recorded.length, scheduled: upcoming.length, posts: own.length, reposts: reposts.length, comments: comments.length, communities: communities.length };
  const first = profile?.display_name?.trim().split(/\s+/)[0] || (profile ? `@${profile.username}` : "");

  const empty = (text: string) => <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 13, textAlign: "center", paddingVertical: 28 }}>{text}</Text>;
  let body: ReactNode = null;
  if (tab === "debates") {
    body = recorded.length === 0 ? empty(isSelf ? "No recorded discussions yet." : `${first} has no recorded discussions yet.`) : recorded.map((d) => <DebateCard key={d.id} d={d} fallback={profile?.avatar_url ?? null} />);
  } else if (tab === "scheduled") {
    body = upcoming.length === 0 ? empty("Nothing scheduled.") : upcoming.map((d) => (
      <Pressable key={d.id} onPress={() => router.push({ pathname: "/room/[id]", params: { id: d.id } })} style={[card, { padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.purple, fontFamily: fonts.extra, fontSize: 10, letterSpacing: 0.6 }}>{whenLabel(d.scheduled_start).toUpperCase()}</Text>
          <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15, marginTop: 4 }}>{d.motion}</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginTop: 3 }}>
            {d.role === "host" ? "hosting" : `debating · hosted by @${d.host_username ?? "?"}`} · {topicOf(d.topic_key).label}
            {(reminders[d.id]?.count ?? 0) > 0 ? ` · ${reminders[d.id].count} waiting` : ""}
          </Text>
        </View>
        {!d.is_private && <ReminderBell set={!!reminders[d.id]?.amSet} onPress={() => void toggleReminder(d.id)} disabled={reminderBusy === d.id} />}
      </Pressable>
    ));
  } else if (tab === "posts" || tab === "reposts") {
    const list = tab === "posts" ? own : reposts;
    body = list.length === 0 ? empty(tab === "posts" ? "No posts yet." : "No reposts yet.") : list.map((p) => (
      <PostCard
        key={p.id}
        post={p}
        showCommunity
        communityArt={{ name: p.community_name }}
        onVote={(v) => vote(p, v)}
        onOpen={() => router.push({ pathname: "/posts/[id]", params: { id: p.id } })}
        onOpenCommunity={() => router.push({ pathname: "/c/[id]", params: { id: p.community_id } })}
        onChanged={(patch) => setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, ...patch } : x)))}
        onRemoved={() => setPosts((ps) => ps.filter((x) => x.id !== p.id))}
      />
    ));
  } else if (tab === "comments") {
    body = comments.length === 0 ? empty("No comments yet.") : comments.map((c) => (
      <Pressable key={c.id} onPress={() => router.push({ pathname: "/posts/[id]", params: { id: c.post_id } })} style={[card, { padding: 14, marginBottom: 10 }]}>
        <RichText text={c.body} numberOfLines={3} style={{ color: "#e6e6ee", fontFamily: fonts.body, fontSize: 13, lineHeight: 19 }} />
        <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, marginTop: 6 }}>
          on <Text style={{ color: "#c9c9d2", fontFamily: fonts.semi }}>{plainPreview(c.post_title)}</Text> · <Text style={{ color: colors.gold }}>{c.community_name}</Text> · {timeAgo(c.created_at)}
        </Text>
      </Pressable>
    ));
  } else {
    body = communities.length === 0 ? empty(isSelf ? "Not in any communities yet." : `${first} hasn't joined a community.`) : communities.map((c) => (
      <Pressable key={c.id} onPress={() => router.push({ pathname: "/c/[id]", params: { id: c.id } })} style={[card, { padding: 12, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 }]}>
        <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: c.color ?? colors.blueText, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
          {c.avatar_url ? <Img uri={c.avatar_url} style={{ width: 28, height: 28 }} /> : <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 13 }}>{c.name.charAt(0).toUpperCase()}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 14 }}>{c.name}</Text>
            {(c.role === "owner" || c.role === "mod" || c.role === "moderator") && <Text style={{ color: colors.gold, fontFamily: fonts.bold, fontSize: 9.5, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.gold }}>{c.role === "owner" ? "owner" : "mod"}</Text>}
          </View>
          <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, marginTop: 2 }}>{c.member_count} member{Number(c.member_count) === 1 ? "" : "s"}</Text>
        </View>
      </Pressable>
    ));
  }

  const actionLabel = !profile ? "" : isSelf ? "Edit profile" : profile.is_following ? "Following" : profile.is_followed_by ? "Add friend back" : "Add friend";
  /* Your own page shares its link (the site's Share profile, /@username). */
  const shareProfile = () => {
    if (!profile) return;
    const url = `${SITE}/@${encodeURIComponent(profile.username)}`;
    /* iOS shares a url and a message as two items; the link alone is one. */
    void Share.share(Platform.OS === "ios" ? { url } : { message: url }).catch(() => undefined);
  };
  const menuActions: SheetAction[] = [
    ...(isSelf ? [{ label: "Edit profile", onPress: () => { setMenuOpen(false); router.push("/edit-profile"); } }, { label: "Share profile", onPress: () => { setMenuOpen(false); setTimeout(shareProfile, 350); } }] : []),
    ...(menu ?? []).map((a) => ({ ...a, onPress: () => { setMenuOpen(false); a.onPress(); } })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.yellow} />}
      >
        {profile?.banner_url ? (
          <Img uri={profile.banner_url} style={{ width: "100%", height: BANNER }} priority="high" />
        ) : (
          <View style={{ height: BANNER, backgroundColor: colors.surface2 }} />
        )}
        <View style={{ paddingHorizontal: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
            <View style={{ width: 96, height: 96, borderRadius: 48, marginTop: -48, borderWidth: 3, borderColor: colors.bg, backgroundColor: colors.surface2, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
              {profile?.avatar_url ? <Img uri={profile.avatar_url} style={{ width: 90, height: 90 }} /> : <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 36 }}>{(profile?.display_name || profile?.username || "?").charAt(0).toUpperCase()}</Text>}
            </View>
            <View style={{ flex: 1 }} />
            {profile && (
              <Pressable
                onPress={() => (isSelf ? router.push("/edit-profile") : void follow())}
                disabled={busy}
                style={({ pressed }) => ({ height: 32, marginBottom: -16, paddingHorizontal: 14, borderRadius: 16, alignItems: "center", justifyContent: "center", opacity: pressed || busy ? 0.85 : 1,
                  backgroundColor: isSelf || profile.is_following ? colors.surface2 : colors.blue, borderWidth: isSelf || profile.is_following ? StyleSheet.hairlineWidth : 0, borderColor: colors.border })}
              >
                <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 12.5 }}>{actionLabel}</Text>
              </Pressable>
            )}
            {(menuActions.length > 0 || (profile && !isSelf)) && (
              <Pressable onPress={() => (isSelf ? setMenuOpen(true) : profile && openUserMenu({ userId: profile.id, username: profile.username, displayName: profile.display_name }, { hideViewProfile: true, verify: { verified: !!profile.verified, onChanged: () => void load() } }))} accessibilityLabel="More" style={({ pressed }) => ({ width: 32, height: 32, marginBottom: -16, borderRadius: 16, backgroundColor: pressed ? colors.border : colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: "center", justifyContent: "center" })}>
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
              </Pressable>
            )}
          </View>
          {profile === undefined && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 13, marginTop: 28 }}>Loading…</Text>}
          {profile === null && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 13, marginTop: 28 }}>No one by that name.</Text>}
          {profile && (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 28, flexWrap: "wrap" }}>
                <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 24, letterSpacing: -0.4 }}>{profile.display_name || profile.username}</Text>
                {profile.verified && <Ionicons name="checkmark-circle" size={20} color={colors.yellow} />}
                {profile.live_room_id && (
                  <Pressable onPress={() => router.push({ pathname: "/room/[id]", params: { id: profile.live_room_id! } })} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#ef4444", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" }} />
                      <Text style={{ color: "#fff", fontFamily: fonts.extra, fontSize: 10.5, letterSpacing: 0.6 }}>LIVE</Text>
                    </View>
                    {!!profile.live_room_motion && <Text numberOfLines={1} style={{ color: "#c9c9d2", fontFamily: fonts.medium, fontSize: 13, maxWidth: 160 }}>{profile.live_room_motion}</Text>}
                  </Pressable>
                )}
              </View>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13.5, marginTop: 4 }}>
                @{profile.username} · joined {new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </Text>
              {!!profile.bio && <Text style={{ color: "#c9c9d2", fontFamily: fonts.body, fontSize: 14, lineHeight: 21, marginTop: 10 }}>{profile.bio}</Text>}
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 18, marginTop: 12 }}>
                <Pressable onPress={() => router.push({ pathname: "/people", params: { user: profile.id, mode: "followers" } })} hitSlop={6}><Text style={{ color: "#c9c9d2", fontFamily: fonts.body, fontSize: 13.5 }}><Text style={{ color: colors.text, fontFamily: fonts.bold }}>{profile.follower_count}</Text> Followers</Text></Pressable>
                <Pressable onPress={() => router.push({ pathname: "/people", params: { user: profile.id, mode: "following" } })} hitSlop={6}><Text style={{ color: "#c9c9d2", fontFamily: fonts.body, fontSize: 13.5 }}><Text style={{ color: colors.text, fontFamily: fonts.bold }}>{profile.following_count}</Text> Following</Text></Pressable>
                {typeof profile.karma === "number" && <Text style={{ color: "#c9c9d2", fontFamily: fonts.body, fontSize: 13.5 }}><Text style={{ color: colors.text, fontFamily: fonts.bold }}>{profile.karma}</Text> Goatedness</Text>}
                {profile.is_friend && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
                    <Ionicons name="person-circle-outline" size={13} color={colors.green} />
                    <Text style={{ color: colors.green, fontFamily: fonts.semi, fontSize: 12 }}>Friends</Text>
                  </View>
                )}
              </View>
              {!isSelf && !!profile.mutual_names?.length && (
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, marginTop: 8 }}>Also followed by <Text style={{ color: "#c9c9d2", fontFamily: fonts.semi }}>{profile.mutual_names.join(", ")}</Text></Text>
              )}
            </>
          )}
          {error && <Note tone="error">{error}</Note>}
        </View>
        {profile && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, paddingTop: 20, paddingBottom: 14 }}>
              {TABS.map((t) => {
                const on = t.key === tab;
                return (
                  <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: on ? "#1c1c22" : "transparent" }}>
                    <Text style={{ color: on ? colors.text : colors.muted, fontFamily: fonts.title, fontSize: 13 }}>{t.label}</Text>
                    <Text style={{ color: on ? "#a9a9b4" : colors.faint, fontFamily: fonts.body, fontSize: 12 }}>{counts[t.key]}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ paddingHorizontal: 16 }}>{body}</View>
          </>
        )}
      </Animated.ScrollView>
      <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: BAR, paddingTop: insets.top, backgroundColor: colors.bg, opacity: barOpacity, alignItems: "center", justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17, paddingHorizontal: 60 }}>{profile?.display_name || profile?.username || ""}</Text>
      </Animated.View>
      {back && (
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))} accessibilityLabel="Back" hitSlop={8} style={({ pressed }) => ({ position: "absolute", top: insets.top - 8, left: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: pressed ? colors.surface2 : colors.bg, alignItems: "center", justifyContent: "center" })}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
      )}
      <ActionSheet open={menuOpen} title={profile?.display_name || profile?.username || ""} onClose={() => setMenuOpen(false)} actions={menuActions} />
    </View>
  );
}

const card = { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 14 } as const;

/* A recorded discussion: the picture wide, Watch on it, the motion and
   the part this person played. Tap to play it in the app. */
function DebateCard({ d, fallback }: { d: DebateRow; /** The page's own avatar, for rooms this person hosted. */ fallback: string | null }) {
  const img = d.thumbnail_url || d.host_avatar_url || (d.role === "host" ? fallback : null);
  return (
    <Pressable onPress={() => router.push({ pathname: "/replay/[id]", params: { id: d.id } })} style={({ pressed }) => [card, { overflow: "hidden", marginBottom: 12, opacity: pressed ? 0.9 : 1 }]}>
      <View style={{ aspectRatio: 16 / 9, backgroundColor: "#0d1b3e" }}>
        {img && <Img uri={img} style={StyleSheet.absoluteFill} />}
        <View style={{ position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.bg, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 }}>
          <Ionicons name="play" size={11} color={colors.text} />
          <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 12 }}>Watch</Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
        <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15 }}>{d.motion}</Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginTop: 3 }}>{d.role === "host" ? "hosted" : `debated · hosted by @${d.host_username ?? "?"}`} · {topicOf(d.topic_key).label}</Text>
        <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11.5, marginTop: 3 }}>{new Date(d.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{d.viewer_count ? ` · ${d.viewer_count} watched` : ""}</Text>
      </View>
    </Pressable>
  );
}
