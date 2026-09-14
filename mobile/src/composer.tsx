/* The phone composer from the site (components/community/PostComposer.tsx,
   CommentSheet.tsx): a sheet over the keyboard with Cancel and the
   yellow pill up top, a line naming what it answers, the text — a title
   line too for posts — then the row of GIF, picture, emoji and Aa for
   the formatting strip; the community's tags and, for a verified
   account, the conversation people can queue into; a clip riding along
   from its page. Typing @ offers people (search_mention_users, as the
   site's editor does). The same sheet edits a post's text. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { EmojiPicker } from "./emojiPicker";
import { GifPicker, giphyEnabled } from "./gifPicker";
import { pickImage, uploadPostImage, type PickedImage } from "./postImages";
import { fetchTags, type Tag } from "./communities";
import { TagChip } from "./postCard";
import { Avatar } from "./avatar";
import { TOPICS } from "./topics";
import { cleanTextError, BODY_MIN, NAME_MIN } from "./cleanText";
import { colors, fonts } from "./theme";

export const POST_TITLE_MAX = 200;
export const POST_BODY_MAX = 10000;
export const TOPIC_QUEUE_KEYS = new Set(["politics-law", "politics-ethics", "sports", "culture", "economics", "science-tech", "foreign-policy", "philosophy"]);
export type TopicDraft = { on: boolean; question: string; topicKey: string };
export const EMPTY_TOPIC: TopicDraft = { on: false, question: "", topicKey: "politics-law" };
export interface ComposerResult { title: string; body: string; imageUrl: string | null; tagId: string | null; topic: TopicDraft | null }
export interface ComposeClip { id: string; title: string; duration: string | null }

type MentionUser = { id: string; username: string; display_name: string | null; avatar_url: string | null };

export function ComposerSheet({ open, kind, initialBody, context, contextName, communityId, userId, canAttachTopic, clip, onClose, onSubmit }: {
  open: boolean;
  /** "edit": a post's text only, prefilled, saved in place. */
  kind: "post" | "comment" | "edit";
  initialBody?: string;
  /** For replies: the line under the buttons, e.g. the comment answered. */
  context?: string | null;
  contextName?: string | null;
  /** Posts: the community whose tags to offer. */
  communityId?: string | null;
  userId: string | null;
  /** Verified accounts: the post can carry a conversation people queue into. */
  canAttachTopic?: boolean;
  clip?: ComposeClip | null;
  onClose: () => void;
  /** Resolves to an error to show, or null when it went through. */
  onSubmit: (input: ComposerResult) => Promise<string | null>;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attach, setAttach] = useState<PickedImage | null>(null);
  const [gif, setGif] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | "emoji" | "gif">(null);
  const [format, setFormat] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagId, setTagId] = useState<string | null>(null);
  const [topic, setTopic] = useState<TopicDraft>(EMPTY_TOPIC);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const bodyRef = useRef<TextInput>(null);
  const [mentions, setMentions] = useState<MentionUser[]>([]);
  useEffect(() => {
    if (open) { setTitle(clip?.title ?? ""); setBody(initialBody ?? ""); setError(null); setBusy(false); setAttach(null); setGif(null); setPicker(null); setFormat(false); setTagId(null); setTopic(EMPTY_TOPIC); setMentions([]); }
  }, [open, clip?.title, initialBody]);

  /* The @name being typed right before the caret, as the site's editor
     finds it: at the start or after anything but a word character or a
     slash, so an email address never asks. */
  const mentionAt = useMemo(() => {
    if (!userId) return null;
    const m = /(^|[^\w/])@([A-Za-z0-9_]{1,20})$/.exec(body.slice(0, sel.start));
    return m ? { query: m[2], start: sel.start - m[2].length - 1 } : null;
  }, [body, sel.start, userId]);
  const mentionQuery = mentionAt?.query ?? null;
  useEffect(() => {
    if (!mentionQuery) { setMentions([]); return; }
    let live = true;
    const t = setTimeout(() => {
      void supabase.rpc("search_mention_users", { p_query: mentionQuery, p_limit: 5 }).then(({ data }) => {
        if (live) setMentions((data ?? []) as MentionUser[]);
      });
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [mentionQuery]);
  const pickMention = (u: MentionUser) => {
    if (!mentionAt) return;
    const end = mentionAt.start + 1 + mentionAt.query.length;
    const caret = mentionAt.start + u.username.length + 2;
    setBody(body.slice(0, mentionAt.start) + "@" + u.username + " " + body.slice(end));
    setSel({ start: caret, end: caret });
    setMentions([]);
    requestAnimationFrame(() => bodyRef.current?.setSelection(caret, caret));
  };
  useEffect(() => {
    if (!open || kind !== "post" || !communityId) { setTags([]); return; }
    void fetchTags(supabase, communityId).then(setTags);
  }, [open, kind, communityId]);

  const max = kind === "comment" ? 4000 : POST_BODY_MAX;
  const canSend = !busy && (kind === "post" ? !!title.trim() : kind === "edit" ? true : !!body.trim() || !!attach || !!gif) && body.length <= max;
  const insert = (s: string, wrap?: string, close?: string) => {
    setBody((cur) => {
      const start = Math.min(sel.start, cur.length), end = Math.min(sel.end, cur.length);
      const picked = cur.slice(start, end);
      const piece = wrap ? `${wrap}${picked || s}${close ?? wrap}` : s;
      return cur.slice(0, start) + piece + cur.slice(end);
    });
  };
  const send = async () => {
    if (!canSend) return;
    const issue = (kind === "post" ? cleanTextError(title.trim(), NAME_MIN) : null) ?? cleanTextError(body, BODY_MIN);
    if (issue) { setError(issue); return; }
    setBusy(true);
    setError(null);
    let imageUrl: string | null = gif;
    if (attach) {
      if (!userId) { setBusy(false); setError("Sign in first."); return; }
      try { imageUrl = await uploadPostImage(userId, attach); } catch (e) { setBusy(false); setError(e instanceof Error ? e.message : "Image upload failed."); return; }
    }
    const err = await onSubmit({ title: title.trim(), body: body.trim(), imageUrl, tagId, topic: topic.on ? topic : null });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  const attachPhoto = async () => {
    try { const img = await pickImage(); if (img) { setAttach(img); setGif(null); } }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't pick a picture."); }
  };
  const tool = (label: React.ReactNode, onPress: () => void, on?: boolean) => (
    <Pressable onPress={onPress} hitSlop={6} style={{ height: 34, minWidth: 34, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: on ? "#26262e" : "transparent" }}>{label}</Pressable>
  );
  const fmt = (label: string, run: () => void) => (
    <Pressable key={label} onPress={run} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#17171c", borderWidth: 1, borderColor: "#2a2a34" }}><Text style={{ color: "#c9c9d2", fontFamily: fonts.semi, fontSize: 12 }}>{label}</Text></Pressable>
  );

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: colors.surface2, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#23232b", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 + insets.bottom, maxHeight: Math.round(height * 0.86) }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 }}>
            <Pressable onPress={onClose} hitSlop={8}><Text style={{ color: "#c3c3ce", fontFamily: fonts.body, fontSize: 15 }}>Cancel</Text></Pressable>
            <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 15 }}>{kind === "post" ? (clip ? "Post clip" : "New post") : kind === "edit" ? "Edit post" : "Comment"}</Text>
            <Pressable onPress={() => void send()} disabled={!canSend} style={{ height: 34, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", opacity: canSend ? 1 : 0.45 }}>
              <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 13 }}>{busy ? (kind === "edit" ? "Saving…" : "Sending…") : kind === "post" ? "Post" : kind === "edit" ? "Save" : "Comment"}</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            {context ? (
              <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, marginTop: 6 }}>
                {contextName ? <Text style={{ color: "#f2f2f6", fontFamily: fonts.bold }}>{contextName}  </Text> : null}{context}
              </Text>
            ) : null}
            {kind === "post" && (
              <TextInput value={title} onChangeText={(t) => setTitle(t.slice(0, POST_TITLE_MAX))} placeholder="Title" placeholderTextColor={colors.faint} autoFocus={!clip} maxLength={POST_TITLE_MAX} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 18, paddingVertical: 10, marginTop: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }} />
            )}
            {format && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 8 }}>
                {fmt("B", () => insert("bold", "**"))}
                {fmt("I", () => insert("italic", "_"))}
                {fmt("S", () => insert("struck", "~~"))}
                {fmt("Code", () => insert("code", "`"))}
                {fmt("Quote", () => insert("\n> "))}
                {fmt("• List", () => insert("\n- "))}
                {fmt("1. List", () => insert("\n1. "))}
                {fmt("Link", () => insert("[text](https://)"))}
                {fmt("Spoiler", () => insert("spoiler", ">!", "!<"))}
              </View>
            )}
            <TextInput
              ref={bodyRef}
              value={body}
              onChangeText={setBody}
              onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
              placeholder={kind === "post" ? (clip ? "Say something about the clip (optional — @ to mention someone)" : "Text (optional — @ to mention someone)") : kind === "edit" ? "Text (optional — @ to mention someone)" : "Take the floor"}
              placeholderTextColor={colors.faint}
              autoFocus={kind !== "post" || !!clip}
              multiline
              maxLength={max}
              style={{ color: colors.text, fontFamily: fonts.body, fontSize: 16, lineHeight: 22, minHeight: 96, maxHeight: 220, paddingVertical: 10, textAlignVertical: "top" }}
            />
            {clip && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 9, alignSelf: "flex-start", paddingVertical: 6, paddingLeft: 7, paddingRight: 12, borderRadius: 10, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38", marginBottom: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" }}><Ionicons name="play" size={11} color={colors.ink} /></View>
                <View style={{ minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 12.5 }}>{clip.title}</Text>
                  <Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 11 }}>Clip{clip.duration ? ` · ${clip.duration}` : ""} · attached to this post</Text>
                </View>
              </View>
            )}
            {(attach || gif) && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Image source={{ uri: attach?.uri ?? gif ?? undefined }} style={{ height: 64, width: 96, borderRadius: 8 }} resizeMode="cover" />
                <Pressable onPress={() => { setAttach(null); setGif(null); }} hitSlop={8} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38", alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={12} color="rgba(238,238,245,0.6)" /></Pressable>
              </View>
            )}
            {tags.length > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, paddingVertical: 6 }}>
                <Text style={{ color: "rgba(238,238,245,0.35)", fontFamily: fonts.body, fontSize: 11 }}>Tag:</Text>
                {tags.map((t) => <Pressable key={t.id} onPress={() => setTagId(tagId === t.id ? null : t.id)} style={{ opacity: tagId && tagId !== t.id ? 0.45 : 1 }}><TagChip name={t.name} color={t.color} /></Pressable>)}
              </View>
            )}
            {kind === "post" && canAttachTopic && (
              <View style={{ paddingVertical: 8, gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Switch value={topic.on} onValueChange={(on) => setTopic({ ...topic, on, question: topic.question || title })} trackColor={{ true: colors.yellow, false: colors.border }} thumbColor="#fff" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 12.5 }}>Attach a Queue</Text>
                    <Text style={{ color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 11.5, lineHeight: 15 }}>Readers can queue into a conversation from your post; the next two in line get matched into a live room.</Text>
                  </View>
                </View>
                {topic.on && (
                  <>
                    <TextInput value={topic.question} onChangeText={(t) => setTopic({ ...topic, question: t.slice(0, 200) })} placeholder="The question to argue (5–200 characters)" placeholderTextColor={colors.faint} maxLength={200} style={{ height: 38, borderRadius: 10, borderWidth: 1, borderColor: "#2e2e38", backgroundColor: "#0b0b0d", color: "#fff", fontFamily: fonts.body, fontSize: 13.5, paddingHorizontal: 12 }} />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {TOPICS.filter((x) => TOPIC_QUEUE_KEYS.has(x.key)).map((x) => (
                        <Pressable key={x.key} onPress={() => setTopic({ ...topic, topicKey: x.key })} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: topic.topicKey === x.key ? x.color : colors.surface, borderWidth: 1, borderColor: topic.topicKey === x.key ? x.color : colors.hairline }}>
                          <Text style={{ color: topic.topicKey === x.key ? "#fff" : "#c9c9d2", fontFamily: fonts.medium, fontSize: 12 }}>{x.label}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </>
                )}
              </View>
            )}
            {error && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 12.5, marginTop: 4 }}>{error}</Text>}
            {body.length > max * 0.9 && <Text style={{ color: body.length > max ? "#e26b6b" : "rgba(238,238,245,0.35)", fontFamily: fonts.body, fontSize: 11, marginTop: 4 }}>{body.length.toLocaleString()} / {max.toLocaleString()}</Text>}
          </ScrollView>
          {mentions.length > 0 && (
            <View accessibilityLabel="People to mention" style={{ paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}>
              {mentions.map((u) => (
                <Pressable key={u.id} onPress={() => pickMention(u)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 8, backgroundColor: pressed ? "#26262e" : "transparent" })}>
                  <Avatar url={u.avatar_url} name={u.username} size={22} />
                  <Text style={{ color: "#eeeef5", fontFamily: fonts.semi, fontSize: 13 }}>@{u.username}</Text>
                  {!!u.display_name?.trim() && <Text numberOfLines={1} style={{ flex: 1, color: "rgba(238,238,245,0.45)", fontFamily: fonts.body, fontSize: 12 }}>{u.display_name}</Text>}
                </Pressable>
              ))}
            </View>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}>
            {giphyEnabled && kind !== "edit" && tool(<Text style={{ color: "rgba(255,255,255,0.7)", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5 }}>GIF</Text>, () => setPicker("gif"))}
            {kind !== "edit" && tool(<Ionicons name="image-outline" size={22} color="rgba(255,255,255,0.7)" />, () => void attachPhoto())}
            {tool(<Ionicons name="happy-outline" size={22} color="rgba(255,255,255,0.7)" />, () => setPicker("emoji"))}
            <View style={{ width: 1, height: 20, backgroundColor: "#2a2a34", marginHorizontal: 6 }} />
            {tool(<Text style={{ color: format ? colors.yellow : "rgba(255,255,255,0.7)", fontFamily: fonts.bold, fontSize: 14 }}>Aa</Text>, () => setFormat((f) => !f), format)}
          </View>
        </View>
      </KeyboardAvoidingView>
      <EmojiPicker open={picker === "emoji"} onClose={() => setPicker(null)} onPick={(e) => { insert(e); setPicker(null); }} />
      <GifPicker open={picker === "gif"} onClose={() => setPicker(null)} onPick={(u) => { setGif(u); setAttach(null); }} />
    </Modal>
  );
}
