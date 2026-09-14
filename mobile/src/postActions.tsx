/* The menus on a post and on a comment, as the site's threads have them
   (components/CommunitiesPage.tsx: sheetItems, postActions, the repost
   dialog, the edit box). A post: copy link, repost, copy text; edit for
   its author; feature on home for site moderators; pin and remove for
   the community's moderators; delete for its author. A comment: reply,
   copy text, copy link, hide; pin on a root comment for moderators;
   delete for its author, remove for moderators. The same writes the site
   makes: repost_post, edit_post, set_post_featured, set_post_pinned,
   set_comment_pinned, and deletes on community_posts and
   community_comments, whose policies let authors and moderators through.
   Mounted once at the root; cards and threads open it through postMenu. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { useSession } from "./session";
import { useMe } from "./me";
import { SITE } from "./api";
import { showToast } from "./toast";
import { copyToClipboard } from "./clipboard";
import { ItemSheet, type SheetItem } from "./itemSheet";
import { ComposerSheet, POST_BODY_MAX } from "./composer";
import { plainPreview } from "./richText";
import { cleanTextError, BODY_MIN } from "./cleanText";
import { registerPostMenus, postUrl, type CommentHandlers, type MenuPost, type PostHandlers } from "./postMenu";
import type { CommentRow } from "./communities";
import { colors, fonts } from "./theme";

interface Joined { id: string; name: string; color: string | null; avatar_url: string | null; kind: string; is_private: boolean; role: string }
type JoinedCommunity = Omit<Joined, "role">;

async function fetchJoined(uid: string): Promise<Joined[]> {
  const { data, error } = await supabase
    .from("community_members")
    .select("role, community:communities(id, name, color, avatar_url, kind, is_private)")
    .eq("user_id", uid);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as { role: string; community: JoinedCommunity | JoinedCommunity[] | null }[];
  return rows
    .map((r) => {
      const c = Array.isArray(r.community) ? r.community[0] : r.community;
      return c ? { ...c, role: r.role } : null;
    })
    .filter((x): x is Joined => !!x);
}

const isMod = (rows: Joined[], communityId: string) => rows.some((c) => c.id === communityId && (c.role === "owner" || c.role === "moderator"));

function friendly(message: string): string {
  if (message.includes("not_moderator")) return "Only this community's moderators can do that.";
  if (message.includes("only site moderators")) return "Only site moderators can feature posts.";
  if (message.includes("only the author")) return "Only the author can edit a post.";
  if (message.includes("suspended")) return "Your account is suspended.";
  return message.replace(/^[a-z_]+:\s*/, "");
}

const copy = copyToClipboard;

/** The site's link to a post or to one comment, on the clipboard; quiet when the button says it instead. */
export function copyPostLink(postId: string, commentId?: string | null, quiet?: boolean): Promise<boolean> {
  return copy(postUrl(SITE, postId, commentId), quiet ? null : "Link copied");
}

