/* The hero from the site's home: live rooms, the featured posts and the
   day's stories, one slide each, in the site's order, advancing on their
   own with the dots below. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, Pressable, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { router } from "expo-router";
import { dateLabel, personName, type FeaturedPost, type HeroRoom, type NewsStory } from "./home";
import { openUrl } from "./web";
import { colors, fonts } from "./theme";

export const HERO_HEIGHT = 300;
const PANEL = 136;
const AUTO_MS = 7000;

type Slide =
  | { kind: "room"; key: string; room: HeroRoom }
  | { kind: "post"; key: string; post: FeaturedPost }
  | { kind: "news"; key: string; story: NewsStory };

export function HeroCarousel({ rooms, posts, news }: { rooms: HeroRoom[]; posts: FeaturedPost[]; news: NewsStory[] }) {
  const { width } = useWindowDimensions();
  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    const n = Math.max(rooms.length, posts.length, news.length);
    for (let i = 0; i < n; i++) {
      if (rooms[i]) out.push({ kind: "room", key: `r:${rooms[i].id}`, room: rooms[i] });
      if (posts[i]) out.push({ kind: "post", key: `p:${posts[i].id}`, post: posts[i] });
      if (news[i]) out.push({ kind: "news", key: `n:${news[i].id}`, story: news[i] });
    }
    return out;
  }, [rooms, posts, news]);
  const n = slides.length;
  const [cur, setCur] = useState(0);
  const curRef = useRef(0);
  const touchedAt = useRef(0);
  const list = useRef<FlatList<Slide>>(null);

  /* Auto-advance, except right after a swipe; the wrap to the first
     slide jumps rather than rewinding through every slide. */
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => {
      if (Date.now() - touchedAt.current < AUTO_MS) return;
      const next = (curRef.current + 1) % n;
      list.current?.scrollToIndex({ index: next, animated: next !== 0 });
      curRef.current = next;
      setCur(next);
    }, AUTO_MS);
    return () => clearInterval(t);
  }, [n]);
  useEffect(() => {
    if (curRef.current >= n) {
      curRef.current = 0;
      setCur(0);
      list.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [n]);

  const onEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(e.nativeEvent.contentOffset.x / width)));
    curRef.current = i;
    setCur(i);
  }, [width, n]);

  if (!n) return null;
  return (
    <View>
      <FlatList
        ref={list}
        data={slides}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScrollBeginDrag={() => { touchedAt.current = Date.now(); }}
        onMomentumScrollEnd={onEnd}
        renderItem={({ item }) => (
          <View style={{ width, height: HERO_HEIGHT }}>
            {item.kind === "post" ? <PostSlide post={item.post} /> : item.kind === "news" ? <NewsSlide story={item.story} /> : <RoomSlide room={item.room} />}
          </View>
        )}
      />
      {n > 1 && (
        <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, height: 30 }}>
          {slides.map((s, i) => (
            <View key={s.key} style={{ width: i === cur ? 24 : 6, height: 6, borderRadius: 3, backgroundColor: i === cur ? colors.blue : "#3a3a45" }} />
          ))}
        </View>
      )}
    </View>
  );
}

/* "From the team": a post a moderator featured on the home page. */
function PostSlide({ post }: { post: FeaturedPost }) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 22 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: colors.yellow, fontFamily: fonts.title, fontSize: 13 }}>From the team</Text>
        <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5 }}>·  {dateLabel(post.createdAt)}</Text>
      </View>
      <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 24, lineHeight: 28, letterSpacing: -0.3, marginTop: 8 }}>{post.title}</Text>
      <View style={{ width: 40, height: 3, borderRadius: 2, backgroundColor: colors.yellow, marginTop: 10 }} />
      <Text numberOfLines={2} style={{ color: colors.soft, fontFamily: fonts.body, fontSize: 15, lineHeight: 21, marginTop: 12 }}>{post.excerpt}</Text>
      {!!post.tags && <Text numberOfLines={1} style={{ color: "#a7a7b3", fontFamily: fonts.medium, fontSize: 13.5, marginTop: 8 }}>{post.tags}</Text>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14 }}>
        <Pressable
          onPress={() => router.push({ pathname: "/posts/[id]", params: { id: post.id } })}
          style={({ pressed }) => ({ height: 40, paddingHorizontal: 20, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? "#ffc22e" : colors.yellow })}
        >
          <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 14.5 }}>Read more</Text>
        </Pressable>
        <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13.5 }} numberOfLines={1}>
          <Text style={{ fontFamily: fonts.bold, color: colors.soft }}>{post.comments}</Text> comments
          {post.community ? <Text> · <Text style={{ fontFamily: fonts.bold, color: colors.soft }}>{post.community.name}</Text></Text> : null}
        </Text>
      </View>
    </View>
  );
}

/* A story: its picture up top, the headline and outlet on a solid panel. */
function NewsSlide({ story }: { story: NewsStory }) {
  const src = story.sources[0];
  return (
    <Pressable onPress={() => story.url && openUrl(story.url)} style={{ flex: 1 }}>
      {story.imageUrl ? (
        <Image source={{ uri: story.imageUrl }} style={{ position: "absolute", left: 0, right: 0, top: 0, height: HERO_HEIGHT - PANEL }} resizeMode="cover" />
      ) : (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: HERO_HEIGHT - PANEL, backgroundColor: "#0d1b3e" }} />
      )}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: PANEL, backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 14 }}>
        {src && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: 9 }}>{src.name.charAt(0)}</Text>
            </View>
            <Text style={{ color: colors.muted, fontFamily: fonts.medium, fontSize: 12.5 }}>{src.name}</Text>
          </View>
        )}
        <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 18, lineHeight: 23, marginTop: 6 }}>{story.headline}</Text>
        {story.url && <Text style={{ color: colors.yellow, fontFamily: fonts.bold, fontSize: 12.5, marginTop: 6 }}>Read at {src?.name ?? "the source"} ↗</Text>}
      </View>
    </Pressable>
  );
}

/* A live room: its picture, who's on, and the way in. */
function RoomSlide({ room }: { room: HeroRoom }) {
  const initial = personName(room.host).replace(/^@/, "").charAt(0).toUpperCase();
  return (
    <Pressable onPress={() => router.push({ pathname: "/room/[id]", params: { id: room.id } })} style={{ flex: 1 }}>
      {room.imageUrl ? (
        <Image source={{ uri: room.imageUrl }} style={{ position: "absolute", left: 0, right: 0, top: 0, height: HERO_HEIGHT - PANEL }} resizeMode="cover" />
      ) : (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: HERO_HEIGHT - PANEL, backgroundColor: "#0d2b1a", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 72 }}>{initial}</Text>
        </View>
      )}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: PANEL, backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live }} />
          <Text style={{ color: colors.live, fontFamily: fonts.extra, fontSize: 11, letterSpacing: 0.6 }}>LIVE</Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>{room.viewers} watching · hosted by {personName(room.host)}</Text>
        </View>
        <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 19, lineHeight: 24, marginTop: 6 }}>{room.motion}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 }}>
          <View style={{ height: 36, paddingHorizontal: 18, borderRadius: 18, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 14 }}>Watch live</Text>
          </View>
          <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>{room.speakers} speaking · {room.audience} listening</Text>
        </View>
      </View>
    </Pressable>
  );
}
