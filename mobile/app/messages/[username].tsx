/* A direct message thread (the site's DmThread): the messages, read
   receipts, reactions, replies, pictures and invites, the typing strip,
   the composer; the ⋯ up top with the site's chat options. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { acceptInvite, displayName, dmDeleteForMe, dmDeleteThread, fetchDmReactions, fetchDms, fetchInviteMeta, markDmRead, resolvePeer, sendDm, setDmReaction, unsendDm, UNSEND_WINDOW_MS, type Dm, type InviteMeta, type Peer, type Reaction } from "../../src/messages";
import { ChatHeader, ChatThread } from "../../src/chatThread";
import { Avatar } from "../../src/avatar";
import { ActionSheet, type SheetAction } from "../../src/actionSheet";
import { ReportSheet, type ReportTarget } from "../../src/report";
import { NewGroupSheet } from "../../src/newGroup";
import { uploadPostImage } from "../../src/postImages";
import { setFollowing } from "../../src/profile";
import { LoadingLine } from "../../src/sky";
import { showToast } from "../../src/toast";
import { colors } from "../../src/theme";
import { Screen } from "../../src/ui";

export default function DmScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { session } = useSession();
  const me = session?.user.id ?? null;
  const [peer, setPeer] = useState<Peer | null | undefined>(undefined);
  useEffect(() => {
    if (!me) { router.replace("/sign-in"); return; }
    let on = true;
    void resolvePeer(supabase, typeof username === "string" ? username : "").then((p) => { if (on) setPeer(p); });
    return () => { on = false; };
  }, [username, me]);
  if (!me) return null;
  if (peer === undefined) return <Screen><LoadingLine /></Screen>;
  if (peer === null) return <Screen><ChatHeader left={null} title="No one by that name" /></Screen>;
  return <DmThreadScreen me={me} peer={peer} />;
}

function DmThreadScreen({ me, peer }: { me: string; peer: Peer }) {
  const [msgs, setMsgs] = useState<Dm[]>([]);
  const [reactions, setReactions] = useState<Map<string, Reaction[]>>(new Map());
  const [peerTyping, setPeerTyping] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [inviteMeta, setInviteMeta] = useState<Map<string, InviteMeta>>(new Map());
  const [joining, setJoining] = useState<string | null>(null);
  const [options, setOptions] = useState(false);
  const [rel, setRel] = useState<{ is_following: boolean; is_followed_by: boolean; is_friend: boolean } | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  const typingChan = useRef<RealtimeChannel | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const rows = await fetchDms(supabase, peer.id);
    setMsgs(rows);
    void markDmRead(supabase, peer.id);
    setReactions(await fetchDmReactions(supabase, rows.map((r) => r.id)));
  }, [peer.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`dm-thread-app-${peer.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${me}` }, (payload) => {
        const m = payload.new as Dm;
        if (m.sender_id !== peer.id) return;
        setMsgs((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
        setPeerTyping(false);
        void markDmRead(supabase, m.sender_id);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "direct_messages", filter: `sender_id=eq.${me}` }, (payload) => {
        const m = payload.new as Dm;
        setMsgs((xs) => (xs.some((x) => x.id === m.id && x.read_at !== m.read_at) ? xs.map((x) => (x.id === m.id ? { ...x, read_at: m.read_at } : x)) : xs));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "direct_messages" }, (payload) => {
        const oldId = (payload.old as { id?: string } | null)?.id;
        if (oldId) setMsgs((xs) => xs.filter((x) => x.id !== oldId));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_reactions" }, (payload) => {
        const r = payload.new as Reaction & { message_id: string };
        setReactions((map) => {
          const list = map.get(r.message_id) ?? [];
          if (list.some((x) => x.user_id === r.user_id && x.emoji === r.emoji)) return map;
          const next = new Map(map);
          next.set(r.message_id, [...list, { user_id: r.user_id, emoji: r.emoji }]);
          return next;
        });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "dm_reactions" }, (payload) => {
        const r = payload.old as Partial<Reaction & { message_id: string }> | null;
        if (!r?.message_id || !r.user_id || !r.emoji) return;
        setReactions((map) => {
          const list = map.get(r.message_id!);
          if (!list) return map;
          const next = new Map(map);
          next.set(r.message_id!, list.filter((x) => !(x.user_id === r.user_id && x.emoji === r.emoji)));
          return next;
        });
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") void load(); });
    return () => { void supabase.removeChannel(channel); };
  }, [me, peer.id, load]);

  useEffect(() => {
    const ch = supabase
      .channel(`dm-typing-${[me, peer.id].sort().join("-")}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if ((payload as { from?: string } | null)?.from !== peer.id) return;
        setPeerTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setPeerTyping(false), 3500);
      })
      .subscribe();
    typingChan.current = ch;
    return () => { typingChan.current = null; if (typingTimer.current) clearTimeout(typingTimer.current); void supabase.removeChannel(ch); };
  }, [me, peer.id]);

  useEffect(() => {
    const ids = [...new Set(msgs.map((m) => m.community_id).filter((x): x is string => !!x))].filter((id) => !inviteMeta.has(id));
    if (!ids.length) return;
    void fetchInviteMeta(supabase, me, ids).then((meta) => setInviteMeta((prev) => new Map([...prev, ...meta])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, me]);

  const lastMineReadId = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].sender_id === me) return msgs[i].read_at ? msgs[i].id : null;
    return null;
  }, [msgs, me]);

  const who = useCallback((id: string | null) => (id === peer.id ? peer : { id: me, username: "you", display_name: "You", avatar_url: null }), [peer, me]);

  const onSend = async (text: string, imageUrl: string | null, replyTo: string | null) => {
    setSendError(null);
    const r = await sendDm(supabase, me, peer.id, text, imageUrl, replyTo);
    if (r.error || !r.dm) { setSendError(r.error ?? "Couldn't send."); return false; }
    const dm = r.dm;
    setMsgs((xs) => (xs.some((x) => x.id === dm.id) ? xs : [...xs, dm]));
    return true;
  };

  const onReact = async (messageId: string, emoji: string) => {
    const had = (reactions.get(messageId) ?? []).some((r) => r.user_id === me && r.emoji === emoji);
    const flip = (on: boolean) => setReactions((map) => {
      const list = map.get(messageId) ?? [];
      const next = new Map(map);
      next.set(messageId, on ? [...list, { user_id: me, emoji }] : list.filter((r) => !(r.user_id === me && r.emoji === emoji)));
      return next;
    });
    flip(!had);
    if (!(await setDmReaction(supabase, me, messageId, emoji, !had))) flip(had);
  };

  const confirm = (title: string, body: string, button: string, run: () => void) =>
    Alert.alert(title, body, [{ text: "Cancel", style: "cancel" }, { text: button, style: "destructive", onPress: run }]);

  const loadRel = async () => {
    const { data } = await supabase.rpc("get_user_profile", { p_user: peer.id });
    const row = (Array.isArray(data) ? data[0] : data) as { is_following?: boolean; is_followed_by?: boolean; is_friend?: boolean } | null;
    setRel({ is_following: !!row?.is_following, is_followed_by: !!row?.is_followed_by, is_friend: !!row?.is_friend });
  };

  const optionActions: SheetAction[] = [
    { label: "View profile", onPress: () => router.push({ pathname: "/u/[username]", params: { username: peer.username } }) },
    { label: rel?.is_following ? "Following" : rel?.is_followed_by ? "Add friend back" : "Add friend", onPress: () => void setFollowing(supabase, peer.id, !rel?.is_following).then(loadRel).catch(() => showToast("Couldn't do that.")) },
    ...(rel?.is_friend ? [{ label: `New group with @${peer.username}`, onPress: () => setNewGroup(true) }] : []),
    { label: "Delete conversation", danger: true, onPress: () => confirm("Delete this conversation?", "Every message here is removed for you — the other person keeps their copy.", "Delete for you", () => void dmDeleteThread(supabase, peer.id).then(({ error }) => { if (error) showToast("Couldn't delete the conversation."); else router.back(); })) },
    { label: `Block @${peer.username}`, danger: true, onPress: () => confirm(`Block @${peer.username}?`, "You'll unfollow each other and they can't message you. Undo it any time from Settings.", "Block", () => void supabase.rpc("block_user", { p_target: peer.id }).then(({ error }) => { if (error) showToast("Couldn't block them."); else router.back(); })) },
    { label: `Report @${peer.username}`, danger: true, onPress: () => setReport({ userId: peer.id, username: peer.username, context: "profile" }) },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ChatHeader
        left={<Avatar url={peer.avatar_url} name={peer.username} size={40} />}
        title={displayName(peer)}
        sub={`@${peer.username}`}
        onTitle={() => router.push({ pathname: "/u/[username]", params: { username: peer.username } })}
        right={<Pressable onPress={() => { setOptions(true); if (!rel) void loadRel(); }} hitSlop={8} accessibilityLabel="Chat options" style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}><Ionicons name="ellipsis-horizontal" size={20} color="rgba(255,255,255,0.7)" /></Pressable>}
      />
      <ChatThread
        me={me}
        msgs={msgs}
        who={who}
        reactions={reactions}
        onReact={(id, e) => void onReact(id, e)}
        canUnsend={(m) => m.sender_id === me && now - new Date(m.created_at).getTime() < UNSEND_WINDOW_MS}
        onUnsend={(m) => confirm("Unsend this message?", "It will be removed for both of you.", "Unsend", () => {
          setMsgs((xs) => xs.filter((x) => x.id !== m.id));
          void unsendDm(supabase, m.id).then((ok) => { if (!ok) setMsgs((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m as Dm].sort((a, b) => a.created_at.localeCompare(b.created_at)))); });
        })}
        onDeleteForMe={(m) => confirm("Delete this message?", "It will only be removed for you — the other person keeps it.", "Delete for you", () => { setMsgs((xs) => xs.filter((x) => x.id !== m.id)); void dmDeleteForMe(supabase, m.id); })}
        typingLabel={peerTyping ? `@${peer.username} is typing…` : null}
        lastMineReadId={lastMineReadId}
        onSend={onSend}
        onTyping={() => { if (typingChan.current?.state === "joined") void typingChan.current.send({ type: "broadcast", event: "typing", payload: { from: me } }); }}
        sendError={sendError}
        emptyText={`Say hi to @${peer.username} 👋`}
        inviteMeta={inviteMeta}
        joining={joining}
        onAcceptInvite={(communityId) => {
          setJoining(communityId);
          void acceptInvite(supabase, communityId).then(({ error }) => {
            setJoining(null);
            if (error) showToast("Couldn't join.");
            else setInviteMeta((prev) => { const next = new Map(prev); const b = next.get(communityId); if (b) next.set(communityId, { ...b, joined: true }); return next; });
          });
        }}
        uploadImage={(img) => uploadPostImage(me, img)}
      />
      <ActionSheet open={options} title={displayName(peer)} sub={`@${peer.username}`} onClose={() => setOptions(false)} actions={optionActions} />
      <ReportSheet target={report} onClose={() => setReport(null)} />
      <NewGroupSheet open={newGroup} onClose={() => setNewGroup(false)} initialMembers={[peer.id]} onCreated={(chatId) => { setNewGroup(false); router.replace({ pathname: "/messages/g/[id]", params: { id: chatId } }); }} />
    </View>
  );
}
