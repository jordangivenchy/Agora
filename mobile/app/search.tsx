/* Search: the site's panel as a screen. The box up top; empty, the
   recent searches, a chip per field, and what is trending now; typing,
   the suggestions, then the tabs and the results — discussions and
   people across, posts and comments and communities down. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../src/supabase";
import { useSession } from "../src/session";
import { clearRecent, excerptAround, fetchTrendingNow, highlightSegments, readRecent, recordSearch, removeRecent, searchAll, searchSuggest, INSTANT_LIMIT, KIND_LABEL, SEARCH_PAGE, SEARCH_TABS, type CommunityPayload, type PersonPayload, type SearchKind, type SearchPost, type SearchRow, type SearchStatus, type Suggest } from "../src/search";
import { votePost } from "../src/communities";
import { setFollowing } from "../src/profile";
import { PostCard, CommunityTile } from "../src/postCard";
import { RoomSquare, type SquareRoom } from "../src/roomCard";
import { Avatar } from "../src/avatar";
import { TOPICS } from "../src/topics";
import { LoadingLine } from "../src/sky";
import { timeAgo } from "../src/communities";
import { colors, fonts } from "../src/theme";

const DEBOUNCE = 120;

function Highlight({ text, query, style }: { text: string; query: string; style?: object }) {
  const segs = useMemo(() => highlightSegments(text, query), [text, query]);
  return (
    <Text style={style}>
      {segs.map((s, i) => (s.hit ? <Text key={i} style={{ backgroundColor: "#4a3f14", color: "#fff" }}>{s.text}</Text> : <Text key={i}>{s.text}</Text>))}
    </Text>
  );
}

export default function Search() {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  /* A search link from a post (/search?q=…) arrives with its words. */
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [raw, setRaw] = useState(() => (typeof q === "string" ? q : ""));
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchKind>("all");
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<SearchStatus>("ok");
  const [recent, setRecent] = useState<string[]>([]);
  const [trending, setTrending] = useState<SquareRoom[] | null>(null);
  const [suggests, setSuggests] = useState<Suggest[]>([]);
  const [following, setFollowingMap] = useState<Record<string, boolean>>({});
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState<string | null>(null);
  const seq = useRef(0);
  const suggestSeq = useRef(0);
  const recorded = useRef("");
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    void readRecent(supabase, uid).then(setRecent);
    void fetchTrendingNow(supabase).then(setTrending);
  }, [uid]);

  useEffect(() => {
    const t = setTimeout(() => {
      const q = raw.trim();
      setQuery(q);
      if (!q) { setRows(null); setHasMore(false); setStatus("ok"); setSuggests([]); }
    }, DEBOUNCE);
    return () => clearTimeout(t);
  }, [raw]);

  useEffect(() => {
    const mySeq = ++suggestSeq.current;
    if (query.length < 2) { setSuggests([]); return; }
    void searchSuggest(supabase, query).then((list) => { if (suggestSeq.current === mySeq) setSuggests(list); });
  }, [query]);

  const run = useCallback(async (q: string, k: SearchKind, offset: number) => {
    const mySeq = ++seq.current;
    if (offset > 0) setLoadingMore(true); else setLoading(true);
    const limit = k !== "all" ? SEARCH_PAGE : INSTANT_LIMIT;
    const { rows: list, status: st } = await searchAll(supabase, q, k, limit, offset);
    if (mySeq !== seq.current) return;
    setLoading(false);
    setLoadingMore(false);
    setStatus(st);
    if (st !== "ok") { if (offset === 0) setRows([]); return; }
    const seed: Record<string, boolean> = {};
    for (const r of list) if (r.kind === "person") seed[r.id] = r.payload.is_following;
    if (Object.keys(seed).length) setFollowingMap((m) => ({ ...seed, ...m }));
    setRows((prev) => {
      if (offset === 0 || !prev) return list;
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...list.filter((r) => !seen.has(r.id))];
    });
    setHasMore(k !== "all" && list.length >= limit);
    if (offset === 0 && recorded.current !== q) {
      recorded.current = q;
      setRecent((prev) => { void recordSearch(supabase, uid, q, prev).then(setRecent); return prev; });
    }
  }, [uid]);

  useEffect(() => { if (query) void run(query, kind, 0); }, [query, kind, run]);

  const openSuggest = (s: Suggest) => {
    if (s.kind === "person") router.push({ pathname: "/u/[username]", params: { username: (s.sublabel ?? s.label).replace(/^@/, "") } });
    else if (s.kind === "community") router.push({ pathname: "/c/[id]", params: { id: s.id } });
    else router.push({ pathname: "/room/[id]", params: { id: s.id } });
  };

  const vote = async (post: SearchPost, value: number) => {
    if (!uid) { router.push("/sign-in"); return; }
    const delta = value - (post.my_vote ?? 0);
    const patch = (fn: (p: SearchPost) => SearchPost) => setRows((list) => list?.map((r) => (r.kind === "post" && r.id === post.id ? { ...r, payload: fn(r.payload) } : r)) ?? list);
    patch((p) => ({ ...p, score: p.score + delta, my_vote: value }));
    try { await votePost(supabase, post.id, value); } catch { patch((p) => ({ ...p, score: post.score, my_vote: post.my_vote })); }
  };

  const toggleJoin = async (c: CommunityPayload) => {
    if (!uid) { router.push("/sign-in"); return; }
    setJoinBusy(c.id);
    const { error } = c.joined
      ? await supabase.from("community_members").delete().eq("community_id", c.id).eq("user_id", uid)
      : await supabase.from("community_members").insert({ community_id: c.id, user_id: uid });
    setJoinBusy(null);
    if (error) return;
    setRows((list) => list?.map((r) => (r.kind === "community" && r.id === c.id ? { ...r, payload: { ...r.payload, joined: !c.joined, members: Math.max(0, c.members + (c.joined ? -1 : 1)) } } : r)) ?? list);
  };

  const toggleFollow = async (p: PersonPayload) => {
    if (!uid) { router.push("/sign-in"); return; }
    const cur = following[p.id] ?? p.is_following;
    setFollowBusy(p.id);
    setFollowingMap((m) => ({ ...m, [p.id]: !cur }));
    try { await setFollowing(supabase, p.id, !cur); } catch { setFollowingMap((m) => ({ ...m, [p.id]: cur })); }
    setFollowBusy(null);
  };

  const counts = useMemo(() => {
    const c: Partial<Record<SearchKind, number>> = {};
    for (const r of rows ?? []) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [rows]);

  const debates = (rows ?? []).filter((r): r is Extract<SearchRow, { kind: "debate" }> => r.kind === "debate");
  const people = (rows ?? []).filter((r): r is Extract<SearchRow, { kind: "person" }> => r.kind === "person");
  const others = (rows ?? []).filter((r) => r.kind !== "debate" && r.kind !== "person");
  const empty = !!query && rows !== null && rows.length === 0 && !loading && status === "ok";
  const label = (t: string) => <Text style={{ color: "rgba(255,255,255,0.45)", fontFamily: fonts.title, fontSize: 11, letterSpacing: 0.7, marginBottom: 8 }}>{t.toUpperCase()}</Text>;
  const card = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: 14 } as const;

  const renderOther = (r: SearchRow) => {
    if (r.kind === "post") {
      const p = r.payload;
      return (
        <PostCard
          key={r.id}
          post={p}
          showCommunity
          communityArt={{ name: p.community_name, color: p.community_color, avatarUrl: p.community_avatar_url }}
          onVote={(v) => void vote(p, v)}
          onOpen={() => router.push({ pathname: "/posts/[id]", params: { id: p.id } })}
          onOpenCommunity={() => router.push({ pathname: "/c/[id]", params: { id: p.community_id } })}
          onChanged={(patch) => setRows((list) => list?.map((x) => (x.kind === "post" && x.id === p.id ? { ...x, payload: { ...x.payload, ...patch } } : x)) ?? list)}
          onRemoved={() => setRows((list) => list?.filter((x) => !(x.kind === "post" && x.id === p.id)) ?? list)}
        />
      );
    }
    if (r.kind === "comment") {
      const c = r.payload;
      const excerpt = c.excerpt?.trim() || excerptAround(c.body, query);
      return (
        <Pressable key={r.id} onPress={() => router.push({ pathname: "/posts/[id]", params: { id: c.post_id } })} style={[card, { paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 }]}>
          <Text numberOfLines={2} style={{ color: "rgba(238,238,245,0.6)", fontFamily: fonts.body, fontSize: 11.5 }}>
            <Ionicons name="chatbubble-outline" size={11} color="rgba(238,238,245,0.6)" /> {c.author ? `@${c.author.username}` : "(deleted)"} commented on <Text style={{ color: "#eeeef5" }}>{c.post_title}</Text> · {c.community_name} · {timeAgo(c.created_at)}
          </Text>
          <Highlight text={excerpt} query={query} style={{ color: "rgba(238,238,245,0.72)", fontFamily: fonts.body, fontSize: 12.5, lineHeight: 19, marginTop: 4 }} />
        </Pressable>
      );
    }
    if (r.kind === "community") {
      const c = r.payload;
      return (
        <Pressable key={r.id} onPress={() => router.push({ pathname: "/c/[id]", params: { id: c.id } })} style={[card, { paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 }]}>
          <CommunityTile name={c.name} color={c.color} avatarUrl={c.avatar_url} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Highlight text={c.name} query={query} style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 13.5 }} />
              {c.is_private && <Ionicons name="lock-closed-outline" size={11} color={colors.muted} />}
            </View>
            <Text numberOfLines={1} style={{ color: "rgba(238,238,245,0.45)", fontFamily: fonts.body, fontSize: 11 }}>{c.members} {c.members === 1 ? "member" : "members"}{c.description ? ` · ${c.description.slice(0, 120)}` : ""}</Text>
          </View>
          {/* A private community takes an application, which its page asks for; joining it directly would be refused. */}
          <Pressable onPress={() => (c.is_private && !c.joined ? router.push({ pathname: "/c/[id]", params: { id: c.id } }) : void toggleJoin(c))} disabled={joinBusy === c.id} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: c.joined ? colors.surface2 : colors.blueText, borderWidth: c.joined ? 1 : 0, borderColor: colors.border, opacity: joinBusy === c.id ? 0.6 : 1 }}>
            <Text style={{ color: c.joined ? "rgba(238,238,245,0.8)" : "#fff", fontFamily: fonts.semi, fontSize: 11.5 }}>{c.joined ? "Joined" : c.is_private ? "Request" : "Join"}</Text>
          </Pressable>
        </Pressable>
      );
    }
    return null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "Search", headerBackTitle: "Back" }} />
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 42, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, gap: 8 }}>
          <Ionicons name="search-outline" size={17} color={colors.muted} />
          <TextInput ref={inputRef} value={raw} onChangeText={setRaw} placeholder="Search AgoraSphere" placeholderTextColor={colors.faint} autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={{ flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 15 }} />
          {!!raw && <Pressable onPress={() => { setRaw(""); inputRef.current?.focus(); }} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.faint} /></Pressable>}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {!query && (
          <>
            {recent.length > 0 ? (
              <View style={{ marginBottom: 20 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {label("Recent")}
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={() => { setRecent([]); void clearRecent(supabase, uid); }}><Text style={{ color: "rgba(238,238,245,0.45)", fontFamily: fonts.body, fontSize: 11, marginBottom: 8 }}>Clear all</Text></Pressable>
                </View>
                {recent.map((q) => (
                  <View key={q} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 }}>
                    <Ionicons name="time-outline" size={15} color={colors.muted} />
                    <Pressable onPress={() => setRaw(q)} style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: fonts.body, fontSize: 14 }}>{q}</Text></Pressable>
                    <Pressable onPress={() => void removeRecent(supabase, uid, q, recent).then(setRecent)} hitSlop={8}><Ionicons name="close" size={14} color={colors.faint} /></Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <View style={{ alignItems: "center", paddingVertical: 26 }}>
                <Ionicons name="search-outline" size={24} color={colors.faint} />
                <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15, marginTop: 10 }}>Search AgoraSphere</Text>
                <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5, marginTop: 4 }}>Discussions, posts, people, communities and comments.</Text>
              </View>
            )}
            <View style={{ marginBottom: 20 }}>
              {label("Browse a field")}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {TOPICS.map((t) => (
                  <Pressable key={t.key} onPress={() => setRaw(t.label)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                    <Ionicons name={t.icon} size={14} color={t.color} />
                    <Text style={{ color: "rgba(238,238,245,0.8)", fontFamily: fonts.medium, fontSize: 12.5 }}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {trending && trending.length > 0 && (
              <View>
                {label("Trending now")}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                  {trending.map((r) => <RoomSquare key={r.id} room={r} onPress={() => router.push({ pathname: "/room/[id]", params: { id: r.id } })} />)}
                </ScrollView>
              </View>
            )}
          </>
        )}
        {!!query && (
          <>
            {suggests.length > 0 && (
              <View style={{ marginBottom: 14 }}>
                {label("Suggestions")}
                {suggests.map((s) => (
                  <Pressable key={`${s.kind}-${s.id}`} onPress={() => openSuggest(s)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 6, borderRadius: 10, backgroundColor: pressed ? colors.surface2 : "transparent" })}>
                    {s.kind === "person" ? <Avatar url={s.avatar_url} name={s.label} size={30} /> : s.kind === "community" ? <CommunityTile name={s.label} avatarUrl={s.avatar_url} size={30} /> : (
                      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}><Ionicons name="play-outline" size={14} color={colors.text} /></View>
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 12.5 }}>{s.label}</Text>
                      <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 10.5 }}>
                        {s.kind === "debate" && s.sublabel === "Live now" ? <Text style={{ color: "#e05a5a", fontFamily: fonts.bold }}>LIVE</Text> : s.sublabel}{s.sublabel ? " · " : ""}{KIND_LABEL[s.kind]}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 14 }}>
              {SEARCH_TABS.map((t) => {
                const n = t.id === "all" ? undefined : counts[t.id];
                const on = kind === t.id;
                return (
                  <Pressable key={t.id} onPress={() => setKind(t.id)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, backgroundColor: on ? "#26262e" : colors.surface2, borderWidth: 1, borderColor: on ? "#4a4a54" : "#34343c" }}>
                    <Text style={{ color: on ? colors.text : "#c0c0c8", fontFamily: fonts.medium, fontSize: 12 }}>{t.label}{n !== undefined && n > 0 ? <Text style={{ opacity: 0.55 }}> {n}{hasMore && on ? "+" : ""}</Text> : null}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {status === "warming" && <View style={[card, { padding: 24, alignItems: "center", marginBottom: 14 }]}><Text style={{ color: "#eeeef5", fontFamily: fonts.title, fontSize: 15 }}>Search is warming up</Text><Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 12, marginTop: 4 }}>The search index isn't ready on this server yet. Try again in a moment.</Text></View>}
            {status === "error" && <Text style={{ color: "#f09595", fontFamily: fonts.body, fontSize: 12, marginBottom: 12 }}>Couldn't search right now — try again.</Text>}
            {loading && rows === null && <LoadingLine label="Searching" />}
            {empty && <View style={[card, { padding: 24, alignItems: "center", marginBottom: 14 }]}><Text style={{ color: "#eeeef5", fontFamily: fonts.title, fontSize: 15 }}>No results for “{query}”</Text><Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 12, marginTop: 4 }}>{kind === "all" ? "Try a different spelling or fewer words." : "Try another tab, or fewer words."}</Text></View>}
            {rows !== null && rows.length > 0 && (
              <>
                {debates.length > 0 && (
                  <View style={{ marginBottom: 20 }}>
                    {kind === "all" && <Text style={{ color: "rgba(238,238,245,0.7)", fontFamily: fonts.semi, fontSize: 12, marginBottom: 8 }}>Discussions</Text>}
                    <ScrollView horizontal={kind === "all"} showsHorizontalScrollIndicator={false} contentContainerStyle={kind === "all" ? { gap: 12 } : { flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                      {debates.map((r) => {
                        const d = r.payload;
                        const ended = d.status === "ended";
                        return (
                          <View key={r.id}>
                            <RoomSquare room={d} onPress={() => router.push(ended ? { pathname: "/replay/[id]", params: { id: d.id } } : { pathname: "/room/[id]", params: { id: d.id } })} />
                            <Text numberOfLines={1} style={{ color: "rgba(238,238,245,0.38)", fontFamily: fonts.body, fontSize: 10, marginTop: 4, maxWidth: 168 }}>{ended ? `Ended ${d.ended_at ? timeAgo(d.ended_at) + " ago" : ""}` : d.status === "live" ? "Live now" : d.scheduled_start ? "Scheduled" : "Open"}</Text>
                          </View>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
                {people.length > 0 && (
                  <View style={{ marginBottom: 20 }}>
                    {kind === "all" && <Text style={{ color: "rgba(238,238,245,0.7)", fontFamily: fonts.semi, fontSize: 12, marginBottom: 8 }}>People</Text>}
                    {people.map((r) => {
                      const p = r.payload;
                      const on = following[r.id] ?? p.is_following;
                      return (
                        <Pressable key={r.id} onPress={() => router.push({ pathname: "/u/[username]", params: { username: p.username } })} style={[card, { paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 }]}>
                          <Avatar url={p.avatar_url} name={p.display_name || p.username} size={40} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 13.5 }}>{p.display_name?.trim() || `@${p.username}`}</Text>
                              {p.verified && <Ionicons name="checkmark-circle" size={14} color={colors.yellow} />}
                            </View>
                            <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 11.5 }}>@{p.username} · {p.bio?.trim() || `${p.followers} ${p.followers === 1 ? "follower" : "followers"}`}</Text>
                          </View>
                          {uid !== p.id && (
                            <Pressable onPress={() => void toggleFollow(p)} disabled={followBusy === p.id} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: on ? colors.surface2 : colors.blue, borderWidth: on ? 1 : 0, borderColor: colors.border }}>
                              <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 11.5 }}>{on ? "Following" : "Follow"}</Text>
                            </Pressable>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {others.length > 0 && kind === "all" && <Text style={{ color: "rgba(238,238,245,0.7)", fontFamily: fonts.semi, fontSize: 12, marginBottom: 8 }}>Posts & comments</Text>}
                {others.map(renderOther)}
                {hasMore && (
                  <Pressable onPress={() => void run(query, kind, rows.length)} disabled={loadingMore} style={{ height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, opacity: loadingMore ? 0.6 : 1 }}>
                    <Text style={{ color: "rgba(238,238,245,0.8)", fontFamily: fonts.medium, fontSize: 12.5 }}>{loadingMore ? "Loading…" : "Load more"}</Text>
                  </Pressable>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
