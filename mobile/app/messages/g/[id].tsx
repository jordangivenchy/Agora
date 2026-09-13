/* A group chat (the site's GroupThread): the messages with names over
   runs and system lines for membership, the typing strip with names,
   the composer; the group's info up top — rename, members, add, leave. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../../src/supabase";
import { useSession } from "../../../src/session";
import { displayName, fetchGroupMembers, fetchGroupMessages, fetchGroups, markGroupRead, sendGroupMessage, unsendGroupMessage, UNSEND_WINDOW_MS, type GroupMember, type GroupMemberRow, type GroupMsg, type GroupRow } from "../../../src/messages";
import { ChatHeader, ChatThread } from "../../../src/chatThread";
import { GroupTile } from "../../../src/groupTile";
import { GroupInfoSheet } from "../../../src/groupInfo";
import { uploadPostImage } from "../../../src/postImages";
import { LoadingLine } from "../../../src/sky";
import { colors } from "../../../src/theme";
import { Screen } from "../../../src/ui";
import { Alert } from "react-native";

const UNKNOWN: GroupMember = { id: "", username: "someone", display_name: "Someone", avatar_url: null };

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const chatId = typeof id === "string" ? id : "";
  const { session } = useSession();
  const me = session?.user.id ?? null;
  const [chat, setChat] = useState<GroupRow | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<GroupMemberRow[]>([]);
  const [extra, setExtra] = useState<Map<string, GroupMember>>(new Map());
  const [msgs, setMsgs] = useState<GroupMsg[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [typing, setTyping] = useState<Map<string, string>>(new Map());
  const [info, setInfo] = useState(false);
  const typingChan = useRef<RealtimeChannel | null>(null);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const myName = useRef("");

  useEffect(() => {
    if (!me) { router.replace("/sign-in"); return; }
    let on = true;
    void fetchGroups(supabase).then((gs) => { if (!on) return; const g = gs.find((x) => x.chat_id === chatId) ?? null; setChat(g); if (g) setName(g.name); });
    return () => { on = false; };
  }, [chatId, me]);

  const loadMembers = useCallback(async () => {
    const rows = await fetchGroupMembers(supabase, chatId);
    setMembers(rows);
    const mine = rows.find((m) => m.id === me);
    if (mine) myName.current = displayName(mine);
  }, [chatId, me]);

  const load = useCallback(async () => {
    const [rows] = await Promise.all([fetchGroupMessages(supabase, chatId), loadMembers()]);
    setMsgs(rows);
    void markGroupRead(supabase, chatId);
  }, [chatId, loadMembers]);
  useEffect(() => { if (chat) void load(); }, [chat, load]);

  useEffect(() => {
    if (!members.length) return;
    const missing = [...new Set(msgs.map((m) => m.sender_id).filter((x): x is string => !!x && x !== me && !members.some((mm) => mm.id === x) && !extra.has(x)))];
    if (!missing.length) return;
    void supabase.from("users").select("id, username, display_name, avatar_url").in("id", missing).then(({ data }) => {
      if (!data?.length) return;
      setExtra((cur) => { const next = new Map(cur); for (const u of data as GroupMember[]) next.set(u.id, u); return next; });
    });
  }, [msgs, members, extra, me]);

  useEffect(() => {
    if (!me || !chat) return;
    const channel = supabase
      .channel(`group-thread-app-${chatId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages", filter: `chat_id=eq.${chatId}` }, (payload) => {
        const m = payload.new as GroupMsg;
        setMsgs((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
        if (m.kind === "system") {
          const renamed = /^renamed the group to “(.+)”$/.exec(m.content);
          if (renamed) setName(renamed[1]);
          void loadMembers();
        }
        if (m.sender_id !== me) {
          if (m.sender_id) setTyping((t) => { if (!t.has(m.sender_id!)) return t; const n = new Map(t); n.delete(m.sender_id!); return n; });
          if (m.kind === "text") void markGroupRead(supabase, chatId);
        }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "group_messages" }, (payload) => {
        const oldId = (payload.old as { id?: string } | null)?.id;
        if (oldId) setMsgs((xs) => xs.filter((x) => x.id !== oldId));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "group_chat_members" }, (payload) => {
        const old = payload.old as { chat_id?: string; user_id?: string } | null;
        if (old?.chat_id !== chatId) return;
        if (old.user_id === me) router.back();
        else void loadMembers();
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") void load(); });
    return () => { void supabase.removeChannel(channel); };
  }, [me, chat, chatId, load, loadMembers]);

  useEffect(() => {
    if (!me) return;
    const timers = typingTimers.current;
    const ch = supabase
      .channel(`group-typing-${chatId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const p = payload as { from?: string; name?: string } | null;
        if (!p?.from || p.from === me) return;
        const from = p.from;
        setTyping((t) => { const n = new Map(t); n.set(from, p.name || "Someone"); return n; });
        const prev = timers.get(from);
        if (prev) clearTimeout(prev);
        timers.set(from, setTimeout(() => { timers.delete(from); setTyping((t) => { const n = new Map(t); n.delete(from); return n; }); }, 3500));
      })
      .subscribe();
    typingChan.current = ch;
    return () => { typingChan.current = null; for (const t of timers.values()) clearTimeout(t); timers.clear(); void supabase.removeChannel(ch); };
  }, [me, chatId]);

  if (!me) return null;
  if (chat === undefined) return <Screen><LoadingLine /></Screen>;
  if (chat === null) return <Screen><ChatHeader left={null} title="You're not in this group" /></Screen>;

  const who = (uid: string | null): GroupMember => (!uid ? UNKNOWN : members.find((m) => m.id === uid) ?? extra.get(uid) ?? { ...UNKNOWN, id: uid });
  const others = members.filter((m) => m.id !== me);
  const tileMembers: GroupMember[] = members.length ? [...others, ...members.filter((m) => m.id === me)] : chat.members;
  const memberCount = members.length || chat.member_count;
  const names = [...typing.values()];
  const typingLabel = names.length === 0 ? null : names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : "Several people are typing…";

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ChatHeader
        left={<GroupTile members={tileMembers} size={40} />}
        title={name}
        sub={others.length ? others.map((m) => displayName(m)).join(", ") : `${memberCount} member${memberCount === 1 ? "" : "s"}`}
        onTitle={() => setInfo(true)}
        right={<Pressable onPress={() => setInfo(true)} hitSlop={8} accessibilityLabel="Group info" style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}><Ionicons name="information-circle-outline" size={22} color="rgba(255,255,255,0.7)" /></Pressable>}
      />
      <ChatThread
        me={me}
        msgs={msgs}
        who={who}
        canUnsend={(m) => m.sender_id === me && m.kind === "text" && Date.now() - new Date(m.created_at).getTime() < UNSEND_WINDOW_MS}
        onUnsend={(m) => Alert.alert("Unsend this message?", "It will be removed for everyone in the group.", [
          { text: "Cancel", style: "cancel" },
          { text: "Unsend", style: "destructive", onPress: () => { setMsgs((xs) => xs.filter((x) => x.id !== m.id)); void unsendGroupMessage(supabase, m.id).then((ok) => { if (!ok) setMsgs((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m as GroupMsg].sort((a, b) => a.created_at.localeCompare(b.created_at)))); }); } },
        ])}
        typingLabel={typingLabel}
        onSend={async (text, imageUrl, replyTo) => {
          setSendError(null);
          const r = await sendGroupMessage(supabase, me, chatId, text, imageUrl, replyTo);
          if (r.error || !r.msg) { setSendError(r.error ?? "Couldn't send."); return false; }
          const msg = r.msg;
          setMsgs((xs) => (xs.some((x) => x.id === msg.id) ? xs : [...xs, msg]));
          return true;
        }}
        onTyping={() => { if (typingChan.current?.state === "joined") void typingChan.current.send({ type: "broadcast", event: "typing", payload: { from: me, name: myName.current } }); }}
        sendError={sendError}
        emptyText="Say hi to the group 👋"
        uploadImage={(img) => uploadPostImage(me, img)}
      />
      <GroupInfoSheet
        open={info}
        chatId={chatId}
        name={name}
        me={me}
        members={members}
        onClose={() => setInfo(false)}
        onRenamed={setName}
        onMembersChanged={() => void loadMembers()}
        onLeft={() => { setInfo(false); router.back(); }}
      />
    </View>
  );
}