export function PostActionsProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const me = useMe();
  const siteMod = !!me?.is_moderator;
  const joined = useRef<{ uid: string; rows: Joined[] } | null>(null);
  const [sheet, setSheet] = useState<{ title: string; items: SheetItem[] } | null>(null);
  const [editing, setEditing] = useState<{ post: MenuPost; h?: PostHandlers } | null>(null);
  const [reposting, setReposting] = useState<{ post: MenuPost; h?: PostHandlers } | null>(null);

  /* Which communities I moderate: loaded with the session, refreshed each
     time a menu opens (the first open waits for it). */
  const loadJoined = useCallback(async (): Promise<Joined[]> => {
    if (!uid) return [];
    try {
      const rows = await fetchJoined(uid);
      joined.current = { uid, rows };
      return rows;
    } catch {
      return joined.current?.uid === uid ? joined.current.rows : [];
    }
  }, [uid]);
  useEffect(() => {
    joined.current = null;
    if (uid) void loadJoined();
  }, [uid, loadJoined]);
  const rolesNow = useCallback(async (): Promise<Joined[]> => {
    if (!uid) return [];
    const have = joined.current?.uid === uid ? joined.current.rows : null;
    if (have) {
      void loadJoined();
      return have;
    }
    return loadJoined();
  }, [uid, loadJoined]);

  const needAuth = useCallback(() => {
    if (uid) return false;
    router.push("/sign-in");
    return true;
  }, [uid]);

  const openPost = useCallback(async (p: MenuPost, h?: PostHandlers) => {
    const rows = await rolesNow();
    const mine = !!uid && p.author_id === uid;
    const mod = isMod(rows, p.community_id);
    const items: SheetItem[] = [
      { icon: "share-outline", label: "Copy link", run: () => void copyPostLink(p.id) },
      { icon: "repeat-outline", label: "Repost", run: () => { if (!needAuth()) setReposting({ post: p, h }); } },
      { icon: "copy-outline", label: "Copy text", run: () => void copy([p.title, p.body].filter(Boolean).join("\n\n"), "Text copied") },
    ];
    if (mine) items.push({ icon: "pencil-outline", label: "Edit post", run: () => setEditing({ post: p, h }) });
    if (siteMod) {
      items.push({
        icon: "star-outline",
        label: p.featured_at ? "Remove from home" : "Feature on home",
        run: () => void (async () => {
          const on = !p.featured_at;
          const { data, error } = await supabase.rpc("set_post_featured", { p_post: p.id, p_featured: on });
          if (error) return showToast(friendly(error.message));
          h?.onChanged?.({ featured_at: (data as string | null) ?? null });
          showToast(on ? "Featured on home" : "Taken off home");
        })(),
      });
    }
    if (mod) {
      items.push({
        icon: "pin-outline",
        label: p.pinned_at ? "Unpin post" : "Pin post",
        run: () => void (async () => {
          const pinned = !p.pinned_at;
          const { error } = await supabase.rpc("set_post_pinned", { p_post: p.id, p_pinned: pinned });
          if (error) return showToast(friendly(error.message));
          h?.onChanged?.({ pinned_at: pinned ? new Date().toISOString() : null });
          showToast(pinned ? "Post pinned" : "Post unpinned");
        })(),
      });
    }
    if (mine || mod) {
      items.push({
        icon: "trash-outline",
        label: mine ? "Delete post" : "Remove post (mod)",
        danger: true,
        run: () =>
          Alert.alert(mine ? "Delete this post?" : "Remove this post?", "Its comments go with it.", [
            { text: "Cancel", style: "cancel" },
            {
              text: mine ? "Delete" : "Remove",
              style: "destructive",
              onPress: () => void (async () => {
                const { data, error } = await supabase.from("community_posts").delete().eq("id", p.id).select("id");
                if (error || !data?.length) return showToast(error ? friendly(error.message) : "Couldn't delete that post.");
                h?.onRemoved?.();
                showToast(mine ? "Post deleted" : "Post removed");
              })(),
            },
          ]),
      });
    }
    setSheet({ title: plainPreview(p.title), items });
  }, [uid, siteMod, rolesNow, needAuth]);

  const openComment = useCallback(async (c: CommentRow, post: MenuPost | null, h?: CommentHandlers) => {
    const rows = await rolesNow();
    const mine = !!uid && c.author_id === uid;
    const mod = !!post && isMod(rows, post.community_id);
    const items: SheetItem[] = [];
    if (h?.onReply) items.push({ icon: "chatbubble-outline", label: "Reply", run: h.onReply });
    items.push({ icon: "copy-outline", label: "Copy text", run: () => void copy(c.body, "Text copied") });
    items.push({ icon: "share-outline", label: "Copy link", run: () => void copyPostLink(c.post_id, c.id) });
    if (h?.onToggleCollapse) items.push({ icon: h.collapsed ? "chevron-down-outline" : "chevron-up-outline", label: h.collapsed ? "Show comment" : "Hide comment", run: h.onToggleCollapse });
    if (!c.parent_id && mod) {
      items.push({
        icon: "pin-outline",
        label: c.pinned_at ? "Unpin" : "Pin",
        run: () => void (async () => {
          const pinned = !c.pinned_at;
          const { error } = await supabase.rpc("set_comment_pinned", { p_comment: c.id, p_pinned: pinned });
          if (error) return showToast(friendly(error.message));
          h?.onChanged?.({ pinned_at: pinned ? new Date().toISOString() : null });
          showToast(pinned ? "Comment pinned" : "Comment unpinned");
        })(),
      });
    }
    if (mine || mod) {
      items.push({
        icon: "trash-outline",
        label: mine ? "Delete" : "Remove (mod)",
        danger: true,
        run: () =>
          Alert.alert(mine ? "Delete this comment?" : "Remove this comment?", "Replies to it go with it.", [
            { text: "Cancel", style: "cancel" },
            {
              text: mine ? "Delete" : "Remove",
              style: "destructive",
              onPress: () => void (async () => {
                const { data, error } = await supabase.from("community_comments").delete().eq("id", c.id).select("id");
                if (error || !data?.length) return showToast(error ? friendly(error.message) : "Couldn't delete that comment.");
                h?.onRemoved?.();
                showToast(mine ? "Comment deleted" : "Comment removed");
              })(),
            },
          ]),
      });
    }
    setSheet({ title: `@${c.author_username}'s comment`, items });
  }, [uid, rolesNow]);

  useEffect(() => {
    registerPostMenus({
      openPost: (p, h) => void openPost(p, h),
      openComment: (c, p, h) => void openComment(c, p, h),
      repost: (p, h) => { if (!needAuth()) setReposting({ post: p, h }); },
    });
    return () => registerPostMenus(null);
  }, [openPost, openComment, needAuth]);

  return (
    <>
      {children}
      <ItemSheet open={!!sheet} title={sheet?.title} items={sheet?.items ?? []} onClose={() => setSheet(null)} />
      <ComposerSheet
        open={!!editing}
        kind="edit"
        initialBody={editing?.post.body ?? ""}
        context={editing ? plainPreview(editing.post.title) : null}
        userId={uid}
        onClose={() => setEditing(null)}
        onSubmit={async ({ body }) => {
          const target = editing;
          if (!target) return null;
          if (body.length > POST_BODY_MAX) return `Post is too long (${body.length.toLocaleString()} / ${POST_BODY_MAX.toLocaleString()} characters).`;
          const { data, error } = await supabase.rpc("edit_post", { p_post: target.post.id, p_body: body });
          if (error) return friendly(error.message);
          target.h?.onChanged?.({ body, edited_at: (data as string | null) ?? new Date().toISOString() });
          showToast("Post updated");
          return null;
        }}
      />
      <RepostSheet target={reposting} uid={uid} onClose={() => setReposting(null)} />
    </>
  );
}

