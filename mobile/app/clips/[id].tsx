/* A clip's own page (app/(chrome)/clips/[id]): the saved window of the
   room's recording playing natively, when it was clipped, the title,
   the field, who clipped it and the views; Watch full video, Share,
   Post to community; the host's card with the friend button; more
   clips — this discussion's first, then the most watched. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEvent } from "expo";
import { VideoView, useVideoPlayer } from "expo-video";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { SITE } from "../../src/api";
import { agoLong, bumpClipView, fetchClip, fetchClips, formatClipDuration, formatViews, type ClipRow, type ClipTileData } from "../../src/clips";
import { ClipTile } from "../../src/clipTile";
import { Avatar } from "../../src/avatar";
import { topicOf } from "../../src/topics";
import { setFollowing } from "../../src/profile";
import { useCreate } from "../../src/create";
import { LoadingScreen } from "../../src/sky";
import { showToast } from "../../src/toast";
import { colors, fonts } from "../../src/theme";

type HostCard = { is_following: boolean; is_followed_by: boolean; last: { status: string; at: string } | null };

export default function ClipPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const clipId = typeof id === "string" ? id : "";
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { session } = useSession();
  const viewerId = session?.user.id ?? null;
  const { openPost } = useCreate();
  const [clip, setClip] = useState<ClipRow | null | undefined>(undefined);
  const [more, setMore] = useState<ClipTileData[]>([]);
  const [hostCard, setHostCard] = useState<HostCard | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
    let on = true;
    void fetchClip(supabase, clipId).then((c) => {
      if (!on) return;
      setClip(c);
      if (c && bumpClipView(supabase, clipId)) setClip({ ...c, view_count: (c.view_count ?? 0) + 1 });
      if (c) void fetchClips(supabase, { exclude: c.id, sameRoomFirst: c.room_id, limit: 12 }).then((rows) => { if (on) setMore(rows); });
    });
    return () => { on = false; };
  }, [clipId]);

  const host = clip?.room?.host && !Array.isArray(clip.room.host) ? clip.room.host : null;
  const loadHostCard = useCallback(async () => {
    if (!host) return;
    const [{ data: prof }, { data: rooms }] = await Promise.all([
      supabase.rpc("get_user_profile", { p_user: host.id }),
      supabase.from("debate_rooms").select("status, started_at, ended_at, created_at").eq("host_id", host.id).eq("is_private", false).order("created_at", { ascending: false }).limit(1),
    ]);
    const row = (Array.isArray(prof) ? prof[0] : prof) as { is_following?: boolean; is_followed_by?: boolean } | null;
    const r = (rooms ?? [])[0] as { status: string; started_at: string | null; ended_at: string | null; created_at: string } | undefined;
    setHostCard({ is_following: !!row?.is_following, is_followed_by: !!row?.is_followed_by, last: r ? { status: r.status, at: r.ended_at ?? r.started_at ?? r.created_at } : null });
  }, [host]);
  useEffect(() => { void loadHostCard(); }, [loadHostCard]);

  const src = clip ? clip.video_url ?? clip.room?.recording_url ?? null : null;
  const range = useMemo(() => (clip && !clip.video_url && clip.start_seconds !== null && clip.end_seconds !== null ? { start: clip.start_seconds, end: clip.end_seconds } : null), [clip]);

  const player = useVideoPlayer(src, (p) => { p.timeUpdateEventInterval = 0.25; });
  const { currentTime } = useEvent(player, "timeUpdate", { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const [started, setStarted] = useState(false);
  /* The window: start there, stop at the end, replay from the start. */
  useEffect(() => {
    if (!range || status !== "readyToPlay" || started) return;
    player.currentTime = range.start;
    player.play();
    setStarted(true);
  }, [range, status, started, player]);
  useEffect(() => {
    if (!range || !started) return;
    if (currentTime >= range.end - 0.1 && player.playing) player.pause();
  }, [currentTime, range, started, player]);
  const replay = () => { if (range) player.currentTime = range.start; player.play(); };

  const share = () => void Share.share({ message: clip?.title || "Clip", url: `${SITE}/clips/${clipId}` }).catch(() => undefined);
  const toggleFollow = async () => {
    if (!host || followBusy) return;
    if (!viewerId) { router.push("/sign-in"); return; }
    setFollowBusy(true);
    try { await setFollowing(supabase, host.id, !hostCard?.is_following); await loadHostCard(); } catch { showToast("Couldn't do that."); }
    setFollowBusy(false);
  };

  if (clip === undefined) return <View style={{ flex: 1 }}><LoadingScreen /></View>;
  if (clip === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 24 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={{ color: "#c0c0c8", fontFamily: fonts.body, fontSize: 14 }}>This clip doesn't exist, or its room is private.</Text>
        <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.blue }}><Text style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 13 }}>Back</Text></Pressable>
      </View>
    );
  }
  const topic = clip.room?.topic_key ? topicOf(clip.room.topic_key) : null;
  const live = clip.room?.status === "live";
  const fullVideo = clip.room ? (live ? { pathname: "/room/[id]" as const, params: { id: clip.room.id } } : clip.room.recording_url ? { pathname: "/replay/[id]" as const, params: { id: clip.room.id } } : null) : null;
  const isSelf = !!host && !!viewerId && host.id === viewerId;
  const hostName = host ? host.display_name?.trim() || host.username : null;
  const tile = (width - 32 - 12) / 2;
  const pill = (label: string, icon: React.ComponentProps<typeof Ionicons>["name"], onPress: () => void, primary?: boolean) => (
    <Pressable key={label} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: primary ? colors.blue : "#26262e" }}>
      <Ionicons name={icon} size={13} color="#eeeef5" />
      <Text style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 40 }}>
        <View style={{ width, aspectRatio: 16 / 9, backgroundColor: "#000" }}>
          {src ? (
            <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls allowsPictureInPicture fullscreenOptions={{ enable: true }} contentFit="contain" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", backgroundColor: "#101014" }]}><Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13 }}>This clip's recording isn't available.</Text></View>
          )}
          {range && started && currentTime >= range.end - 0.1 && (
            <Pressable onPress={replay} style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#000", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", alignItems: "center", justifyContent: "center" }}><Ionicons name="refresh" size={26} color="#fff" /></View>
            </Pressable>
          )}
        </View>
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: colors.yellow }} />
            <Text style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 13 }}>{agoLong(clip.created_at)}</Text>
          </View>
          <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17, lineHeight: 22, marginTop: 8 }}>{clip.title || "Clip"}</Text>
          {topic && <Text style={{ color: colors.yellow, fontFamily: fonts.semi, fontSize: 13.5, marginTop: 4 }}>{topic.label}</Text>}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {clip.uploader && (
              <Pressable onPress={() => router.push({ pathname: "/u/[username]", params: { username: clip.uploader!.username } })} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13 }}>{clip.room ? "Clipped by" : "Posted by"}</Text>
                <Avatar url={clip.uploader.avatar_url} name={clip.uploader.username} size={16} />
                <Text style={{ color: "#c9c9d2", fontFamily: fonts.semi, fontSize: 13 }}>@{clip.uploader.username}</Text>
                <Text style={{ color: "#3a3a42" }}>·</Text>
              </Pressable>
            )}
            <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13 }}>{formatViews(clip.view_count ?? 0)}</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            {fullVideo && pill(live ? "Join live" : "Watch full video", live ? "flash-outline" : "play-outline", () => router.push(fullVideo))}
            {pill("Share", "link-outline", share, true)}
            {pill("Post to community", "chatbox-outline", () => openPost({ clip: { id: clip.id, title: clip.title || "Clip", duration: formatClipDuration(clip.duration_seconds) } }))}
          </View>
          {clip.room && host && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 20, padding: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline }}>
              <Pressable onPress={() => router.push({ pathname: "/u/[username]", params: { username: host.username } })}><Avatar url={host.avatar_url} name={host.username} size={52} /></Pressable>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 15, flexShrink: 1 }}>{hostName}</Text>
                  {host.verified && <Ionicons name="checkmark-circle" size={15} color={colors.yellow} />}
                  <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>@{host.username}</Text>
                </View>
                <Text numberOfLines={2} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, marginTop: 3 }}>
                  {hostCard?.last?.status === "live" ? <Text style={{ color: colors.live, fontFamily: fonts.semi }}>● Live now · </Text> : hostCard?.last ? `Last live ${agoLong(hostCard.last.at)} · ` : ""}from “{clip.room.motion}”
                </Text>
              </View>
              {!isSelf && (
                <Pressable onPress={() => void toggleFollow()} disabled={followBusy} style={{ height: 34, paddingHorizontal: 16, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: hostCard?.is_following ? "#0b0b0d" : colors.blue, borderWidth: 1, borderColor: hostCard?.is_following ? colors.border : colors.blue }}>
                  <Text style={{ color: hostCard?.is_following ? "#c9c9d2" : "#fff", fontFamily: fonts.semi, fontSize: 12.5 }}>{hostCard?.is_following ? "Following" : hostCard?.is_followed_by ? "Add friend back" : "Add friend"}</Text>
                </Pressable>
              )}
            </View>
          )}
          {more.length > 0 && (
            <View style={{ marginTop: 28 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 18 }}>More clips</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, marginTop: 2, marginBottom: 14 }}>{clip.room_id && more[0]?.room_id === clip.room_id ? "From this discussion first, then the most watched across the Agora." : "The most watched across the Agora."}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {more.map((c) => <ClipTile key={c.id} clip={c} width={tile} onPress={() => router.push({ pathname: "/clips/[id]", params: { id: c.id } })} />)}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))} accessibilityLabel="Back" hitSlop={8} style={({ pressed }) => ({ position: "absolute", top: insets.top + 8, left: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: pressed ? colors.surface2 : "#16161c", alignItems: "center", justifyContent: "center" })}>
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
    </View>
  );
}
