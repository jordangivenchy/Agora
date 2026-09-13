/* A replay, in the app: the recording plays up top, full width, with
   the system's controls (and the lock screen's, since the app already
   keeps audio going); below it the motion, the host, the field, and
   when it happened. The recording is the same file the site plays. */
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VideoView, useVideoPlayer } from "expo-video";
import { supabase } from "../../src/supabase";
import { personName, type Person } from "../../src/home";
import { roomDuration, fmtCount } from "../../src/discover";
import { topicOf } from "../../src/topics";
import { Avatar } from "../../src/avatar";
import { colors, fonts } from "../../src/theme";

type ReplayRoom = {
  id: string;
  motion: string;
  topic_key: string | null;
  recording_url: string | null;
  started_at: string | null;
  ended_at: string | null;
  replay_views: number | null;
  viewer_count: number | null;
  host: Person | Person[] | null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default function ReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [room, setRoom] = useState<ReplayRoom | null | undefined>(undefined);
  useEffect(() => {
    void supabase
      .from("debate_rooms")
      .select("id, motion, topic_key, recording_url, started_at, ended_at, replay_views, viewer_count, host:users!host_id(id, username, display_name, avatar_url)")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => setRoom((data as unknown as ReplayRoom | null) ?? null));
  }, [id]);
  const player = useVideoPlayer(room?.recording_url ?? null, (p) => { p.loop = false; });
  useEffect(() => { if (room?.recording_url) player.play(); }, [room?.recording_url, player]);
  const host = room ? one(room.host) : null;
  const height = Math.round((width * 9) / 16);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        <View style={{ paddingTop: insets.top, backgroundColor: "#000" }}>
          {room?.recording_url ? (
            <VideoView player={player} style={{ width, height }} nativeControls fullscreenOptions={{ enable: true }} allowsPictureInPicture contentFit="contain" />
          ) : (
            <View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13 }}>{room === undefined ? "Loading…" : "This discussion has no recording."}</Text>
            </View>
          )}
        </View>
        {room && (
          <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 }}>{room.motion}</Text>
            <Pressable onPress={() => host?.username && router.push({ pathname: "/u/[username]", params: { username: host.username } })} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 }}>
              <Avatar url={host?.avatar_url} name={personName(host)} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 14 }}>{personName(host)}</Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>hosted · {topicOf(room.topic_key).label}</Text>
              </View>
            </Pressable>
            <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5, marginTop: 14 }}>
              {room.started_at ? new Date(room.started_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : ""}
              {roomDuration(room.started_at, room.ended_at) ? ` · ${roomDuration(room.started_at, room.ended_at)}` : ""}
              {room.replay_views ? ` · ${fmtCount(room.replay_views)} watched` : ""}
            </Text>
          </View>
        )}
      </ScrollView>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))} accessibilityLabel="Back" hitSlop={8} style={({ pressed }) => ({ position: "absolute", top: insets.top - 8, left: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: pressed ? colors.surface2 : colors.bg, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border })}>
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
    </View>
  );
}
