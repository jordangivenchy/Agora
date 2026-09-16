/* The room's chat (components/agora/AgoraSidebar.tsx) as a sheet: the
   same room_messages rows and realtime channel the site reads, the
   rules gate before the first message (remembered on this phone), the
   composer, and the Q&A tab that is still to come. Tap a name for the
   person. */
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Img } from "./img";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { useUserMenu } from "./userMenu";
import { BODY_MIN, cleanTextError } from "./cleanText";
import { LinkedText } from "./linkText";
import { colors, fonts } from "./theme";

interface Message {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  user?: { username: string; display_name?: string | null; avatar_url: string | null } | { username: string; display_name?: string | null; avatar_url: string | null }[] | null;
}

const USER_COLORS = ["#5865f2", "#eb459e", "#23a559", "#e2a83a", "#ed4245", "#9c84ef", "#3ba3d0", "#c87941", "#2d7d46", "#4752c4"];
function userColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
const CHAT_RULES = ["Be respectful", "No interruptions", "Stay on topic", "Listen to others", "No personal attacks"];
const CHAT_JOINED_KEY = "agora-chat-joined";
const MSG_MAX = 200;
const userOf = (m: Message) => (Array.isArray(m.user) ? m.user[0] ?? null : m.user ?? null);

/** The messages and the channel, kept while the room is open so the badge can count. */
export function useRoomChat(roomId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const fetchMessages = useCallback(async () => {
    const { data } = await supabase.from("room_messages").select("id, user_id, content, created_at, user:users(username, display_name, avatar_url)").eq("room_id", roomId).order("created_at", { ascending: true }).limit(100);
    if (data) setMessages(data as unknown as Message[]);
  }, [roomId]);
  useEffect(() => {
    void fetchMessages();
    const channel = supabase
      .channel(`app-chat-${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` }, () => void fetchMessages())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchMessages, roomId]);
  return messages;
}