function Tile({ c, size = 30 }: { c: JoinedCommunity; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.32), overflow: "hidden", backgroundColor: c.color || colors.blue, alignItems: "center", justifyContent: "center" }}>
      {c.avatar_url ? <Image source={{ uri: c.avatar_url }} style={{ width: size, height: size }} /> : <Text style={{ color: "#fff", fontFamily: fonts.title, fontSize: Math.round(size * 0.45) }}>{c.name.trim().charAt(0).toUpperCase()}</Text>}
    </View>
  );
}

/* The site's repost dialog as a phone sheet: the post it shares, the
   community it lands in (yours only, not the one it came from), your
   take. Your own profile board leads the list. */
function RepostSheet({ target, uid, onClose }: { target: { post: MenuPost; h?: PostHandlers } | null; uid: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [options, setOptions] = useState<Joined[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [take, setTake] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const post = target?.post ?? null;
  const postId = post?.id ?? null;
  const sourceId = post?.community_id ?? null;

  useEffect(() => {
    if (!postId || !uid) return;
    setOptions(null);
    setPick(null);
    setTake("");
    setError(null);
    setBusy(false);
    let live = true;
    void (async () => {
      /* Everyone has a profile board to repost to; made on first sight, as the site does. */
      await supabase.rpc("ensure_profile_community").then(undefined, () => undefined);
      const rows = await fetchJoined(uid).catch(() => [] as Joined[]);
      if (!live) return;
      const list = rows
        .filter((c) => c.id !== sourceId)
        .sort((a, b) => Number(b.kind === "profile") - Number(a.kind === "profile") || a.name.localeCompare(b.name));
      setOptions(list);
      setPick(list[0]?.id ?? null);
    })();
    return () => { live = false; };
  }, [postId, sourceId, uid]);

  const submit = async () => {
    if (!post || !pick || busy) return;
    const body = take.trim();
    const issue = body ? cleanTextError(body, BODY_MIN) : null;
    if (issue) { setError(issue); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("repost_post", { p_post: post.id, p_community: pick, p_body: body || null });
    setBusy(false);
    if (err) {
      setError(
        err.message.includes("private_source") ? "Posts in private communities can't be shared out."
        : err.message.includes("same_community") ? "That post already lives in that community."
        : err.message.includes("rate_limited") ? "You're posting too quickly — try again in a few minutes."
        : friendly(err.message));
      return;
    }
    const name = options?.find((c) => c.id === pick)?.name;
    onClose();
    showToast(name ? `Reposted to ${name}` : "Reposted");
  };

  const canSend = !!pick && !busy;
  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: colors.surface2, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#23232b", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 + insets.bottom, maxHeight: Math.round(height * 0.86) }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 }}>
            <Pressable onPress={onClose} hitSlop={8}><Text style={{ color: "#c3c3ce", fontFamily: fonts.body, fontSize: 15 }}>Cancel</Text></Pressable>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="repeat-outline" size={16} color={colors.text} />
              <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15 }}>Repost</Text>
            </View>
            <Pressable onPress={() => void submit()} disabled={!canSend} style={{ height: 34, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", opacity: canSend ? 1 : 0.45 }}>
              <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 13 }}>{busy ? "Reposting…" : "Repost"}</Text>
            </Pressable>
          </View>
          {post && <Text numberOfLines={1} style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 12.5, marginTop: 6 }}>“{plainPreview(post.title)}”</Text>}
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false} style={{ marginTop: 10 }}>
            {options === null ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, paddingVertical: 16, textAlign: "center" }}>Loading your communities…</Text>
            ) : options.length === 0 ? (
              <Text style={{ color: "rgba(238,238,245,0.55)", fontFamily: fonts.body, fontSize: 13, lineHeight: 19, paddingVertical: 10 }}>{"Join another community first — reposts land in a community you're a member of."}</Text>
            ) : (
              <>
                <Text style={{ color: colors.faint, fontFamily: fonts.semi, fontSize: 10.5, letterSpacing: 0.8, marginBottom: 6 }}>POST TO</Text>
                <View style={{ borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden", marginBottom: 12 }}>
                  {options.map((c, i) => {
                    const on = c.id === pick;
                    return (
                      <Pressable key={c.id} onPress={() => setPick(c.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: on ? "#1d1d24" : pressed ? "#18181e" : colors.surface, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderColor: colors.hairline })}>
                        <Tile c={c} size={28} />
                        <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontFamily: fonts.semi, fontSize: 14 }}>{c.name}</Text>
                        {c.is_private && <Ionicons name="lock-closed" size={12} color={colors.faint} />}
                        <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={20} color={on ? colors.yellow : "#4a4a55"} />
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  value={take}
                  onChangeText={(t) => setTake(t.slice(0, 10000))}
                  placeholder="Add your take (optional)"
                  placeholderTextColor={colors.faint}
                  multiline
                  maxLength={10000}
                  style={{ color: colors.text, fontFamily: fonts.body, fontSize: 15, lineHeight: 21, minHeight: 72, maxHeight: 160, padding: 12, borderRadius: 12, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38", textAlignVertical: "top" }}
                />
              </>
            )}
            {error && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 12.5, marginTop: 8 }}>{error}</Text>}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
