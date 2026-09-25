/* One community, as the site's phone page draws it (components/
   CommunitiesPage.tsx): the banner edge to edge with the tile hanging off
   it, the name, the description and who's in it; the way in for
   visitors; Start a discussion and Mod tools for its moderators, Invite
   for members, and ⋯ for the rest: copy link, mute, leave, block. Then its
   posts under Best / New / Top, or the door when it's private and you're
   not in. Under the posts, the site's rail: live and upcoming discussions,
   the bookmarks, the rules and the moderators. A round back button floats
   on the banner; a solid title bar takes over once the banner scrolls away. */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Alert, Animated, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Img } from "../../src/img";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { createPost, fetchCommunity, fetchPosts, setCommunityBlocked, setCommunityMuted, toggleJoin, votePost, type Community, type PostRow, type PostSort } from "../../src/communities";
import { fetchCommunityRooms, fetchJoinRequests, fetchMods, personName, type CommunityRoom, type Member } from "../../src/communityAdmin";
import { isGroup, type Bookmark } from "../../src/communityBookmarks";
import { CARD, META, PostCard, SortChips } from "../../src/postCard";
import { ComposerSheet } from "../../src/composer";
import { useMe } from "../../src/me";
import { useCreate } from "../../src/create";
import { useUserMenu } from "../../src/userMenu";
import { usePresence } from "../../src/presence";
import { attachPostTopic } from "../../src/postTopic";
import { showToast } from "../../src/toast";
import { copyToClipboard } from "../../src/clipboard";
import { ActionSheet } from "../../src/actionSheet";
import { ItemSheet, type SheetItem } from "../../src/itemSheet";
import { same, useFocusRefresh, useScreenOpened } from "../../src/refresh";
import { ReminderBell, useReminders } from "../../src/reminders";
import { ApplySheet, InviteSheet } from "../../src/communitySheets";
import { communityLink, openLink } from "../../src/siteLinks";
import { Avatar } from "../../src/avatar";
import { colors, fonts } from "../../src/theme";
import { Note } from "../../src/ui";
import { FloatingBack } from "../../src/floatingBack";

const SORTS: { key: PostSort; label: string }[] = [{ key: "best", label: "Best" }, { key: "new", label: "New" }, { key: "top", label: "Top" }];
const GOLD = "#e2b96b";

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* The site's header pills: gold to start a discussion, blue to get in or
   open the mod tools, amber while a request waits, dark to invite. */
function Pill({ label, icon, tone, onPress }: { label: string; icon?: React.ComponentProps<typeof Ionicons>["name"]; tone: "gold" | "blue" | "amber" | "dark"; onPress: () => void }) {
  const bg = tone === "gold" ? colors.yellow : tone === "blue" ? colors.blue : tone === "amber" ? "#17150e" : "#0b0b0d";
  const border = tone === "amber" ? "#5a4a26" : tone === "dark" ? "#2e2e38" : bg;
  const ink = tone === "gold" ? colors.ink : tone === "amber" ? GOLD : tone === "dark" ? "#e8e8ee" : "#fff";
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, height: 30, paddingHorizontal: 13, borderRadius: 999, backgroundColor: bg, borderWidth: 1, borderColor: border, opacity: pressed ? 0.85 : 1 })}>
      {icon && <Ionicons name={icon} size={13} color={ink} />}
      <Text style={{ color: ink, fontFamily: fonts.semi, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function RailLabel({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18, marginBottom: 8 }}>
      <Text style={{ color: "rgba(238,238,245,0.38)", fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1 }}>{children.toUpperCase()}</Text>
      {right}
    </View>
  );
}

