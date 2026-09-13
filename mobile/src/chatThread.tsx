/* One conversation's scroller and composer, shared by direct messages
   and group chats (the site's DmThread / GroupThread): bubbles — yours
   yellow on the right, theirs dark on the left with the sender's
   picture by the last of a run and their name over the first — day
   labels, reply quotes, pictures, reactions, invite cards, system
   lines, the typing strip; the composer with emoji, a picture, a GIF
   when GIPHY is on, and the yellow send. Press and hold a bubble for
   its menu. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "./avatar";
import { EmojiPicker } from "./emojiPicker";
import { GifPicker, giphyEnabled } from "./gifPicker";
import { openImage } from "./lightbox";
import { pickImage, type PickedImage } from "./postImages";
import { CommunityTile } from "./postCard";
import { QUICK_REACTIONS, dayLabel, displayName, fmtTime, isGif, type InviteMeta, type Reaction } from "./messages";
import { showToast } from "./toast";
import { colors, fonts } from "./theme";

export interface ChatMsg { id: string; sender_id: string | null; content: string; image_url: string | null; reply_to: string | null; created_at: string; kind?: "text" | "system"; read_at?: string | null; community_id?: string | null }
export interface ChatPerson { id: string; username: string; display_name?: string | null; avatar_url: string | null }

export interface ChatThreadProps {
  me: string;
  msgs: ChatMsg[];
  who: (id: string | null) => ChatPerson;
  reactions?: Map<string, Reaction[]>;
  onReact?: (messageId: string, emoji: string) => void;
  canUnsend: (m: ChatMsg) => boolean;
  onUnsend: (m: ChatMsg) => void;
  onDeleteForMe?: (m: ChatMsg) => void;
  typingLabel: string | null;
  lastMineReadId?: string | null;
  onSend: (text: string, imageUrl: string | null, replyTo: string | null) => Promise<boolean>;
  onTyping?: () => void;
  sendError: string | null;
  emptyText: string;
  inviteMeta?: Map<string, InviteMeta>;
  onAcceptInvite?: (communityId: string) => void;
  joining?: string | null;
  uploadImage: (img: PickedImage) => Promise<string>;
}

const YELLOW = colors.yellow, INK = colors.ink;
const COMMUNITY_KIND_LABEL: Record<string, string> = { "topic-circle": "Topic circle", university: "University", "hs-team": "HS team", mun: "Model UN", "pre-law": "Pre-law", profile: "Profile" };

type Item = { m: ChatMsg; newDay: boolean; startsRun: boolean; endsRun: boolean };

export function ChatThread(p: ChatThreadProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMsg | null>(null);
  const [attach, setAttach] = useState<PickedImage | null>(null);
  const [gif, setGif] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState<null | "emoji" | "gif">(null);
  const [menuFor, setMenuFor] = useState<ChatMsg | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const lastTyping = useRef(0);
  const listRef = useRef<FlatList<Item>>(null);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (let i = 0; i < p.msgs.length; i++) {
      const m = p.msgs[i];
      const prev = i > 0 ? p.msgs[i - 1] : null;
      const next = i < p.msgs.length - 1 ? p.msgs[i + 1] : null;
      out.push({
        m,
        newDay: !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at),
        startsRun: !prev || prev.sender_id !== m.sender_id || prev.kind === "system" || !!m.community_id || !!prev.community_id,
        endsRun: !next || next.sender_id !== m.sender_id || next.kind === "system" || !!m.community_id || !!next.community_id,
      });
    }
    return out.reverse();
  }, [p.msgs]);

  const byId = useMemo(() => new Map(p.msgs.map((m) => [m.id, m])), [p.msgs]);
  const canSend = !sending && (draft.trim().length > 0 || !!attach || !!gif);

  const send = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !attach && !gif) || sending) return;
    setSending(true);
    setLocalError(null);
    let imageUrl: string | null = gif;
    if (attach) {
      try { imageUrl = await p.uploadImage(attach); } catch (e) { setSending(false); setLocalError(e instanceof Error ? e.message : "Image upload failed."); return; }
    }
    const ok = await p.onSend(text, imageUrl, replyTo?.id ?? null);
    setSending(false);
    if (ok) { setDraft(""); setReplyTo(null); setAttach(null); setGif(null); }
  }, [draft, attach, gif, sending, replyTo, p]);

  const attachPhoto = async () => {
    try {
      const img = await pickImage();
      if (img) { setAttach(img); setGif(null); }
    } catch (e) { setLocalError(e instanceof Error ? e.message : "Couldn't pick a picture."); }
  };

  const copyText = async (m: ChatMsg) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
      await Clipboard.setStringAsync(m.content);
      showToast("Copied");
    } catch { showToast("Couldn't copy"); }
  };

  const renderItem = ({ item }: { item: Item }) => {
    const { m, newDay, startsRun, endsRun } = item;
    const mine = m.sender_id === p.me;
    const day = newDay ? <Text style={{ alignSelf: "center", marginTop: 10, marginBottom: 2, color: "#6b6b74", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6 }}>{dayLabel(m.created_at).toUpperCase()}</Text> : null;
    if (m.kind === "system") {
      return (
        <View>
          {day}
          <Text style={{ alignSelf: "center", textAlign: "center", marginVertical: 6, color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, maxWidth: "85%" }}>{`${mine ? "You" : displayName(p.who(m.sender_id))} ${m.content}`}</Text>
        </View>
      );
    }
    const sender = p.who(m.sender_id);
    const hasText = m.content.trim().length > 0;
    const quoted = m.reply_to ? byId.get(m.reply_to) ?? null : null;
    const rx = (() => {
      const g = new Map<string, { count: number; mine: boolean }>();
      for (const r of p.reactions?.get(m.id) ?? []) {
        const e = g.get(r.emoji) ?? { count: 0, mine: false };
        e.count++;
        if (r.user_id === p.me) e.mine = true;
        g.set(r.emoji, e);
      }
      return [...g.entries()];
    })();
    const invite = m.community_id ? p.inviteMeta?.get(m.community_id) : undefined;
    return (
      <View style={{ paddingHorizontal: 12, marginBottom: 6 }}>
        {day}
        {!mine && startsRun && <Text style={{ marginLeft: 34, marginTop: 8, marginBottom: 2, color: "rgba(238,238,245,0.5)", fontFamily: fonts.body, fontSize: 11.5 }}>{displayName(sender)}</Text>}
        <View style={{ flexDirection: mine ? "row-reverse" : "row", alignItems: "flex-end", gap: 6, alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "84%" }}>
          {!mine && <View style={{ width: 22, height: 22, marginBottom: 2 }}>{endsRun && <Avatar url={sender.avatar_url} name={sender.username} size={22} />}</View>}
          <Pressable
            onLongPress={() => setMenuFor(m)}
            delayLongPress={280}
            style={{ padding: m.image_url ? 4 : 0, paddingHorizontal: m.image_url ? 4 : 11, paddingVertical: m.image_url ? 4 : 7, borderRadius: 12, borderBottomRightRadius: mine ? 3 : 12, borderBottomLeftRadius: mine ? 12 : 3, backgroundColor: mine ? YELLOW : "#1e2129", opacity: menuFor?.id === m.id ? 0.85 : 1 }}
          >
            {m.reply_to && (
              <View style={{ margin: m.image_url ? 4 : 0, marginBottom: 5, paddingHorizontal: 8, paddingVertical: 3, borderLeftWidth: 2, borderLeftColor: mine ? "rgba(0,0,0,0.4)" : YELLOW, borderRadius: 6, backgroundColor: mine ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.06)" }}>
                <Text style={{ color: mine ? INK : "#f2f2f5", fontFamily: fonts.bold, fontSize: 12, opacity: 0.8 }}>{quoted ? (quoted.sender_id === p.me ? "You" : displayName(p.who(quoted.sender_id))) : "Earlier message"}</Text>
                {quoted && <Text numberOfLines={1} style={{ color: mine ? INK : "#f2f2f5", fontFamily: fonts.body, fontSize: 12, opacity: 0.75 }}>{quoted.content.trim() || (quoted.image_url ? (isGif(quoted.image_url) ? "GIF" : "Photo") : "")}</Text>}
              </View>
            )}
            {m.image_url && (
              <Pressable onPress={() => openImage(m.image_url!)}>
                <Image source={{ uri: m.image_url }} style={{ width: 240, height: 240, borderRadius: 9, backgroundColor: "#0f0f12" }} resizeMode="cover" />
              </Pressable>
            )}
            {m.community_id ? (
              <View style={{ width: 260, padding: 6, gap: 8 }}>
                <Text style={{ color: mine ? INK : "#f2f2f5", fontFamily: fonts.body, fontSize: 11, opacity: 0.7 }}>{mine ? "You invited them to join" : "Invited you to join"}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <CommunityTile name={invite?.name ?? m.content.replace(/^Invited you to join /, "")} color={invite?.color} avatarUrl={invite?.avatar_url} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: mine ? INK : "#f2f2f5", fontFamily: fonts.bold, fontSize: 14 }}>{invite?.name ?? m.content.replace(/^Invited you to join /, "")}</Text>
                    {invite && <Text style={{ color: mine ? INK : "#f2f2f5", fontFamily: fonts.body, fontSize: 11, opacity: 0.65, marginTop: 2 }}>{COMMUNITY_KIND_LABEL[invite.kind] ?? "Community"} · {invite.is_private ? "Private" : "Public"} · {invite.members} member{invite.members === 1 ? "" : "s"}</Text>}
                  </View>
                </View>
                {!!invite?.description && <Text numberOfLines={3} style={{ color: mine ? INK : "#f2f2f5", fontFamily: fonts.body, fontSize: 12, lineHeight: 17, opacity: 0.8 }}>{invite.description}</Text>}
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  {!mine && invite && !invite.joined && p.onAcceptInvite && (
                    <Pressable onPress={() => p.onAcceptInvite?.(m.community_id!)} disabled={p.joining === m.community_id} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: YELLOW, borderWidth: 1, borderColor: "#e0a000" }}>
                      <Text style={{ color: INK, fontFamily: fonts.bold, fontSize: 12.5 }}>{p.joining === m.community_id ? "Joining…" : "Join"}</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => router.push({ pathname: "/c/[id]", params: { id: m.community_id! } })} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "#2e2e38" }}>
                    <Text style={{ color: "#c9c9d2", fontFamily: fonts.bold, fontSize: 12 }}>View page</Text>
                  </Pressable>
                  {!mine && invite?.joined && <Text style={{ color: mine ? INK : "#f2f2f5", fontFamily: fonts.body, fontSize: 11, opacity: 0.7 }}>✓ Joined</Text>}
                </View>
              </View>
            ) : hasText && <Text style={{ color: mine ? INK : "#f2f2f5", fontFamily: fonts.body, fontSize: 15, lineHeight: 21, padding: m.image_url ? 5 : 0 }}>{m.content}</Text>}
          </Pressable>
        </View>
        {rx.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, alignSelf: mine ? "flex-end" : "flex-start", marginTop: 2, marginLeft: mine ? 0 : 28 }}>
            {rx.map(([emoji, g]) => (
              <Pressable key={emoji} onPress={() => p.onReact?.(m.id, emoji)} style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, borderWidth: 1, borderColor: g.mine ? YELLOW : "#2e2e38", backgroundColor: g.mine ? "#2a2410" : "#17171c" }}>
                <Text style={{ fontSize: 14 }}>{emoji}</Text>
                {g.count > 1 && <Text style={{ color: "#e6e6ec", fontFamily: fonts.body, fontSize: 12 }}>{g.count}</Text>}
              </Pressable>
            ))}
          </View>
        )}
        {m.id === p.lastMineReadId && <Text style={{ alignSelf: "flex-end", color: colors.muted, fontFamily: fonts.body, fontSize: 11.5, marginTop: 2 }}>Seen</Text>}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={0}>
      <FlatList
        ref={listRef}
        data={items}
        inverted
        keyExtractor={(it) => it.m.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingVertical: 12 }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<View style={{ transform: [{ scaleY: -1 }] }}><Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, textAlign: "center", marginTop: 24 }}>{p.emptyText}</Text></View>}
      />
      {p.typingLabel && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, height: 22 }}>
          <View style={{ flexDirection: "row", gap: 3 }}>{[0, 1, 2].map((i) => <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: YELLOW }} />)}</View>
          <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>{p.typingLabel}</Text>
        </View>
      )}
      {(p.sendError || localError) && <Text style={{ color: "#ff9d92", fontFamily: fonts.body, fontSize: 11.5, paddingHorizontal: 14, paddingVertical: 4 }}>{p.sendError ?? localError}</Text>}
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#1b1b21", backgroundColor: colors.bg }}>
        {replyTo && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, paddingHorizontal: 8, paddingVertical: 4, borderLeftWidth: 2, borderLeftColor: YELLOW, borderRadius: 6, backgroundColor: "#1a1710" }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: "#c9c9d4", fontFamily: fonts.bold, fontSize: 12 }}>Replying to {replyTo.sender_id === p.me ? "yourself" : displayName(p.who(replyTo.sender_id))}</Text>
              <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>{replyTo.content.trim() || (replyTo.image_url ? (isGif(replyTo.image_url) ? "GIF" : "Photo") : "")}</Text>
            </View>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8}><Ionicons name="close" size={14} color="rgba(255,255,255,0.5)" /></Pressable>
          </View>
        )}
        {(attach || gif) && (
          <View style={{ alignSelf: "flex-start", marginBottom: 6 }}>
            <Image source={{ uri: attach?.uri ?? gif ?? undefined }} style={{ height: 64, width: 64, borderRadius: 8 }} />
            <Pressable onPress={() => { setAttach(null); setGif(null); }} style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: "#1a1c24", borderWidth: 1, borderColor: "#3a3a44", alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={11} color="#fff" /></Pressable>
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              const now = Date.now();
              if (t && now - lastTyping.current > 2000) { lastTyping.current = now; p.onTyping?.(); }
            }}
            placeholder="Message…"
            placeholderTextColor={colors.faint}
            multiline
            style={{ flex: 1, minHeight: 38, maxHeight: 104, borderRadius: 10, borderWidth: 1, borderColor: "#2a2a34", backgroundColor: "#111114", color: "#fff", fontFamily: fonts.body, fontSize: 14.5, lineHeight: 20, paddingHorizontal: 12, paddingVertical: 8 }}
          />
          <Pressable onPress={() => setPicker("emoji")} hitSlop={6} accessibilityLabel="Add emoji" style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}><Ionicons name="happy-outline" size={20} color="rgba(255,255,255,0.6)" /></Pressable>
          <Pressable onPress={() => void attachPhoto()} hitSlop={6} accessibilityLabel="Attach image" style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}><Ionicons name="image-outline" size={20} color="rgba(255,255,255,0.6)" /></Pressable>
          {giphyEnabled && <Pressable onPress={() => setPicker("gif")} hitSlop={6} accessibilityLabel="Add a GIF" style={{ height: 34, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "rgba(255,255,255,0.6)", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5 }}>GIF</Text></Pressable>}
          <Pressable onPress={() => void send()} disabled={!canSend} accessibilityLabel="Send" style={{ width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: canSend ? YELLOW : "#3d3200" }}>
            <Ionicons name="send" size={15} color={canSend ? INK : "rgba(255,255,255,0.55)"} />
          </Pressable>
        </View>
      </View>
      <EmojiPicker open={picker === "emoji"} onClose={() => setPicker(null)} onPick={(e) => { setDraft((d) => d + e); setPicker(null); }} />
      <GifPicker open={picker === "gif"} onClose={() => setPicker(null)} onPick={(u) => { setGif(u); setAttach(null); }} />
      <MessageMenu
        msg={menuFor}
        mine={menuFor?.sender_id === p.me}
        reactions={p.onReact ? QUICK_REACTIONS : []}
        myReactions={new Set((menuFor ? p.reactions?.get(menuFor.id) ?? [] : []).filter((r) => r.user_id === p.me).map((r) => r.emoji))}
        canUnsend={!!menuFor && p.canUnsend(menuFor)}
        showDelete={!!p.onDeleteForMe}
        onReact={(e) => { if (menuFor) p.onReact?.(menuFor.id, e); setMenuFor(null); }}
        onReply={() => { setReplyTo(menuFor); setMenuFor(null); inputRef.current?.focus(); }}
        onCopy={() => { if (menuFor) void copyText(menuFor); setMenuFor(null); }}
        onUnsend={() => { if (menuFor) p.onUnsend(menuFor); setMenuFor(null); }}
        onDelete={() => { if (menuFor) p.onDeleteForMe?.(menuFor); setMenuFor(null); }}
        onClose={() => setMenuFor(null)}
      />
    </KeyboardAvoidingView>
  );
}

/* The per-message menu (the site's DmMessageMenu) as a sheet. */
function MessageMenu({ msg, mine, reactions, myReactions, canUnsend, showDelete, onReact, onReply, onCopy, onUnsend, onDelete, onClose }: {
  msg: ChatMsg | null; mine: boolean; reactions: string[]; myReactions: Set<string>; canUnsend: boolean; showDelete: boolean;
  onReact: (e: string) => void; onReply: () => void; onCopy: () => void; onUnsend: () => void; onDelete: () => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const row = (icon: React.ComponentProps<typeof Ionicons>["name"], label: string, run: () => void, danger?: boolean) => (
    <Pressable key={label} onPress={run} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: pressed ? "#1a1a20" : "transparent" })}>
      <Ionicons name={icon} size={16} color={danger ? "#f08a8a" : colors.muted} />
      <Text style={{ color: danger ? "#f08a8a" : colors.text, fontFamily: fonts.medium, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
  void mine;
  return (
    <Modal visible={!!msg} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, padding: 10, paddingBottom: insets.bottom + 8 }}>
          {!!msg && (
            <View style={{ paddingHorizontal: 14, paddingVertical: 6 }}>
              <Text numberOfLines={2} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12 }}>{msg.content.trim() || (msg.image_url ? "Photo" : "")} · {fmtTime(msg.created_at)}</Text>
            </View>
          )}
          {reactions.length > 0 && (
            <View style={{ flexDirection: "row", justifyContent: "space-around", paddingVertical: 6, marginBottom: 4, borderBottomWidth: 1, borderColor: colors.hairline }}>
              {reactions.map((e) => (
                <Pressable key={e} onPress={() => onReact(e)} style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: myReactions.has(e) ? "#2a2410" : "transparent", borderWidth: myReactions.has(e) ? 1 : 0, borderColor: YELLOW }}>
                  <Text style={{ fontSize: 24 }}>{e}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {row("arrow-undo-outline", "Reply", onReply)}
          {!!msg?.content.trim() && row("copy-outline", "Copy text", onCopy)}
          {canUnsend && row("close-circle-outline", "Unsend for everyone", onUnsend, true)}
          {showDelete && row("trash-outline", "Delete for you", onDelete, true)}
          <Pressable onPress={onClose} style={{ height: 40, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.muted, fontFamily: fonts.semi, fontSize: 13.5 }}>Cancel</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* The conversation's top bar: back, the picture and the name, actions. */
export function ChatHeader({ left, title, sub, onTitle, right }: { left: ReactNode; title: string; sub?: string; onTitle?: () => void; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#1f1f26" }}>
      <View style={{ height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 6 }}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.navigate("/messages"))} hitSlop={8} accessibilityLabel="Back" style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable onPress={onTitle} disabled={!onTitle} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 9, minWidth: 0 }}>
          {left}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 16 }}>{title}</Text>
            {!!sub && <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>{sub}</Text>}
          </View>
        </Pressable>
        {right}
      </View>
    </View>
  );
}
