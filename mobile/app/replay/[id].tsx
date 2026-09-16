/* A past discussion, as the site's replay page draws it on a phone
   (components/agora/DebateReplay.tsx): the recording up top with the
   system's controls (and the lock screen's, since the app keeps audio
   going); the motion with when it happened, how long it ran and who
   watched; Like, Share and Clip this moment; the speakers; the transcript
   following playback, searchable, a tap on a line jumping there; the
   clips cut from it; the discussion thread, where a comment lands on the
   room's post (made on first use) and Open full thread goes to replies
   and votes; and more past discussions to watch next. A room that wasn't
   recorded still opens: its transcript and its discussion. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEvent, useEventListener } from "expo";
import { Animated, Image, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VideoView, useVideoPlayer } from "expo-video";
import * as ScreenOrientation from "expo-screen-orientation";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { createComment, fetchAvatars, timeAgo, type CommentRow } from "../../src/communities";
import {
  bumpReplayView, ensureDiscussion, fetchDiscussion, fetchLikes, fetchMoreReplays, fetchReplay, fetchTimeline, fmtClock, fmtDurationLong, toggleLike,
  type MoreReplay, type ReplayRoom, type TranscriptLine,
} from "../../src/replay";
import { roomLink } from "../../src/roomData";
import { roomDuration, fmtCount } from "../../src/discover";
import { TOPICS } from "../../src/topics";
import { Avatar } from "../../src/avatar";
import { RichText } from "../../src/richText";
import { ComposerSheet } from "../../src/composer";
import { ClipEditorSheet } from "../../src/clipEditor";
import { ClipTile } from "../../src/clipTile";
import { ReplayControls } from "../../src/replayControls";
import { fetchClips, type ClipTileData } from "../../src/clips";
import { videoTime, type TimelineSpan } from "../../../src/components/agora/hlsTimeline";
import { showToast } from "../../src/toast";
import { colors, fonts } from "../../src/theme";

const nameOf = (p: { display_name?: string | null; username: string }) => p.display_name?.trim() || p.username;

/* The first match of the search, marked in the line. */
function Marked({ text, query, style }: { text: string; query: string; style: object }) {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <Text style={style}>{text}</Text>;
  return (
    <Text style={style}>
      {text.slice(0, at)}
      <Text style={{ backgroundColor: "#4a3f14", color: "#fff" }}>{text.slice(at, at + q.length)}</Text>
      {text.slice(at + q.length)}
    </Text>
  );
}

