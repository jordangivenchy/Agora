/* The hero from the site's home (components/HeroCarousel.tsx): live
   rooms, the featured posts and the day's major stories, one slide each
   in the site's order, advancing on their own — nine seconds a slide,
   fifteen for a notice from the team, never with reduce motion — and
   wrapping round either way; the dots below go to a slide. A room shows
   how long it has been live, its speakers and audience, its topics,
   format and language, who holds each side and who hosts it; a story,
   its outlets, its summary, "Queue a discussion" and "Read at", and a
   tap anywhere else opens it on the News page; a notice, its opening
   and its list, or its picture. No slide leaves a blank band: a panel
   is as tall as its words and the picture takes the rest, and the hero
   grows to its fullest slide. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Img } from "./img";
import { router, useIsFocused } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { personName, type HeroRoom, type NewsStory } from "./home";
import { outletIcon, topicFor } from "./discover";
import { expandQueue, openQueue, useQueue } from "./queue";
import { useReduceMotion } from "./motion";
import { openUrl } from "./web";
import { colors, fonts } from "./theme";

/* The hero's least height; a slide with more to say makes it taller. */
export const HERO_HEIGHT = 264;
const MIN_PICTURE = 150; // the least a room's or a story's picture keeps
const SLIDE_MS = 9000;

/* The site's topic chips: labels and accents by the database's keys. */
const TOPIC_CHIP: Record<string, { label: string; accent: string }> = {
  "politics-law": { label: "Politics (Law)", accent: "#4a9eff" },
  ethics: { label: "Politics (Ethics)", accent: "#fd79a8" },
  "politics-ethics": { label: "Politics (Ethics)", accent: "#fd79a8" },
  sports: { label: "Sports", accent: "#fd9644" },
  culture: { label: "Culture", accent: "#e056b8" },
  economics: { label: "Economics", accent: "#00b894" },
  "science-tech": { label: "Science & Tech", accent: "#00cec9" },
  "foreign-policy": { label: "Foreign Policy", accent: "#1976D2" },
  philosophy: { label: "Philosophy", accent: "#fdcb6e" },
};

/* Solid grounds for a picture that is missing or failed. */
const GROUNDS = ["#0d1b3e", "#1a1000", "#0d2b1a", "#001a2e", "#2d0a1a", "#0d0a2e"];
type Slide =
  | { kind: "room"; key: string; room: HeroRoom; ground: string }
  | { kind: "news"; key: string; story: NewsStory; ground: string };

/* "now", "for 12m", "for 2h 5m" — after "Live". */
function liveFor(iso: string | null): string {
  const ms = iso ? Date.now() - Date.parse(iso) : 0;
  const m = Math.floor(ms / 60000);
  if (!(m >= 1)) return "now";
  if (m < 60) return `for ${m}m`;
  return `for ${Math.floor(m / 60)}h ${m % 60}m`;
}