export default function CommunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const me = useMe();
  const { openRoom } = useCreate();
  const { openUserMenu } = useUserMenu();
  const presence = usePresence();
  const [c, setC] = useState<Community | null>(null);
  const [sort, setSort] = useState<PostSort>("best");
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [mods, setMods] = useState<Member[]>([]);
  const [rooms, setRooms] = useState<CommunityRoom[]>([]);
  const [requestCount, setRequestCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [group, setGroup] = useState<Extract<Bookmark, { items: unknown }> | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const BANNER = insets.top + 150;
  const BAR = insets.top + 44;
  const scrollY = useRef(new Animated.Value(0)).current;
  const barOpacity = scrollY.interpolate({ inputRange: [BANNER - BAR - 24, BANNER - BAR], outputRange: [0, 1], extrapolate: "clamp" });

  const opened = useScreenOpened();
  /* Everything at once, landing in one render after the page has slid in
     (refresh.ts): the head and the posts, then the mods and rooms, used to
     re-render the page twice, mid-slide. */
  const load = useCallback(async () => {
    try {
      const [cm, ps, ms, rs] = await Promise.all([fetchCommunity(supabase, id, uid), fetchPosts(supabase, { community: id, sort }), fetchMods(supabase, id), fetchCommunityRooms(supabase, [id])]);
      const mod = !!cm && (cm.my_role === "owner" || cm.my_role === "moderator");
      const reqs = mod ? await fetchJoinRequests(supabase, id) : [];
      await opened();
      setC(same(cm));
      setPosts(same(ps));
      setError(null);
      if (cm) {
        setMods(same(ms));
        setRooms(same(rs));
        setRequestCount(reqs.length);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this community.");
    } finally {
      setLoading(false);
    }
  }, [id, uid, sort, opened]);
  useFocusRefresh(load, { progress: false });

  const isOwner = c?.my_role === "owner";
  const isMod = isOwner || c?.my_role === "moderator";
  const lockedOut = !!c && c.is_private && !c.joined;
  const canPost = !!uid && !!c && (!c.is_private || c.joined);

  const vote = (p: PostRow, v: number) => {
    if (!uid) return router.push("/sign-in");
    setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, score: x.score + (v - x.my_vote), my_vote: v } : x)));
    votePost(supabase, p.id, v).catch(() => setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, score: p.score, my_vote: p.my_vote } : x))));
  };
  /* The way in: join a public community, apply to a private one, or take a pending request back. */
  const join = async () => {
    if (!c) return;
    if (!uid) return router.push("/sign-in");
    if (c.is_private && !c.joined && !c.requested) { setApplying(true); return; }
    try {
      const r = await toggleJoin(supabase, c, uid);
      if (r === "withdrawn") showToast("Request withdrawn");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join.");
    }
  };
  const leave = async () => {
    setLeaving(false);
    if (!c || !uid) return;
    try { await toggleJoin(supabase, c, uid); showToast(`Left ${c.name}`); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't leave."); }
  };
  const toggleMute = async () => {
    if (!c || !uid) return;
    const next = !c.muted;
    setC({ ...c, muted: next });
    try {
      await setCommunityMuted(supabase, c.id, uid, next);
      showToast(next ? "Notifications muted" : "Notifications on");
    } catch (e) {
      setC((cur) => (cur ? { ...cur, muted: !next } : cur));
      showToast(e instanceof Error ? e.message : "Couldn't update notifications.");
    }
  };
  const block = async (next: boolean) => {
    if (!c) return;
    try {
      await setCommunityBlocked(supabase, c.id, next);
      showToast(next ? `Blocked ${c.name}` : `Unblocked ${c.name}`);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't update.");
    }
  };

  const menuItems: SheetItem[] = [];
  if (c) {
    menuItems.push({ icon: "link-outline", label: "Copy link", run: () => void communityLink(c).then((url) => copyToClipboard(url, "Link copied")) });
    if (c.joined) menuItems.push({ icon: c.muted ? "notifications-outline" : "notifications-off-outline", label: c.muted ? "Unmute notifications" : "Mute notifications", run: () => void toggleMute() });
    if (c.joined && !isOwner) menuItems.push({ icon: "log-out-outline", label: "Leave community", danger: true, run: () => setLeaving(true) });
    if (uid && !isOwner) {
      menuItems.push(c.blocked
        ? { icon: "ban-outline", label: "Unblock community", run: () => void block(false) }
        : {
            icon: "ban-outline",
            label: "Block community",
            danger: true,
            run: () => Alert.alert(`Block ${c.name}?`, "You'll leave it, and its posts stay out of your feeds. You can unblock it here any time.", [
              { text: "Cancel", style: "cancel" },
              { text: "Block", style: "destructive", onPress: () => void block(true) },
            ]),
          });
    }
  }

  const live = rooms.filter((r) => r.status === "live");
  const upcoming = rooms.filter((r) => r.status !== "live");
  const { reminders, toggle: toggleReminder, busy: reminderBusy } = useReminders(upcoming.filter((r) => !r.is_private).map((r) => r.id));
  const rules = (c?.rules ?? "").split("\n").map((r) => r.trim()).filter(Boolean);
  const onlineMods = mods.filter((m) => presence.has(m.user_id)).length;
  const longAbout = (c?.description?.length ?? 0) > 130;

  const header = (
    <View>
      {c ? (
        <View style={{ marginBottom: 4 }}>
          {c.banner_url ? (
            <Img uri={c.banner_url} style={{ width: "100%", height: BANNER }} priority="high" />
          ) : (
            <View style={{ height: BANNER, backgroundColor: c.color }} />
          )}
          <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
            {/* The tile hangs off the banner; ⋯ and the + sit centred on the
                tile's bottom edge, hanging below it. */}
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
              <View style={{ width: 76, height: 76, borderRadius: 20, marginTop: -41, borderWidth: 3, borderColor: colors.bg, backgroundColor: c.color, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
                {c.avatar_url ? <Img uri={c.avatar_url} style={{ width: 70, height: 70 }} /> : <Text style={{ color: "#fff", fontFamily: fonts.title, fontSize: 30 }}>{c.name.charAt(0).toUpperCase()}</Text>}
              </View>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => setMenuOpen(true)} accessibilityLabel="Community options" style={({ pressed }) => ({ width: 36, height: 36, marginBottom: -18, borderRadius: 18, backgroundColor: pressed ? "#22222a" : colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: "center", justifyContent: "center" })}>
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
              </Pressable>
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
            <Text style={{ color: META, fontFamily: fonts.body, fontSize: 11, marginTop: 4 }}>
              {c.members} member{c.members === 1 ? "" : "s"} · {c.is_private ? "private" : "public"}
              {c.my_role ? ` · you're ${c.my_role === "owner" ? "the owner" : c.my_role === "moderator" ? "a moderator" : "a member"}` : ""}
            </Text>
            {!!c.description && (
              <>
                <Text numberOfLines={longAbout && !aboutOpen ? 3 : undefined} style={{ color: "#c9c9d2", fontFamily: fonts.body, fontSize: 13, lineHeight: 19, marginTop: 8 }}>{c.description}</Text>
                {longAbout && (
                  <Text onPress={() => setAboutOpen((v) => !v)} style={{ color: GOLD, fontFamily: fonts.semi, fontSize: 11.5, marginTop: 4 }}>{aboutOpen ? "Show less ▴" : "Read more ▾"}</Text>
                )}
              </>
            )}
            {c.blocked && <Text style={{ color: "#f08a8a", fontFamily: fonts.body, fontSize: 12, marginTop: 8 }}>You blocked this community. Its posts stay out of your feeds.</Text>}
            {(() => {
              const pills: ReactNode[] = [];
              if (isMod) pills.push(<Pill key="start" tone="gold" icon="mic-outline" label="Start a discussion" onPress={() => openRoom({ community: { id: c.id, name: c.name } })} />);
              if (!c.joined && c.kind !== "profile" && !c.blocked) pills.push(<Pill key="join" tone={c.requested ? "amber" : "blue"} label={c.requested ? "Pending" : c.is_private ? "Request to join" : "Join"} onPress={() => void join()} />);
              if (c.joined && (!c.is_private || isMod)) pills.push(<Pill key="invite" tone="dark" icon="person-add-outline" label="Invite" onPress={() => setInviting(true)} />);
              if (isMod) pills.push(<Pill key="mod" tone="blue" icon="shield-outline" label={requestCount ? `Mod tools · ${requestCount}` : "Mod tools"} onPress={() => router.push({ pathname: "/c/mod/[id]", params: { id: c.id } })} />);
              return pills.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>{pills}</View> : null;
            })()}
          </View>
        </View>
      ) : (
        <View style={{ height: BANNER, backgroundColor: colors.surface2 }} />
      )}
      {!lockedOut && (
        <View style={{ paddingHorizontal: 16, marginTop: 10, marginBottom: 12 }}>
          <SortChips value={sort} options={SORTS} onChange={setSort} />
        </View>
      )}
      {error && <View style={{ paddingHorizontal: 16 }}><Note tone="error">{error}</Note></View>}
    </View>
  );

  const roomRow = (r: CommunityRoom, isLive: boolean) => (
    <Pressable key={r.id} onPress={() => router.push({ pathname: "/room/[id]", params: { id: r.id } })} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: isLive ? "#170d0e" : colors.surface, borderWidth: 1, borderColor: isLive ? "#5a2626" : colors.hairline, opacity: pressed ? 0.85 : 1 })}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {isLive && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#e84040" }} />}
          <Text style={{ color: isLive ? "#e84040" : GOLD, fontFamily: fonts.semi, fontSize: 10.5 }}>{isLive ? "LIVE — join" : when(r.scheduled_start) || "Scheduled"}{!isLive && (reminders[r.id]?.count ?? 0) > 0 ? ` · ${reminders[r.id].count} waiting` : ""}</Text>
        </View>
        <Text numberOfLines={2} style={{ color: "rgba(238,238,245,0.88)", fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, marginTop: 3 }}>{r.motion}</Text>
      </View>
      {!isLive && !r.is_private && <ReminderBell set={!!reminders[r.id]?.amSet} onPress={() => void toggleReminder(r.id)} disabled={reminderBusy === r.id} size={30} />}
    </Pressable>
  );

  const rail = c && (
    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
      {live.length > 0 && (<><RailLabel>Live discussions</RailLabel>{live.map((r) => roomRow(r, true))}</>)}
      {upcoming.length > 0 && (<><RailLabel>Scheduled discussions</RailLabel>{upcoming.map((r) => roomRow(r, false))}</>)}
      {c.bookmarks.length > 0 && (
        <>
          <RailLabel>Community bookmarks</RailLabel>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {c.bookmarks.map((b) => (
              <Pressable key={b.label} onPress={() => (isGroup(b) ? setGroup(b) : void openLink(b.url))} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: pressed ? "#1d1d24" : colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border })}>
                <Text style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 13 }}>{b.label}</Text>
                <Ionicons name={isGroup(b) ? "chevron-down" : "open-outline"} size={12} color="rgba(238,238,245,0.6)" />
              </Pressable>
            ))}
          </View>
        </>
      )}
      {rules.length > 0 && (
        <>
          <RailLabel>{`${c.name} rules`}</RailLabel>
          <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}>
            {(rulesOpen ? rules : rules.slice(0, 3)).map((r, i) => (
              <Text key={i} style={{ color: "rgba(238,238,245,0.72)", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, marginTop: i === 0 ? 0 : 6 }}>
                <Text style={{ color: GOLD, fontFamily: fonts.bold, fontSize: 11 }}>{i + 1}  </Text>{r}
              </Text>
            ))}
            {rules.length > 3 && <Text onPress={() => setRulesOpen((v) => !v)} style={{ color: GOLD, fontFamily: fonts.semi, fontSize: 11.5, marginTop: 8 }}>{rulesOpen ? "Show less ▴" : `Show all ${rules.length} rules ▾`}</Text>}
          </View>
        </>
      )}
      {mods.length > 0 && (
        <>
          <RailLabel right={onlineMods > 0 ? <Text style={{ color: "#00b894", fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1 }}>● {onlineMods} ONLINE</Text> : undefined}>Moderators</RailLabel>
          {[...mods].sort((a, b) => Number(presence.has(b.user_id)) - Number(presence.has(a.user_id))).map((m) => (
            <Pressable key={m.user_id} onPress={() => m.user?.username && openUserMenu({ userId: m.user_id, username: m.user.username, displayName: m.user.display_name })} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}>
              <Avatar url={m.user?.avatar_url ?? null} name={m.user?.username ?? "?"} size={24} />
              <Text numberOfLines={1} style={{ flex: 1, color: "rgba(238,238,245,0.85)", fontFamily: fonts.body, fontSize: 13 }}>
                {personName(m.user)}
                {m.role === "owner" && <Text style={{ color: GOLD, fontFamily: fonts.bold, fontSize: 9 }}>  OWNER</Text>}
              </Text>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: presence.has(m.user_id) ? "#00b894" : "rgba(238,238,245,0.22)" }} />
            </Pressable>
          ))}
        </>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Animated.FlatList
        data={lockedOut ? [] : posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.yellow} />}
        ListHeaderComponent={header}
        ListFooterComponent={rail}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 16 }}>
            <PostCard
              post={item}
              onVote={(v) => vote(item, v)}
              onOpen={() => router.push({ pathname: "/posts/[id]", params: { id: item.id } })}
              onChanged={(patch) => {
                setPosts((ps) => ps.map((x) => (x.id === item.id ? { ...x, ...patch } : x)));
                /* Pinned posts lead the community's feed: re-sort from the server. */
                if ("pinned_at" in patch) void load();
              }}
              onRemoved={() => setPosts((ps) => ps.filter((x) => x.id !== item.id))}
            />
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <Text style={{ color: "rgba(238,238,245,0.32)", fontFamily: fonts.body, fontSize: 12, textAlign: "center", paddingVertical: 32 }}>Loading…</Text>
          ) : lockedOut && c ? (
            <View style={[CARD, { padding: 28, marginHorizontal: 16, marginTop: 12, alignItems: "center" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="lock-closed-outline" size={14} color="#eeeef5" />
                <Text style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 15 }}>This community is private</Text>
              </View>
              <Text style={{ color: META, fontFamily: fonts.body, fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: "center" }}>Posts are visible to members only. Request to join and a moderator will review it.</Text>
              {!c.blocked && <View style={{ marginTop: 14 }}><Pill tone={c.requested ? "amber" : "blue"} label={c.requested ? "Pending" : "Request to join"} onPress={() => void join()} /></View>}
            </View>
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
      <FloatingBack top={insets.top - 8} />
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
      <ItemSheet open={menuOpen} title={c?.name} items={menuItems} onClose={() => setMenuOpen(false)} />
      <ItemSheet open={!!group} title={group?.label} items={(group?.items ?? []).map((it) => ({ icon: "open-outline" as const, label: it.label, run: () => void openLink(it.url) }))} onClose={() => setGroup(null)} />
      <ApplySheet community={applying ? c : null} onClose={() => setApplying(false)} onApplied={() => { showToast("Application sent"); void load(); }} />
      <InviteSheet community={inviting ? c : null} onClose={() => setInviting(false)} />
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