function Btn({ icon, label, on, disabled, onPress }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; on?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: on, disabled }} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: pressed ? "#34343e" : "#2a2a32", borderWidth: 1, borderColor: on ? colors.yellow : "#2a2a32", opacity: disabled ? 0.6 : 1 })}>
      <Ionicons name={icon} size={14} color={on ? colors.yellow : "#e5e5ec"} />
      <Text style={{ color: on ? colors.yellow : "#e5e5ec", fontFamily: fonts.medium, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export default function ReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width, height: screenH } = useWindowDimensions();
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const [room, setRoom] = useState<ReplayRoom | null | undefined>(undefined);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [avatars, setAvatars] = useState<Map<string, string | null>>(new Map());
  const [likes, setLikes] = useState<{ count: number; liked: boolean } | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [views, setViews] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<TimelineSpan[]>([]);
  const [query, setQuery] = useState("");
  const [transcriptOpen, setTranscriptOpen] = useState<boolean | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  /* Full screen is ours, not the system player's: over there the only
     controls are AVKit's own, which this page turns off, so the video
     filled the screen with nothing to press and no way out but a drag
     down. The same player and the same controls, on a black screen. */
  const [fullscreen, setFullscreen] = useState(false);
  const [userScrolled, setUserScrolled] = useState(false);
  const [more, setMore] = useState<MoreReplay[]>([]);
  const [clips, setClips] = useState<ClipTileData[]>([]);
  const [editor, setEditor] = useState<{ at: number } | null>(null);
  const [composing, setComposing] = useState(false);
  const [discussBusy, setDiscussBusy] = useState(false);

  const loadComments = useCallback(async (postId: string | null) => {
    if (!postId) { setComments([]); return; }
    const cs = await fetchDiscussion(supabase, postId);
    setComments(cs);
    setAvatars(await fetchAvatars(supabase, cs.map((c) => c.author_id)));
  }, []);
  const load = useCallback(async () => {
    const r = await fetchReplay(supabase, id).catch(() => ({ room: null, lines: [] as TranscriptLine[] }));
    setRoom(r.room);
    setLines(r.lines);
    await loadComments(r.room?.discussion_post_id ?? null);
  }, [id, loadComments]);
  /* Back from the full thread, the discussion shows what was added there. */
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const recordingUrl = room?.recording_url ?? null;
  const recorded = !!recordingUrl;
  const player = useVideoPlayer(recordingUrl, (p) => { p.loop = false; p.timeUpdateEventInterval = 0.5; });
  const viewRef = useRef<VideoView>(null);
  const fsRef = useRef<VideoView>(null);
  useEffect(() => { if (recordingUrl) player.play(); }, [recordingUrl, player]);
  /* Full screen turns with the phone; everywhere else the app is portrait
     (app/_layout.tsx), so closing it puts that back. */
  useEffect(() => {
    if (!fullscreen) return;
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(() => undefined);
    return () => { void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined); };
  }, [fullscreen]);
  /* A jump in the time is a seek from the player's own controls: the
     transcript follows again, as the site's onSeeking resets it. */
  const lastTime = useRef(0);
  useEventListener(player, "timeUpdate", ({ currentTime: t }) => {
    if (Math.abs(t - lastTime.current) > 2.5) setUserScrolled(false);
    lastTime.current = t;
    setCurrentTime(t);
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const playerError = recorded && status === "error";

  const roomId = room?.id ?? null;
  const ended = room?.status === "ended";
  useEffect(() => {
    if (!roomId || !ended) return;
    let live = true;
    void fetchLikes(supabase, roomId).then((l) => { if (live) setLikes(l); });
    return () => { live = false; };
  }, [roomId, ended, uid]);
  const bumped = useRef(false);
  useEffect(() => {
    if (!roomId || !recorded || !ended || bumped.current) return;
    bumped.current = true;
    void bumpReplayView(supabase, roomId).then((v) => { if (v !== null) setViews(v); });
  }, [roomId, recorded, ended]);
  const startedAt = room?.recording_started_at ?? null;
  useEffect(() => {
    if (!recordingUrl || !startedAt) { setTimeline([]); return; }
    let live = true;
    void fetchTimeline(recordingUrl).then((t) => { if (live) setTimeline(t); });
    return () => { live = false; };
  }, [recordingUrl, startedAt]);
  const topicKey = room?.topic_key ?? null;
  useEffect(() => {
    if (!roomId) return;
    let live = true;
    void fetchMoreReplays(supabase, roomId, topicKey).then((m) => { if (live) setMore(m); });
    return () => { live = false; };
  }, [roomId, topicKey]);
  useEffect(() => {
    if (typeof id !== "string") return;
    void fetchClips(supabase, { limit: 24 }).then((rows) => setClips(rows.filter((c) => c.room_id === id)));
  }, [id, editor]);

  /* ── The transcript, following playback ── */
  const startedAtMs = startedAt ? Date.parse(startedAt) : NaN;
  const videoOffset = useCallback((sec: number) => videoTime(timeline, startedAtMs, sec), [timeline, startedAtMs]);
  const seekable = lines.some((l) => l.offset_seconds !== null);
  const currentId = useMemo(() => {
    if (!seekable || !recorded) return null;
    let found: string | null = null;
    for (const l of lines) {
      if (l.offset_seconds === null) continue;
      if (videoOffset(l.offset_seconds) <= currentTime + 0.5) found = l.id;
      else break;
    }
    return found;
  }, [lines, currentTime, seekable, recorded, videoOffset]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) => l.content.toLowerCase().includes(q) || nameOf(l).toLowerCase().includes(q) || l.username.toLowerCase().includes(q));
  }, [lines, query]);
  const boxRef = useRef<ScrollView>(null);
  const linePos = useRef(new Map<string, { y: number; h: number }>());
  const [boxH, setBoxH] = useState(0);
  useEffect(() => {
    if (!currentId || userScrolled || query) return;
    const pos = linePos.current.get(currentId);
    if (!pos || !boxH) return;
    boxRef.current?.scrollTo({ y: Math.max(0, pos.y - boxH / 2 + pos.h / 2), animated: true });
  }, [currentId, userScrolled, query, boxH]);
  const seekTo = (sec: number) => {
    player.currentTime = Math.max(0, videoOffset(sec) - 1);
    player.play();
    setUserScrolled(false);
  };

  const like = async () => {
    if (!roomId || likeBusy) return;
    if (!uid) { router.push("/sign-in"); return; }
    setLikeBusy(true);
    try { setLikes(await toggleLike(supabase, roomId)); }
    catch (e) { showToast(e instanceof Error ? e.message : "Couldn't like it."); }
    finally { setLikeBusy(false); }
  };
  const share = () => {
    if (!room) return;
    const url = roomLink(room);
    void Share.share(Platform.OS === "ios" ? { url } : { message: url }).catch(() => undefined);
  };
  const openDiscussion = async () => {
    if (!room) return;
    if (room.discussion_post_id) { router.push({ pathname: "/posts/[id]", params: { id: room.discussion_post_id } }); return; }
    if (!uid) { router.push("/sign-in"); return; }
    setDiscussBusy(true);
    try {
      const postId = await ensureDiscussion(supabase, room.id);
      setRoom((r) => (r ? { ...r, discussion_post_id: postId } : r));
      router.push({ pathname: "/posts/[id]", params: { id: postId } });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't open the discussion.");
    } finally {
      setDiscussBusy(false);
    }
  };

  const videoH = Math.round((width * 9) / 16);
  /* The solid title bar takes over once the video has scrolled away, as the community and profile pages do. */
  const BAR = insets.top + 44;
  const scrollY = useRef(new Animated.Value(0)).current;
  const barOpacity = scrollY.interpolate({ inputRange: [insets.top + videoH - BAR - 24, insets.top + videoH - BAR], outputRange: [0, 1], extrapolate: "clamp" });
  const host = room?.host ?? null;
  const topic = TOPICS.find((t) => t.key === room?.topic_key) ?? null;
  const startMs = room?.recording_started_at ?? room?.started_at ?? null;
  const endMs = room?.recording_ended_at ?? room?.ended_at ?? null;
  const durationLabel = startMs && endMs ? fmtDurationLong(new Date(endMs).getTime() - new Date(startMs).getTime()) : null;
  const when = room ? room.ended_at ?? room.started_at ?? room.created_at : null;
  const hasTranscript = lines.length > 0;
  /* The transcript waits behind its row, as on YouTube, unless there's no video — then it is the page. */
  const showTranscript = transcriptOpen ?? (!recorded && hasTranscript);
  const people = room ? (room.speakers.length ? room.speakers : host ? [{ ...host, role: "host" as const, side: null }] : []) : [];
  const count = room?.discussion_comment_count ?? 0;
  const boxMax = Math.min(Math.round(screenH * 0.5), 460);
  const label = (t: string) => <Text style={{ color: "#9a9aa6", fontFamily: fonts.semi, fontSize: 12, letterSpacing: 1.2 }}>{t.toUpperCase()}</Text>;
  const metaText = { color: "#9a9aa6", fontFamily: fonts.body, fontSize: 12.5 } as const;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
      >
        <View style={{ paddingTop: insets.top, backgroundColor: "#000" }}>
          {recorded ? (
            <View>
              {fullscreen ? (
                <View style={{ width, height: videoH, backgroundColor: "#000" }} />
              ) : (
                <VideoView ref={viewRef} player={player} style={{ width, height: videoH }} nativeControls={false} fullscreenOptions={{ enable: false }} allowsPictureInPicture contentFit="contain" />
              )}
              {!playerError && !fullscreen && (
                <ReplayControls player={player} viewRef={viewRef} currentTime={currentTime} onSeek={() => setUserScrolled(false)} onFullscreen={() => setFullscreen(true)} />
              )}
              {playerError && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: "#050507", alignItems: "center", justifyContent: "center", padding: 20 }]}>
                  <Text style={{ color: "#c9c9d4", fontFamily: fonts.body, fontSize: 13, textAlign: "center", lineHeight: 19 }}>This recording couldn't be loaded. It may still be finalizing — try again in a minute.</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={{ width, height: videoH, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 28, backgroundColor: "#111118" }}>
              {room === undefined ? (
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13 }}>Loading…</Text>
              ) : room === null ? (
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13 }}>This discussion isn't available.</Text>
              ) : (
                <>
                  {host && <Avatar url={host.avatar_url} name={host.username} size={56} />}
                  <Text style={{ color: "#e5e5ec", fontFamily: fonts.semi, fontSize: 16 }}>This discussion wasn't recorded</Text>
                  <Text style={{ color: "#8b8b94", fontFamily: fonts.body, fontSize: 13, lineHeight: 18, textAlign: "center" }}>
                    {hasTranscript ? "The host didn't stream it, but the stage transcript is here — and the discussion is open." : "The host didn't stream it, and no transcript was captured. The discussion is still open."}
                  </Text>
                </>
              )}
            </View>
          )}
        </View>

        {room && (
          <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 }}>{room.motion || "Discussion"}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 6, marginTop: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: recorded ? "#9a9aa6" : "#6b6b78" }} />
                <Text style={metaText}>{recorded ? "Past discussion" : "Ended · no recording"}</Text>
              </View>
              {topic && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: topic.color, backgroundColor: "#15151b" }}>
                  <Ionicons name={topic.icon} size={12} color={topic.color} />
                  <Text style={{ color: "#c9c9d4", fontFamily: fonts.body, fontSize: 12 }}>{topic.label}</Text>
                </View>
              )}
              {when && <Text style={metaText}>{new Date(when).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}</Text>}
              {durationLabel && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {recorded && <Ionicons name="videocam-outline" size={13} color="#9a9aa6" />}
                  <Text style={metaText}>{recorded ? `Recorded · ${durationLabel}` : `Lasted ${durationLabel}`}</Text>
                </View>
              )}
              {!!views && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="eye-outline" size={13} color="#9a9aa6" />
                  <Text style={metaText}>{fmtCount(views)} view{views === 1 ? "" : "s"}</Text>
                </View>
              )}
              {!!room.viewer_count && <Text style={metaText}>{room.viewer_count} watched live</Text>}
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              {likes && <Btn icon={likes.liked ? "thumbs-up" : "thumbs-up-outline"} label={likes.count > 0 ? String(likes.count) : "Like"} on={likes.liked} disabled={likeBusy} onPress={() => void like()} />}
              <Btn icon="share-outline" label="Share" onPress={share} />
              {recorded && <Btn icon="cut-outline" label="Clip this moment" onPress={() => { player.pause(); setEditor({ at: player.currentTime }); }} />}
            </View>

            {people.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                {people.map((p) => {
                  const side = p.side ? p.side.toLowerCase() : null;
                  const role = p.role === "host" ? "Host" : p.role === "cohost" ? "Co-host" : side ? side.toUpperCase() : "Speaker";
                  return (
                    <Pressable key={p.id} onPress={() => router.push({ pathname: "/u/[username]", params: { username: p.username } })} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, paddingLeft: 6, paddingRight: 12, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: "#2c2c34", backgroundColor: pressed ? "#1f1f26" : "#15151b" })}>
                      <Avatar url={p.avatar_url} name={p.username} size={22} />
                      <Text style={{ color: "#e5e5ec", fontFamily: fonts.body, fontSize: 13 }}>{nameOf(p)}</Text>
                      <Text style={{ color: side === "pro" ? "#4ade80" : side === "con" ? "#f87171" : "#8b8b94", fontFamily: fonts.semi, fontSize: 10, letterSpacing: 1 }}>{role.toUpperCase()}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <View style={{ marginTop: 18, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: "#2c2c34", backgroundColor: "#121217", overflow: "hidden" }}>
              <Pressable
                onPress={() => setTranscriptOpen(!showTranscript)}
                disabled={!hasTranscript}
                accessibilityRole="button"
                accessibilityState={{ expanded: showTranscript }}
                accessibilityLabel={showTranscript ? "Hide the transcript" : "Show the transcript"}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: showTranscript ? StyleSheet.hairlineWidth : 0, borderColor: "#2c2c34" }}
              >
                <View style={{ flex: 1 }}>{label(`Transcript${lines.length ? ` · ${lines.length}` : ""}`)}</View>
                {hasTranscript && <Ionicons name={showTranscript ? "chevron-up" : "chevron-down"} size={16} color="#9a9aa6" />}
              </Pressable>
              {showTranscript && hasTranscript && (
                <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, height: 34, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: "#2c2c34", backgroundColor: "#17171d" }}>
                    <Ionicons name="search" size={13} color="#9a9aa6" />
                    <TextInput value={query} onChangeText={setQuery} placeholder="Search the transcript" placeholderTextColor="#6b6b78" accessibilityLabel="Search the transcript" autoCorrect={false} autoCapitalize="none" returnKeyType="search" style={{ flex: 1, color: "#e5e5ec", fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0 }} />
                    {!!query && <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear the search"><Ionicons name="close-circle" size={14} color="#6b6b78" /></Pressable>}
                  </View>
                </View>
              )}
              {!hasTranscript ? (
                <Text style={{ color: "#8b8b94", fontFamily: fonts.body, fontSize: 13, lineHeight: 19, textAlign: "center", paddingVertical: 22, paddingHorizontal: 18, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#2c2c34" }}>No transcript for this discussion.{"\n"}Transcripts are captured when speakers have live listening on.</Text>
              ) : !showTranscript ? null : filtered.length === 0 ? (
                <Text style={{ color: "#8b8b94", fontFamily: fonts.body, fontSize: 13, textAlign: "center", paddingVertical: 22 }}>Nothing matches “{query.trim()}”.</Text>
              ) : (
                <ScrollView
                  ref={boxRef}
                  style={{ maxHeight: boxMax }}
                  nestedScrollEnabled
                  onLayout={(e) => setBoxH(e.nativeEvent.layout.height)}
                  onScrollBeginDrag={() => setUserScrolled(true)}
                  contentContainerStyle={{ paddingVertical: 4 }}
                >
                  {filtered.map((l) => {
                    const canSeek = recorded && l.offset_seconds !== null && !playerError;
                    const current = l.id === currentId;
                    return (
                      <Pressable
                        key={l.id}
                        onLayout={(e) => linePos.current.set(l.id, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}
                        onPress={canSeek ? () => seekTo(l.offset_seconds!) : undefined}
                        disabled={!canSeek}
                        accessibilityRole={canSeek ? "button" : undefined}
                        accessibilityHint={canSeek ? "Jumps to this moment" : undefined}
                        style={({ pressed }) => ({ flexDirection: "row", gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderLeftWidth: 2, borderLeftColor: current ? "#3b6cf6" : "transparent", backgroundColor: current ? "#141c33" : pressed ? "#18181f" : "transparent" })}
                      >
                        <Avatar url={l.avatar_url} name={l.username} size={24} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ color: "#c9c9d4", fontFamily: fonts.semi, fontSize: 12, marginBottom: 2 }}>{nameOf(l)}</Text>
                          <Marked text={l.content} query={query} style={{ color: "#e5e5ec", fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20 }} />
                        </View>
                        <Text style={{ color: "#6b6b78", fontFamily: fonts.body, fontSize: 11, paddingTop: 2, fontVariant: ["tabular-nums"] }}>
                          {l.offset_seconds !== null ? fmtClock(videoOffset(l.offset_seconds)) : l.created_at ? new Date(l.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            {clips.length > 0 && (
              <View style={{ marginTop: 24 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17, marginBottom: 10 }}>Clips from this discussion</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                  {clips.map((c) => <ClipTile key={c.id} clip={c} width={(width - 40 - 12) / 2} onPress={() => router.push({ pathname: "/clips/[id]", params: { id: c.id } })} />)}
                </View>
              </View>
            )}

            <View style={{ marginTop: 26 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17 }}>Discussion</Text>
                    {count > 0 && (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, backgroundColor: "#2a2a32" }}>
                        <Text style={{ color: "#e5e5ec", fontFamily: fonts.semi, fontSize: 12 }}>{count}</Text>
                      </View>
                    )}
                  </View>
                  {count === 0 && <Text style={{ color: "#8b8b94", fontFamily: fonts.body, fontSize: 12.5, marginTop: 3 }}>Nobody has weighed in yet — be the first.</Text>}
                </View>
                <Btn icon="megaphone-outline" label={discussBusy ? "Opening…" : "Open full thread"} disabled={discussBusy} onPress={() => void openDiscussion()} />
              </View>
              <Pressable onPress={() => (uid ? setComposing(true) : router.push("/sign-in"))} style={({ pressed }) => ({ marginTop: 12, height: 44, borderRadius: 22, backgroundColor: pressed ? "#1f1f26" : "#17171c", borderWidth: 1, borderColor: "#26262e", flexDirection: "row", alignItems: "center", paddingHorizontal: 16 })}>
                <Text style={{ flex: 1, color: colors.muted, fontFamily: fonts.body, fontSize: 14 }}>{uid ? "Add a comment…" : "Sign in to comment"}</Text>
                <Ionicons name="chatbubble-outline" size={16} color={colors.muted} />
              </Pressable>
              {comments.length > 0 && (
                <View style={{ gap: 14, marginTop: 16 }}>
                  {comments.map((c) => (
                    <View key={c.id}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                        <Pressable onPress={() => router.push({ pathname: "/u/[username]", params: { username: c.author_username } })} hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                          <Avatar url={avatars.get(c.author_id ?? "") ?? null} name={c.author_username} size={24} />
                          <Text style={{ color: "#c3c3ce", fontFamily: fonts.semi, fontSize: 12 }}>@{c.author_username}</Text>
                        </Pressable>
                        <Text style={{ color: "#71717e", fontFamily: fonts.body, fontSize: 11.5 }}>· {timeAgo(c.created_at)}</Text>
                      </View>
                      <View style={{ marginTop: 3 }}>
                        <RichText text={c.body} style={{ color: "#e6e6ee", fontFamily: fonts.body, fontSize: 13, lineHeight: 20 }} />
                      </View>
                      {c.image_url && <Image source={{ uri: c.image_url }} style={{ marginTop: 6, borderRadius: 8, width: "100%", height: 200 }} resizeMode="cover" />}
                    </View>
                  ))}
                </View>
              )}
            </View>

            {more.length > 0 && (
              <View style={{ marginTop: 28 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17 }}>More past discussions</Text>
                <Text style={{ color: "#8b8b94", fontFamily: fonts.body, fontSize: 12.5, marginTop: 2 }}>Recent ones to watch next</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
                  {more.map((m) => {
                    const w = (width - 40 - 14) / 2;
                    const img = m.thumbnail_url || m.host?.avatar_url || null;
                    const dur = roomDuration(m.started_at, m.ended_at);
                    return (
                      <Pressable key={m.id} onPress={() => router.push({ pathname: "/replay/[id]", params: { id: m.id } })} style={({ pressed }) => ({ width: w, opacity: pressed ? 0.85 : 1 })}>
                        <View style={{ width: w, height: Math.round((w * 9) / 16), borderRadius: 10, overflow: "hidden", backgroundColor: "#15151c", borderWidth: StyleSheet.hairlineWidth, borderColor: "#2c2c34", alignItems: "center", justifyContent: "center" }}>
                          {img ? <Image source={{ uri: img }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : <Ionicons name="play" size={18} color="#4a4a54" />}
                        </View>
                        <Text numberOfLines={2} style={{ color: "#e5e5ec", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, marginTop: 8 }}>{m.motion}</Text>
                        <Text numberOfLines={1} style={{ color: "#8b8b94", fontFamily: fonts.body, fontSize: 11, marginTop: 2 }}>
                          {m.host ? nameOf({ display_name: m.host.display_name, username: m.host.username }) : ""}
                          {m.ended_at ? ` · ${new Date(m.ended_at).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
                          {dur ? ` · ${dur}` : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        )}
      </Animated.ScrollView>
      <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: BAR, paddingTop: insets.top, backgroundColor: colors.bg, opacity: barOpacity, alignItems: "center", justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 17, paddingHorizontal: 60 }}>{room?.motion ?? ""}</Text>
      </Animated.View>
      {room && recorded && <ClipEditorSheet open={!!editor} player={player} duration={player.duration || 0} captureAt={editor?.at ?? 0} roomId={room.id} uid={uid} onClose={() => setEditor(null)} />}
      <ComposerSheet
        open={composing}
        kind="comment"
        context={room?.motion ?? null}
        userId={uid}
        onClose={() => setComposing(false)}
        onSubmit={async ({ body, imageUrl }) => {
          if (!uid || !room) return "Sign in to comment.";
          try {
            let postId = room.discussion_post_id;
            if (!postId) {
              postId = await ensureDiscussion(supabase, room.id);
              const made = postId;
              setRoom((r) => (r ? { ...r, discussion_post_id: made } : r));
            }
            await createComment(supabase, { postId, parentId: null, authorId: uid, body, imageUrl });
            setRoom((r) => (r ? { ...r, discussion_comment_count: r.discussion_comment_count + 1 } : r));
            await loadComments(postId);
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : "Couldn't post the comment — try again.";
          }
        }}
      />
      <Modal visible={fullscreen} animationType="fade" statusBarTranslucent supportedOrientations={["portrait", "landscape"]} onRequestClose={() => setFullscreen(false)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <VideoView ref={fsRef} player={player} style={{ flex: 1 }} nativeControls={false} fullscreenOptions={{ enable: false }} allowsPictureInPicture contentFit="contain" />
          <ReplayControls player={player} viewRef={fsRef} currentTime={currentTime} onSeek={() => setUserScrolled(false)} onFullscreen={() => setFullscreen(false)} fullscreen safeArea={insets} />
        </View>
      </Modal>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))} accessibilityLabel="Back" hitSlop={8} style={({ pressed }) => ({ position: "absolute", top: insets.top - 8, left: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: pressed ? colors.surface2 : colors.bg, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border })}>
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
    </View>
  );
}
