/* A thread, as the site shows it on a phone: the post whole, then the
   comments — the avatar row, the text beneath, the actions to the right,
   replies hanging off a rail — and the dock to take the floor. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { useMe } from "../../src/me";
import { buildTree, createComment, fetchAvatars, fetchComments, fetchPost, timeAgo, voteComment, votePost, type CommentRow, type CommentSort, type PostRow } from "../../src/communities";
import { Badge, META, PostCard, RoleBadge, SortChips } from "../../src/postCard";
import { RichText, plainPreview } from "../../src/richText";
import { ComposerSheet } from "../../src/composer";
import { Avatar } from "../../src/avatar";
import { openImage } from "../../src/lightbox";
import { colors, fonts } from "../../src/theme";
import { Note } from "../../src/ui";

const SORTS: { key: CommentSort; label: string }[] = [{ key: "top", label: "Top" }, { key: "new", label: "New" }];
type Art = { name: string; color: string | null; avatar_url: string | null };

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const me = useMe();
  const insets = useSafeAreaInsets();
  const [post, setPost] = useState<PostRow | null>(null);
  const [art, setArt] = useState<Art | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [avatars, setAvatars] = useState<Map<string, string | null>>(new Map());
  const [sort, setSort] = useState<CommentSort>("top");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [reply, setReply] = useState<{ open: boolean; parent: CommentRow | null }>({ open: false, parent: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, cs] = await Promise.all([fetchPost(supabase, id), fetchComments(supabase, id)]);
      setPost(p);
      setComments(cs);
      setAvatars(await fetchAvatars(supabase, cs.map((c) => c.author_id)));
      if (p) {
        const { data } = await supabase.from("communities").select("name, color, avatar_url").eq("id", p.community_id).maybeSingle();
        if (data) setArt(data as Art);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this thread.");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const tree = useMemo(() => buildTree(comments, sort), [comments, sort]);

  const votePostHere = (v: number) => {
    if (!post) return;
    if (!uid) return router.push("/sign-in");
    const before = post;
    setPost({ ...post, score: post.score + (v - post.my_vote), my_vote: v });
    votePost(supabase, post.id, v).catch(() => setPost(before));
  };
  const voteHere = (c: CommentRow, v: number) => {
    if (!uid) return router.push("/sign-in");
    setComments((cs) => cs.map((x) => (x.id === c.id ? { ...x, score: x.score + (v - x.my_vote), my_vote: v } : x)));
    voteComment(supabase, c.id, v).catch(() => setComments((cs) => cs.map((x) => (x.id === c.id ? { ...x, score: c.score, my_vote: c.my_vote } : x))));
  };
  const toggle = (cid: string) => setCollapsed((prev) => { const n = new Set(prev); if (n.has(cid)) n.delete(cid); else n.add(cid); return n; });
  const openReply = (parent: CommentRow | null) => (uid ? setReply({ open: true, parent }) : router.push("/sign-in"));

  const renderNode = (c: CommentRow, depth: number): ReactNode => {
    const kids = tree.children.get(c.id) ?? [];
    const isCollapsed = collapsed.has(c.id);
    const hidden = tree.subtreeSize(c.id);
    const isAuthor = !!post && !!c.author_id && c.author_id === post.author_id;
    return (
      <View key={c.id}>
        <Pressable onPress={() => toggle(c.id)} style={{ borderRadius: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7, minHeight: 24, opacity: isCollapsed ? 0.72 : 1 }}>
            <Pressable onPress={() => router.push({ pathname: "/u/[username]", params: { username: c.author_username } })} hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Avatar url={avatars.get(c.author_id ?? "") ?? null} name={c.author_username} size={24} />
              <Text style={{ color: "#c3c3ce", fontFamily: fonts.semi, fontSize: 12 }}>@{c.author_username}</Text>
            </Pressable>
            {isAuthor && <Text style={{ color: colors.yellow, fontFamily: fonts.bold, fontSize: 10.5 }}>author</Text>}
            <Text style={{ color: "#71717e", fontFamily: fonts.body, fontSize: 11.5 }}>· {timeAgo(c.created_at)}</Text>
            <RoleBadge role={c.author_role} />
            {c.pinned_at && <Badge label="PINNED" color={colors.blueText} icon="pin-outline" />}
            {isCollapsed && hidden > 0 && <Text style={{ color: "#71717e", fontFamily: fonts.semi, fontSize: 11.5 }}>· {hidden} repl{hidden === 1 ? "y" : "ies"}</Text>}
          </View>
          {!isCollapsed && (
            <>
              <View style={{ marginTop: 3 }}>
                <RichText text={c.body} style={{ color: "#e6e6ee", fontFamily: fonts.body, fontSize: 13, lineHeight: 20 }} />
              </View>
              {c.image_url && <Pressable onPress={() => openImage(c.image_url!)}><Image source={{ uri: c.image_url }} style={{ marginTop: 6, borderRadius: 8, width: "100%", height: 200 }} resizeMode="cover" /></Pressable>}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
                  <Pressable onPress={() => voteHere(c, c.my_vote === 1 ? 0 : 1)} hitSlop={6} style={{ paddingVertical: 6 }}>
                    <Ionicons name="chevron-up" size={16} color={c.my_vote === 1 ? colors.gold : "#85858f"} />
                  </Pressable>
                  <Text style={{ color: "#c3c3ce", fontFamily: fonts.semi, fontSize: 11.5, minWidth: 16, textAlign: "center" }}>{c.score}</Text>
                  <Pressable onPress={() => voteHere(c, c.my_vote === -1 ? 0 : -1)} hitSlop={6} style={{ paddingVertical: 6 }}>
                    <Ionicons name="chevron-down" size={16} color={c.my_vote === -1 ? "#64B5F6" : "#85858f"} />
                  </Pressable>
                </View>
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => openReply(c)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6 }}>
                  <Ionicons name="arrow-undo-outline" size={13} color="#85858f" />
                  <Text style={{ color: "#85858f", fontFamily: fonts.semi, fontSize: 11.5 }}>Reply</Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
        {!isCollapsed && kids.length > 0 && (
          <View style={depth < 2 ? { marginLeft: 12, paddingLeft: 14, marginTop: 10, gap: 10, borderLeftWidth: 1.5, borderColor: "#2b2b34" } : { marginTop: 10, gap: 10 }}>
            {kids.map((k) => renderNode(k, depth + 1))}
          </View>
        )}
      </View>
    );
  };

  const n = comments.length;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: post?.community_name ?? "Thread" }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom }}>
        {post && (
          <PostCard
            post={post}
            full
            showCommunity
            communityArt={{ name: post.community_name, color: art?.color, avatarUrl: art?.avatar_url ?? null }}
            onVote={votePostHere}
            onOpenCommunity={() => router.push({ pathname: "/c/[id]", params: { id: post.community_id } })}
          />
        )}
        {error && <Note tone="error">{error}</Note>}
        {n > 0 && (
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ color: META, fontFamily: fonts.semi, fontSize: 12 }}>{n} comment{n === 1 ? "" : "s"}</Text>
            <View style={{ flex: 1 }} />
            <SortChips quiet value={sort} options={SORTS} onChange={setSort} />
          </View>
        )}
        {!loading && n === 0 && (
          <Text style={{ color: "rgba(238,238,245,0.32)", fontFamily: fonts.body, fontSize: 12, textAlign: "center", paddingVertical: 24 }}>No comments yet — start the discussion.</Text>
        )}
        <View style={{ gap: 14 }}>{tree.roots.map((r) => renderNode(r, 0))}</View>
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 + insets.bottom, backgroundColor: "#0a0a0d", borderTopWidth: 1, borderColor: "#1b1b21" }}>
        <Pressable onPress={() => openReply(null)} style={({ pressed }) => ({ height: 44, borderRadius: 22, backgroundColor: pressed ? "#1f1f26" : "#17171c", borderWidth: 1, borderColor: "#26262e", flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 9, paddingRight: 16 })}>
          <Avatar url={me?.avatar_url} name={me?.display_name || me?.username || "?"} size={26} />
          <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 14 }}>{uid ? "Take the floor" : "Sign in to comment"}</Text>
        </Pressable>
      </View>
      <ComposerSheet
        open={reply.open}
        kind="comment"
        context={reply.parent ? plainPreview(reply.parent.body) : post ? plainPreview(post.title) : null}
        contextName={reply.parent ? `@${reply.parent.author_username}` : null}
        onClose={() => setReply({ open: false, parent: null })}
        userId={uid}
        onSubmit={async ({ body, imageUrl }) => {
          if (!uid) return "Sign in to comment.";
          try {
            await createComment(supabase, { postId: id, parentId: reply.parent?.id ?? null, authorId: uid, body, imageUrl });
            await load();
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : "Couldn't comment.";
          }
        }}
      />
    </View>
  );
}