export function RoomChatSheet({ open, onClose, roomId, meId, messages }: { open: boolean; onClose: () => void; roomId: string; meId: string | null; messages: Message[] }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { openUserMenu } = useUserMenu();
  const [tab, setTab] = useState<"chat" | "qa">("chat");
  const [joined, setJoined] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    AsyncStorage.getItem(CHAT_JOINED_KEY).then((v) => setJoined(v === "1"), () => setJoined(false));
  }, []);

  const joinChat = () => {
    setJoined(true);
    AsyncStorage.setItem(CHAT_JOINED_KEY, "1").catch(() => undefined);
  };

  const send = async () => {
    if (!meId || !input.trim() || sending) return;
    const text = input.trim();
    const issue = cleanTextError(text, BODY_MIN);
    if (issue) { setError(issue); return; }
    setSending(true);
    setError(null);
    const { error: err } = await supabase.from("room_messages").insert({ room_id: roomId, user_id: meId, content: text });
    setSending(false);
    if (err) { setError(err.message); return; }
    setInput("");
  };

  const person = (m: Message) => {
    const u = userOf(m);
    onClose();
    setTimeout(() => openUserMenu({ userId: m.user_id, username: u?.username ?? "user", displayName: u?.display_name ?? null }, { chat: { roomId, messageId: m.id, messagePreview: m.content.slice(0, 140) } }), 320);
  };

  const rows = [...messages].reverse();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1 }} accessibilityLabel="Close chat" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ height: Math.round(height * 0.62), backgroundColor: "#0b0b0d", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: "#26262e" }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#1f1f26" }}>
            {(["chat", "qa"] as const).map((k) => (
              <Pressable key={k} onPress={() => setTab(k)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: tab === k ? "#1b1b21" : "transparent" }}>
                <Text style={{ color: tab === k ? colors.text : colors.muted, fontFamily: fonts.semi, fontSize: 12.5 }}>{k === "chat" ? "Chat" : "Q&A"}</Text>
              </Pressable>
            ))}
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Hide chat" style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="chevron-down" size={20} color={colors.muted} />
            </Pressable>
          </View>

          {tab === "chat" ? (
            <>
              <FlatList
                ref={listRef}
                inverted
                data={rows}
                keyExtractor={(m) => m.id}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<View style={{ transform: [{ scaleY: -1 }], paddingVertical: 24, alignItems: "center" }}><Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 12.5 }}>No messages yet — say hello.</Text></View>}
                renderItem={({ item: m }) => {
                  const u = userOf(m);
                  const name = u?.display_name?.trim() || u?.username || "User";
                  return (
                    <View style={{ flexDirection: "row", gap: 8, paddingVertical: 5 }}>
                      <Pressable onPress={() => person(m)} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: userColor(m.user_id), overflow: "hidden", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                        {u?.avatar_url ? (
                          <Img uri={u.avatar_url} style={{ width: 26, height: 26 }} />
                        ) : (
                          <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 12 }}>{name.charAt(0).toUpperCase()}</Text>
                        )}
                      </Pressable>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                          <Text onPress={() => person(m)} numberOfLines={1} style={{ color: userColor(m.user_id), fontFamily: fonts.semi, fontSize: 12.5, flexShrink: 1 }}>{name}</Text>
                          <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 10 }}>{fmtTime(m.created_at)}</Text>
                        </View>
                        <LinkedText text={m.content} beforeOpen={onClose} style={{ color: "#e6e6ee", fontFamily: fonts.body, fontSize: 13, lineHeight: 18 }} />
                      </View>
                    </View>
                  );
                }}
              />
              {joined === false ? (
                <View style={{ padding: 14, paddingBottom: insets.bottom + 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#1f1f26", backgroundColor: "#0e0e11" }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: 13.5 }}>Chat rules</Text>
                  <View style={{ marginTop: 6, gap: 3 }}>
                    {CHAT_RULES.map((r) => <Text key={r} style={{ color: "#c9c9d2", fontFamily: fonts.body, fontSize: 12.5 }}>· {r}</Text>)}
                  </View>
                  <Pressable onPress={joinChat} style={{ marginTop: 12, height: 40, borderRadius: 20, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: colors.ink, fontFamily: fonts.bold, fontSize: 13.5 }}>Join chat</Text>
                  </Pressable>
                  <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11, marginTop: 8, textAlign: "center" }}>Joining confirms you've read the rules.</Text>
                </View>
              ) : joined === true ? (
                meId ? (
                  <View style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: insets.bottom + 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#1f1f26", backgroundColor: "#0e0e11" }}>
                    {error && <Text style={{ color: "#fca5a5", fontFamily: fonts.body, fontSize: 11.5, marginBottom: 6 }}>{error}</Text>}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <TextInput
                        value={input}
                        onChangeText={(t) => { setInput(t.slice(0, MSG_MAX)); if (error) setError(null); }}
                        placeholder="Message #discussion-chat"
                        placeholderTextColor={colors.faint}
                        onSubmitEditing={() => void send()}
                        returnKeyType="send"
                        blurOnSubmit={false}
                        style={{ flex: 1, height: 40, borderRadius: 20, paddingHorizontal: 14, backgroundColor: "#141418", borderWidth: 1, borderColor: "#2a2a33", color: colors.text, fontFamily: fonts.body, fontSize: 14 }}
                      />
                      <Pressable onPress={() => void send()} disabled={!input.trim() || sending} accessibilityLabel="Send" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: input.trim() ? colors.yellow : "#1b1b21", alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="arrow-up" size={18} color={input.trim() ? colors.ink : colors.faint} />
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={{ padding: 14, paddingBottom: insets.bottom + 12, alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#1f1f26" }}>
                    <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>Sign in to chat</Text>
                  </View>
                )
              ) : null}
            </>
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 }}>
              <Ionicons name="help-circle-outline" size={28} color={colors.faint} />
              <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13, textAlign: "center" }}>Audience questions will appear here.</Text>
              <Text style={{ color: colors.faint, fontFamily: fonts.body, fontSize: 11.5 }}>Q&A is coming soon.</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