export function HeroCarousel({ rooms, news, onSettled }: { rooms: HeroRoom[]; news: NewsStory[]; onSettled?: () => void }) {
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    const n = Math.max(rooms.length, news.length);
    for (let i = 0; i < n; i++) {
      if (rooms[i]) out.push({ kind: "room", key: `r:${rooms[i].id}`, room: rooms[i], ground: GROUNDS[(i * 2) % GROUNDS.length] });
      if (news[i]) out.push({ kind: "news", key: `n:${news[i].id}`, story: news[i], ground: GROUNDS[(i * 2 + 1) % GROUNDS.length] });
    }
    return out;
  }, [rooms, news]);
  const n = slides.length;
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  /* The strip loops: a copy of the last slide leads and a copy of the
     first trails, so a step past either end animates, then the list
     moves, unseen, to the real slide the copy stands for. */
  const cells = useMemo(() => {
    const real = slides.map((slide, index) => ({ slide, index, key: slide.key }));
    if (n < 2) return real;
    return [{ slide: slides[n - 1], index: n - 1, key: `lead:${slides[n - 1].key}` }, ...real, { slide: slides[0], index: 0, key: `trail:${slides[0].key}` }];
  }, [slides, n]);
  const at = useCallback((index: number) => (n > 1 ? index + 1 : index) * width, [n, width]);

  const [cur, setCur] = useState(0);
  const curRef = useRef(0);
  const touchedAt = useRef(0);
  const list = useRef<FlatList<(typeof cells)[number]>>(null);
  const [wait, setWait] = useState(0);
  const [tick, setTick] = useState(0);

  const show = useCallback((index: number) => {
    curRef.current = index;
    setCur(index);
  }, []);

  /* Where a scroll came to rest: a copy hands over to its real slide. */
  const settle = useCallback((x: number) => {
    if (n < 2) { show(0); return; }
    const pos = Math.round(x / width);
    if (pos <= 0) { list.current?.scrollToOffset({ offset: at(n - 1), animated: false }); show(n - 1); return; }
    if (pos >= n + 1) { list.current?.scrollToOffset({ offset: at(0), animated: false }); show(0); return; }
    show(pos - 1);
  }, [n, width, at, show]);

  /* A new set of slides: stay on the current one, unanimated. */
  useEffect(() => {
    const index = Math.min(curRef.current, Math.max(0, n - 1));
    show(index);
    list.current?.scrollToOffset({ offset: at(index), animated: false });
  }, [n, at, show]);

  /* Autoplay: each slide dwells its time; a recent touch buys another turn.
     Only while Home is in front: behind another screen it would still
     scroll and re-render. */
  const focused = useIsFocused();
  useEffect(() => {
    if (n < 2 || reduce || !focused) return;
    const dwell = SLIDE_MS;
    const t = setTimeout(() => {
      if (Date.now() - touchedAt.current < dwell) { setWait((w) => w + 1); return; }
      list.current?.scrollToOffset({ offset: at(curRef.current + 1), animated: true });
    }, dwell);
    return () => clearTimeout(t);
  }, [cur, n, reduce, at, wait, focused]);

  /* The rooms' "Live for …" keeps time. */
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  /* Every slide reports its natural height; the hero is the tallest. */
  const [heights, setHeights] = useState<Record<string, number>>({});
  const measure = useCallback((key: string, h: number) => {
    const v = Math.ceil(h);
    setHeights((prev) => (prev[key] === v ? prev : { ...prev, [key]: v }));
  }, []);
  const height = useMemo(() => Math.max(HERO_HEIGHT, ...slides.map((s) => heights[s.key] ?? 0)), [slides, heights]);
  /* Settled: every slide has been measured, so the hero is at its final height (the opening waits for this). */
  const pending = slides.some((s) => heights[s.key] === undefined);
  useEffect(() => {
    if (n && !pending) onSettled?.();
  }, [n, pending, onSettled]);

  const onEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => settle(e.nativeEvent.contentOffset.x), [settle]);

  if (!n) return null;
  return (
    <View>
      <FlatList
        ref={list}
        data={cells}
        keyExtractor={(c) => c.key}
        horizontal
        /* One slide a swipe however hard the flick: paging alone let a
           fast one skip a slide. */
        snapToInterval={width}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        bounces={false}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={n > 1 ? 1 : 0}
        extraData={`${height}:${tick}`}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScrollBeginDrag={() => { touchedAt.current = Date.now(); }}
        onMomentumScrollEnd={onEnd}
        renderItem={({ item }) => {
          const s = item.slide;
          const report = (h: number) => measure(s.key, h);
          return (
            <View style={{ width, height }}>
              {s.kind === "news" ? <NewsSlide story={s.story} ground={s.ground} onMeasure={report} />
                : <RoomSlide room={s.room} ground={s.ground} onMeasure={report} />}
            </View>
          );
        }}
      />
      {n > 1 && (
        <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, height: 22 }}>
          {slides.map((s, i) => (
            <Pressable
              key={s.key}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Go to slide ${i + 1}`}
              onPress={() => { touchedAt.current = Date.now(); list.current?.scrollToOffset({ offset: at(i), animated: true }); }}
            >
              <View style={{ width: i === cur ? 24 : 6, height: 6, borderRadius: 3, backgroundColor: i === cur ? colors.blue : "#3a3a45" }} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/* A picture that falls back to its ground if it is missing or fails. */
function Picture({ uri, ground, children }: { uri: string | null; ground: string; children?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: ground, overflow: "hidden" }}>
      {!!uri && !broken && <Img uri={uri} style={StyleSheet.absoluteFill} priority="high" onError={() => setBroken(true)} />}
      {children}
    </View>
  );
}

/* A solid black pill with the topic's colour as a dot (the site's chips). */
function Chip({ label, accent }: { label: string; accent?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 22, paddingLeft: accent ? 7 : 9, paddingRight: 9, borderRadius: 11, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.18)" }}>
      {!!accent && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />}
      <Text numberOfLines={1} style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

/* A story: its picture up top; under it the outlets reporting it, the
   headline, the summary, and "Queue a discussion" and "Read at". A tap
   off the buttons opens the story on the News page, lit, as a tap on
   the site's phone hero does. */
function NewsSlide({ story, ground, onMeasure }: { story: NewsStory; ground: string; onMeasure: (h: number) => void }) {
  /* By the article: the question you are waiting on was drawn from the
     story, and is not its headline. */
  const inQueue = useQueue().entries.some((e) => !!story.url && e.sourceUrl === story.url);
  const src = story.sources[0];
  const open = () => router.navigate({ pathname: "/news", params: { story: story.id } });
  const queue = () => {
    if (inQueue) expandQueue();
    else openQueue({
      id: null, question: story.headline, topicKey: topicFor(story.category), queueCount: 0, sourceUrl: story.url ?? null,
      story: { headline: story.headline, summary: story.summary ?? null, category: story.category ?? null },
    });
  };
  return (
    <Pressable onPress={open} style={{ flex: 1 }}>
      <Picture uri={story.imageUrl ?? null} ground={ground} />
      <View onLayout={(e) => onMeasure(e.nativeEvent.layout.height + MIN_PICTURE)} style={{ backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 }}>
        {story.sources.length > 0 && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, overflow: "hidden" }}>
            {story.sources.slice(0, 4).map((s) => (
              <View key={s.name} style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 }}>
                {s.domain ? (
                  <Img uri={outletIcon(s.domain)} style={{ width: 14, height: 14, borderRadius: 3 }} />
                ) : (
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 8 }}>{s.name.charAt(0)}</Text>
                  </View>
                )}
                <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.muted, fontFamily: fonts.medium, fontSize: 12 }}>{s.name}</Text>
              </View>
            ))}
          </View>
        )}
        <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 18, lineHeight: 23, marginTop: 6 }}>{story.headline}</Text>
        {!!story.summary && <Text numberOfLines={2} style={{ color: "#a9a9b4", fontFamily: fonts.body, fontSize: 13, lineHeight: 18.5, marginTop: 5 }}>{story.summary}</Text>}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
          <Pressable
            onPress={queue}
            style={({ pressed }) => ({ height: 34, paddingHorizontal: 14, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: inQueue ? "#1d4f8c" : pressed ? "#3d8bea" : "#2f7fe0" })}
          >
            <Text numberOfLines={1} style={{ color: "#fff", fontFamily: fonts.semi, fontSize: 13 }}>{inQueue ? "In queue — open the panel" : "Queue a discussion"}</Text>
          </Pressable>
          {!!story.url && (
            <Pressable
              onPress={() => openUrl(story.url!)}
              style={({ pressed }) => ({ flexShrink: 1, height: 34, paddingHorizontal: 14, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: pressed ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.18)" })}
            >
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: "#e5e5ec", fontFamily: fonts.medium, fontSize: 12.5 }}>Read at {src?.name ?? "the source"} ↗</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

/* A live room: its picture with the Live badge; under it how long it has
   been live and who is in, the motion, its topics, format and language,
   the speakers on each side and who hosts it, and the way in. */
function RoomSlide({ room, ground, onMeasure }: { room: HeroRoom; ground: string; onMeasure: (h: number) => void }) {
  const open = () => router.push({ pathname: "/room/[id]", params: { id: room.id } });
  const topic = TOPIC_CHIP[room.topicKey];
  const initial = personName(room.host).replace(/^@/, "").charAt(0).toUpperCase();
  const others = room.secondaryTopics.filter((k) => k !== room.topicKey && TOPIC_CHIP[k]).slice(0, 2);
  return (
    <Pressable onPress={open} style={{ flex: 1 }}>
      <Picture uri={room.imageUrl} ground={ground}>
        {!room.imageUrl && (
          <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 56 }}>{initial}</Text>
          </View>
        )}
        <View style={{ position: "absolute", top: 12, left: 14, flexDirection: "row", alignItems: "center", gap: 5, height: 22, paddingHorizontal: 9, borderRadius: 11, backgroundColor: "#e0484f" }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" }} />
          <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4 }}>Live</Text>
        </View>
      </Picture>
      <View onLayout={(e) => onMeasure(e.nativeEvent.layout.height + MIN_PICTURE)} style={{ backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live }} />
          <Text style={{ color: "#ff6b6b", fontFamily: fonts.extra, fontSize: 11, letterSpacing: 0.9 }}>{`LIVE ${liveFor(room.liveSince).toUpperCase()}`}</Text>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>
            · {room.speakerCount} speaker{room.speakerCount === 1 ? "" : "s"} · {room.audience} in the audience
          </Text>
        </View>
        <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 18, lineHeight: 23, marginTop: 5 }}>{`“${room.motion}”`}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, overflow: "hidden" }}>
          <Chip label={topic?.label ?? "Discussion"} accent={topic?.accent ?? "#4a9eff"} />
          <Chip label={room.format} />
          {!!room.language && <Chip label={room.language} />}
          {others.map((k) => <Chip key={k} label={TOPIC_CHIP[k].label} accent={TOPIC_CHIP[k].accent} />)}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 9, overflow: "hidden" }}>
          {room.speakers.map((sp, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 }}>
              <View style={sp.open
                ? { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.35)" }
                : { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: sp.color }}
              >
                <Text style={{ color: sp.open ? "rgba(255,255,255,0.75)" : "#fff", fontFamily: fonts.title, fontSize: 11 }}>{sp.name.replace(/^@/, "").charAt(0).toUpperCase()}</Text>
              </View>
              <Text numberOfLines={1} style={{ flexShrink: 1, color: sp.open ? colors.muted : "#eeeef5", fontFamily: sp.open ? fonts.medium : fonts.semi, fontSize: 12.5 }}>{sp.name}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 15, borderRadius: 17, backgroundColor: colors.yellow }}>
            <Ionicons name="play" size={11} color={colors.ink} />
            <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 13.5 }}>Watch live</Text>
          </View>
          <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>
            hosted by{" "}
            {room.community ? (
              <Text style={{ color: room.community.color ?? colors.blueText, fontFamily: fonts.bold }}>{room.community.name}</Text>
            ) : (
              <Text style={{ color: colors.soft, fontFamily: fonts.semi }}>{personName(room.host)}</Text>
            )}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
