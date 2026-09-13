/* Notifications: the site's page behind the bell. The filters, the
   rows by day, unread in gold, Mark all read; a friend request gets
   Accept and Dismiss on the row; realtime brings new ones in. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/supabase";
import { useSession } from "../src/session";
import { actorLabel, bumpUnread, dayLabel, fetchNotifications, markAllRead, markRead, matchesFilter, notifDetail, notifIcon, notifTarget, notifText, timeAgo, NOTIF_FILTERS, NOTIF_PAGE, type NotifFilter, type NotifRow } from "../src/notifications";
import { Avatar } from "../src/avatar";
import { LoadingLine } from "../src/sky";
import { showToast } from "../src/toast";
import { colors, fonts } from "../src/theme";
import { Button, Screen, Sub, Title } from "../src/ui";

type Row = { kind: "label"; key: string; label: string } | { kind: "row"; key: string; n: NotifRow; first: boolean };

export default function Notifications() {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [items, setItems] = useState<NotifRow[]>([]);
  const [filter, setFilter] = useState<NotifFilter>("all");
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);
  const [busyMore, setBusyMore] = useState(false);
  const [followedBack, setFollowedBack] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!uid) { setLoading(false); return; }
    const rows = await fetchNotifications(supabase, null);
    setItems(rows);
    setMore(rows.length === NOTIF_PAGE);
    setLoading(false);
    const actorIds = [...new Set(rows.filter((n) => n.type === "new_follower" && n.actor_id).map((n) => n.actor_id!))];
    if (actorIds.length) {
      const { data } = await supabase.from("user_follows").select("following_id").eq("follower_id", uid).in("following_id", actorIds);
      setFollowedBack(new Set(((data ?? []) as { following_id: string }[]).map((f) => f.following_id)));
    }
  }, [uid]);
  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel("notif-page-app")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, () => {
        void fetchNotifications(supabase, null).then((rows) => setItems((xs) => { const ids = new Set(rows.map((r) => r.id)); return [...rows, ...xs.filter((x) => !ids.has(x.id))]; }));
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid]);

  const loadMore = async () => {
    if (busyMore || !more || items.length === 0) return;
    setBusyMore(true);
    const rows = await fetchNotifications(supabase, items[items.length - 1].created_at);
    setItems((xs) => { const seen = new Set(xs.map((x) => x.id)); return [...xs, ...rows.filter((r) => !seen.has(r.id))]; });
    setMore(rows.length === NOTIF_PAGE);
    setBusyMore(false);
  };

  const unread = items.filter((n) => !n.read_at).length;
  const markAll = async () => {
    if (unread === 0) return;
    const now = new Date().toISOString();
    setItems((xs) => xs.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    await markAllRead(supabase);
    bumpUnread();
  };

  const open = async (n: NotifRow) => {
    if (!n.read_at) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      void markRead(supabase, n.id).then(bumpUnread);
    }
    const t = notifTarget(n);
    if (!t) return;
    if (t.kind === "post") router.push({ pathname: "/posts/[id]", params: { id: t.id } });
    else if (t.kind === "room") router.push(t.ended ? { pathname: "/replay/[id]", params: { id: t.id } } : { pathname: "/room/[id]", params: { id: t.id } });
    else if (t.kind === "user") router.push({ pathname: "/u/[username]", params: { username: t.username } });
    else {
      const { data } = await supabase.from("communities").select("id").eq("name", t.name).maybeSingle();
      const id = (data as { id: string } | null)?.id;
      if (id) router.push({ pathname: "/c/[id]", params: { id } });
      else showToast("That community isn't around any more.");
    }
  };

  const accept = async (n: NotifRow) => {
    if (!n.actor_id) return;
    const { error } = await supabase.rpc("follow_user", { p_target: n.actor_id });
    if (error) showToast("Couldn't add them back.");
    else { setFollowedBack((s) => new Set(s).add(n.actor_id!)); showToast(`You and ${actorLabel(n)} are friends now`); }
  };

  const visible = useMemo(() => items.filter((n) => matchesFilter(n.type, filter) && !dismissed.has(n.id)), [items, filter, dismissed]);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let last = "";
    for (const n of visible) {
      const label = dayLabel(n.created_at);
      if (label !== last) { out.push({ kind: "label", key: `l-${label}`, label }); last = label; }
      out.push({ kind: "row", key: n.id, n, first: out[out.length - 1]?.kind === "label" });
    }
    return out;
  }, [visible]);

  if (!uid) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Notifications" }} />
        <View style={{ paddingTop: 24 }}>
          <Title>Notifications are for members</Title>
          <Sub>Sign in to hear when someone follows you, answers you, or goes live.</Sub>
          <Button onPress={() => router.replace("/sign-in")}>Sign in</Button>
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "Notifications", headerBackTitle: "Back", headerRight: () => (
        <Pressable onPress={() => void markAll()} disabled={unread === 0} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 5, opacity: unread > 0 ? 1 : 0.4 }}>
          <Ionicons name="checkmark-done-outline" size={15} color={colors.text} />
          <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 12 }}>Mark all read</Text>
        </Pressable>
      ) }} />
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>{unread > 0 ? `${unread} unread` : "You're all caught up"} · <Text onPress={() => router.push({ pathname: "/settings/[section]", params: { section: "notifications" } })} style={{ color: "#9cc4f0" }}>Preferences</Text></Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 12, marginBottom: 8 }}>
          {NOTIF_FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <Pressable key={f.id} onPress={() => setFilter(f.id)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: on ? "#2a2410" : colors.surface2, borderWidth: 1, borderColor: on ? "#6b5a2a" : colors.border }}>
                <Text style={{ color: on ? colors.gold : "#b8b8c2", fontFamily: on ? fonts.semi : fonts.medium, fontSize: 12.5 }}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {loading ? <LoadingLine label="Loading notifications" /> : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.6}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingVertical: 40, backgroundColor: "#121218", borderWidth: 1, borderColor: colors.border, borderRadius: 14, marginTop: 8 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center", marginBottom: 10 }}><Ionicons name="notifications-outline" size={20} color={colors.muted} /></View>
              <Text style={{ color: "#d5d5dc", fontFamily: fonts.body, fontSize: 14 }}>{filter === "all" ? "Nothing yet" : `No ${NOTIF_FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} yet`}</Text>
              <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5, marginTop: 4, textAlign: "center", paddingHorizontal: 24 }}>Follow speakers, join communities and set reminders to hear when things happen.</Text>
            </View>
          }
          ListFooterComponent={more && items.length > 0 ? <View style={{ alignItems: "center", paddingVertical: 16 }}><Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>{busyMore ? "Loading…" : ""}</Text></View> : null}
          renderItem={({ item }) => {
            if (item.kind === "label") return <Text style={{ color: colors.faint, fontFamily: fonts.semi, fontSize: 11, letterSpacing: 0.8, marginTop: 14, marginBottom: 8 }}>{item.label.toUpperCase()}</Text>;
            const n = item.n;
            const unreadRow = !n.read_at;
            const detail = notifDetail(n);
            const friendReq = n.type === "new_follower" && !!n.actor_id;
            return (
              <Pressable onPress={() => void open(n)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: pressed ? "#1a1a20" : unreadRow ? "#171512" : "#121218", borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 6 })}>
                <View>
                  {n.actor_id ? <Avatar url={n.actor_avatar_url} name={n.actor_username ?? "?"} size={36} /> : (
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}><Ionicons name={notifIcon(n.type)} size={16} color="#c0c0c8" /></View>
                  )}
                  <View style={{ position: "absolute", right: -5, bottom: -5, width: 18, height: 18, borderRadius: 6, backgroundColor: unreadRow ? "#e2b96b" : "#2a2a33", borderWidth: 2, borderColor: "#121218", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={notifIcon(n.type)} size={9} color={unreadRow ? "#2a1a00" : "#a0a0aa"} />
                  </View>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: unreadRow ? colors.text : "#c9c9d1", fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19 }}>{notifText(n)}</Text>
                  {!!detail && <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12, marginTop: 3 }}>“{detail}”</Text>}
                  {!!n.community_name && (n.type === "post_comment" || n.type === "post_reply" || n.type === "repost" || n.type === "post_upvotes") && <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11, marginTop: 3 }}>in {n.community_name}</Text>}
                  {friendReq && (
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                      {followedBack.has(n.actor_id!) ? (
                        <Text style={{ color: colors.green, fontFamily: fonts.semi, fontSize: 12 }}>✓ Friends</Text>
                      ) : (
                        <>
                          <Pressable onPress={() => void accept(n)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.yellow }}><Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 12 }}>Accept</Text></Pressable>
                          <Pressable onPress={() => setDismissed((s) => new Set(s).add(n.id))} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border }}><Text style={{ color: "#c9c9d2", fontFamily: fonts.semi, fontSize: 12 }}>Dismiss</Text></Pressable>
                        </>
                      )}
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
                  <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11 }}>{timeAgo(n.created_at)}</Text>
                  {unreadRow && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.gold }} />}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
