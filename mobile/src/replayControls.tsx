/* The replay's own controls over the inline video — the site's player
   (components/agora/ReplayPlayer) on a phone. Tap the picture for them:
   10 s back, play/pause and 10 s forward in the middle; the seek bar with
   elapsed and total along the bottom, then speed (remembered, like the
   site's), AirPlay, picture in picture and full screen, which hands over
   to the system player. While playing they fade after a few seconds. */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Animated, Platform, Pressable, Text, View, type GestureResponderEvent } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useEvent } from "expo";
import { VideoAirPlayButton, type VideoPlayer, type VideoView } from "expo-video";
import { colors, fonts } from "./theme";

/* A tap on speed steps through these, from normal up and round again. */
const RATES = [1, 1.25, 1.5, 1.75, 2, 0.5, 0.75];
const RATE_KEY = "agora:replay-rate";
const HIDE_AFTER_MS = 3000;

function clock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function ReplayControls({ player, viewRef, currentTime, onSeek, onFullscreen, fullscreen }: {
  player: VideoPlayer;
  viewRef: RefObject<VideoView | null>;
  /** Seconds, from the screen's own timeUpdate listener. */
  currentTime: number;
  /** A seek from these controls (the transcript follows again). */
  onSeek?: () => void;
  /** Full screen: the screen shows the same player and these controls
      over a black screen of its own. */
  onFullscreen: () => void;
  /** These are the full-screen ones: the button comes back out of it. */
  fullscreen?: boolean;
}) {
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const duration = status === "readyToPlay" || player.duration > 0 ? player.duration : 0;

  /* Showing and fading. */
  const [shown, setShown] = useState(true);
  const fade = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((keep = false) => {
    setShown(true);
    Animated.timing(fade, { toValue: 1, duration: 140, useNativeDriver: true }).start();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!keep) {
      hideTimer.current = setTimeout(() => {
        if (!player.playing) return;
        Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: true }).start(({ finished }) => { if (finished) setShown(false); });
      }, HIDE_AFTER_MS);
    }
  }, [fade, player]);
  useEffect(() => { show(!isPlaying); }, [isPlaying, show]);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  /* Speed, remembered on this phone. */
  const [rate, setRate] = useState(1);
  useEffect(() => {
    AsyncStorage.getItem(RATE_KEY).then((v) => {
      const r = Number(v);
      if (RATES.includes(r)) { player.playbackRate = r; setRate(r); }
    }, () => undefined);
  }, [player]);
  const nextRate = () => {
    const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    /* On iOS a rate is also "play": a paused replay stays paused. */
    const wasPlaying = player.playing;
    player.playbackRate = r;
    if (!wasPlaying) player.pause();
    setRate(r);
    void AsyncStorage.setItem(RATE_KEY, String(r)).catch(() => undefined);
    show();
  };

  /* Seeking: tap or drag along the bar; the time shows where you are. */
  const [barW, setBarW] = useState(1);
  const [scrub, setScrub] = useState<number | null>(null);
  const at = (e: GestureResponderEvent) => Math.max(0, Math.min(1, e.nativeEvent.locationX / barW)) * duration;
  const shownTime = scrub ?? currentTime;
  const pct = duration > 0 ? Math.min(1, shownTime / duration) : 0;

  const skip = (by: number) => { player.seekBy(by); onSeek?.(); show(); };
  const toggle = () => { if (player.playing) player.pause(); else player.play(); show(); };
  const round = (size: number) => ({ width: size, height: size, borderRadius: size / 2, alignItems: "center" as const, justifyContent: "center" as const });

  return (
    <Pressable onPress={() => (shown ? (player.playing ? setShown(false) : show(true)) : show())} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} accessibilityLabel={shown ? "Hide the controls" : "Show the controls"}>
      {shown && (
        <Animated.View pointerEvents="box-none" style={{ flex: 1, opacity: fade, backgroundColor: "rgba(0,0,0,0.38)", justifyContent: "space-between" }}>
          <View />
          <View pointerEvents="box-none" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 34 }}>
            <Pressable onPress={() => skip(-10)} hitSlop={10} accessibilityLabel="Back 10 seconds" style={round(44)}>
              <Ionicons name="play-back" size={24} color="#fff" />
              <Text style={{ position: "absolute", bottom: -4, color: "#fff", fontFamily: fonts.semi, fontSize: 9 }}>10</Text>
            </Pressable>
            <Pressable onPress={toggle} accessibilityLabel={isPlaying ? "Pause" : "Play"} style={[round(58), { backgroundColor: "#0e0e11", borderWidth: 1, borderColor: "#2a2a33" }]}>
              <Ionicons name={isPlaying ? "pause" : "play"} size={26} color="#fff" style={{ marginLeft: isPlaying ? 0 : 3 }} />
            </Pressable>
            <Pressable onPress={() => skip(10)} hitSlop={10} accessibilityLabel="Forward 10 seconds" style={round(44)}>
              <Ionicons name="play-forward" size={24} color="#fff" />
              <Text style={{ position: "absolute", bottom: -4, color: "#fff", fontFamily: fonts.semi, fontSize: 9 }}>10</Text>
            </Pressable>
          </View>
          <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
            <View
              onLayout={(e) => setBarW(Math.max(1, e.nativeEvent.layout.width))}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(e) => { if (hideTimer.current) clearTimeout(hideTimer.current); setScrub(at(e)); }}
              onResponderMove={(e) => setScrub(at(e))}
              onResponderRelease={(e) => { player.currentTime = at(e); setScrub(null); onSeek?.(); show(); }}
              onResponderTerminate={() => setScrub(null)}
              accessibilityRole="adjustable"
              accessibilityLabel="Seek"
              accessibilityValue={{ min: 0, max: Math.floor(duration), now: Math.floor(shownTime) }}
              style={{ height: 22, justifyContent: "center" }}
            >
              <View style={{ height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.28)" }}>
                <View style={{ width: `${pct * 100}%`, height: 3, borderRadius: 2, backgroundColor: colors.yellow }} />
              </View>
              <View style={{ position: "absolute", left: pct * barW - 6, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.yellow }} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 11.5, fontVariant: ["tabular-nums"] }}>
                {clock(shownTime)} <Text style={{ color: "#b9b9c4" }}>/ {clock(duration)}</Text>
              </Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={nextRate} hitSlop={6} accessibilityLabel={`Playback speed, ${rate} times. Tap for the next speed`} style={{ minWidth: 40, height: 32, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: rate === 1 ? "#fff" : colors.yellow, fontFamily: fonts.bold, fontSize: 12.5, fontVariant: ["tabular-nums"] }}>{rate}×</Text>
              </Pressable>
              {Platform.OS === "ios" && (
                <View style={round(32)}>
                  <VideoAirPlayButton tint="#ffffff" activeTint={colors.yellow} style={{ width: 26, height: 26 }} />
                </View>
              )}
              <Pressable onPress={() => { void viewRef.current?.startPictureInPicture().catch(() => undefined); }} hitSlop={6} accessibilityLabel="Picture in picture" style={round(32)}>
                <Ionicons name="albums-outline" size={18} color="#fff" />
              </Pressable>
              <Pressable onPress={onFullscreen} hitSlop={6} accessibilityLabel={fullscreen ? "Leave full screen" : "Full screen"} style={round(32)}>
                <Ionicons name={fullscreen ? "contract" : "expand"} size={19} color="#fff" />
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}
