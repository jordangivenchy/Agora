/* The room on a phone (app/agora/[id]/page.tsx, flat): the top bar with
   the host, Follow, About and the room's menu; the tag line — live, the
   clock, the audience, the field, the community; the motion; the
   pictures; the hands and the listeners; the queue pill and the host's
   button; the cards; the control pill. The sheets hang off it. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Share, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "./supabase";
import { Avatar } from "./avatar";
import { ActionSheet, type SheetAction } from "./actionSheet";
import { useUserMenu } from "./userMenu";
import { ReportSheet, type ReportTarget } from "./report";
import { host as seatHost } from "./seats";
import { fmtElapsed, frameNewsKey, roomHost, roomLink, setSeatMuted, type PendingInvite, type RoomDetail, type RoomFraming } from "./roomData";
import type { CallApi } from "./roomCall";
import { ROLE_LABEL, deriveStageRole, isHostRole, onStage, seatName, seatUser, sortRequests, type Seat, type StageRole } from "./stageModel";
import { StageView, type StageActions } from "./stageView";
import { StageTiles, type StageTile } from "./roomTiles";
import { ReactionOverlay } from "./reactions";
import { CONTROLS_H, RoomControls, copyRoomLink, useSavedLayout } from "./roomControls";
import { RoomChatSheet, useRoomChat } from "./roomChat";
import { RoomFrameSheet } from "./roomFrame";
import { HostControlsSheet } from "./hostControls";
import { CallSettingsSheet } from "./callSettings";
import { EndedCard, HostButton, InviteCard, MediaErrorCard, NoteRequestSheet, QueuePill } from "./roomCards";
import { BroadcastView } from "./broadcast";
import { topicOf } from "./topics";
import { colors, fonts } from "./theme";

export interface RoomBodyProps {
  room: RoomDetail;
  seats: Seat[];
  meId: string | null;
  myRole: StageRole;
  mySeat: Seat | null;
  call: CallApi;
  duel: boolean;
  communityName: string | null;
  handRaised: boolean;
  handBusy: boolean;
  onToggleHand: () => void;
  onStepDown: () => void;
  invite: PendingInvite | null;
  inviteBusy: boolean;
  onRespondInvite: (accept: boolean) => void;
  onLeave: () => void;
  onRefresh: () => void;
  following: boolean;
  followBusy: boolean;
  onToggleFollow: () => void;
  onFraming: (f: RoomFraming) => void;
  ended: boolean;
  onWatchReplay: () => void;
  onHome: () => void;
}

const rank = (r: StageRole) => (r === "host" ? 0 : r === "cohost" ? 1 : 2);

export function RoomBody(p: RoomBodyProps) {
  const { room, seats, meId, myRole, call } = p;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { openUserMenu } = useUserMenu();
  const [layout, setLayout] = useSavedLayout();
  const [pinned, setPinned] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [seenChat, setSeenChat] = useState(0);
  const [frameOpen, setFrameOpen] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [topMenu, setTopMenu] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [tileSheet, setTileSheet] = useState<{ seat: Seat; role: StageRole } | null>(null);
  const messages = useRoomChat(room.id);
  useEffect(() => { if (chatOpen) setSeenChat(messages.length); }, [chatOpen, messages.length]);
  const chatBadge = chatOpen ? 0 : Math.max(0, messages.length - seenChat);

  /* The clock. */
  const from = room.started_at ?? room.created_at;
  const [elapsed, setElapsed] = useState(() => fmtElapsed(from));
  useEffect(() => {
    setElapsed(fmtElapsed(from));
    const t = setInterval(() => setElapsed(fmtElapsed(from)), 1000);
    return () => clearInterval(t);
  }, [from]);

  /* The frame moved since I last looked: the dot on About. */
  const frameKey = frameNewsKey(room.framing);
  const [seenFrame, setSeenFrame] = useState(frameKey);
  useEffect(() => { if (frameOpen) setSeenFrame(frameKey); }, [frameOpen, frameKey]);
  const frameNews = !frameOpen && frameKey !== seenFrame;

  const hostUser = roomHost(room);
  const isHostViewer = !!meId && meId === room.host_id;
  const canManage = !!meId && isHostRole(myRole) && !p.duel;
  const topic = room.topic_key ? topicOf(room.topic_key) : null;

  const withRole = useMemo(() => seats.filter((s) => !s.left_at).map((s) => ({ s, role: deriveStageRole(s, room.host_id) })), [seats, room.host_id]);
  const stageSeats = useMemo(() => withRole.filter((x) => onStage(x.role)).sort((a, b) => rank(a.role) - rank(b.role) || a.s.joined_at.localeCompare(b.s.joined_at)), [withRole]);
  const audienceCount = Math.max(room.viewer_count ?? 0, withRole.filter((x) => !onStage(x.role) && !x.s.hand_raised_at && x.s.user_id !== room.mic_user_id).length);
  const requests = useMemo(() => sortRequests(withRole.filter((x) => !onStage(x.role) && !!x.s.hand_raised_at).map((x) => x.s)), [withRole]);
  const queue = useMemo(() => sortRequests(withRole.filter((x) => !!x.s.hand_raised_at && x.s.user_id !== room.mic_user_id && !isHostRole(x.role)).map((x) => x.s)), [withRole, room.mic_user_id]);
  const amMicHolder = !!meId && room.mic_user_id === meId;
  const myQueuePos = useMemo(() => { if (!meId) return null; const i = queue.findIndex((s) => s.user_id === meId); return i < 0 ? null : i + 1; }, [queue, meId]);

  /* Every on-stage person gets a tile — the live camera when they have one, the avatar plate otherwise; shares ride along. */
  const tiles = useMemo<StageTile[]>(() => {
    const out: StageTile[] = [];
    const cams = call.tiles.filter((t) => t.source === "camera");
    for (const { s, role } of stageSeats) {
      const u = seatUser(s);
      const cam = cams.find((t) => t.identity === s.user_id) ?? null;
      const local = s.user_id === meId;
      out.push({ key: `${s.user_id}:camera`, identity: s.user_id, username: seatName(s), handle: u?.username ?? null, avatarUrl: u?.avatar_url ?? null, local, source: "camera", micMuted: local ? !call.micOn : !!s.mic_muted, roleLabel: ROLE_LABEL[role], call: cam });
    }
    for (const t of cams) {
      if (out.some((o) => o.identity === t.identity)) continue;
      out.push({ key: t.key, identity: t.identity, username: t.local ? "You" : "Speaker", handle: null, avatarUrl: null, local: t.local, source: "camera", micMuted: false, roleLabel: "Speaker", call: t });
    }
    for (const t of call.tiles.filter((x) => x.source === "screen")) {
      const s = seats.find((x) => x.user_id === t.identity);
      out.push({ key: t.key, identity: t.identity, username: s ? seatName(s) : "Screen", handle: s ? seatUser(s)?.username ?? null : null, avatarUrl: null, local: t.local, source: "screen", micMuted: false, roleLabel: "Screen", call: t });
    }
    return out;
  }, [stageSeats, call.tiles, call.micOn, meId, seats]);

  const openPerson = (userId: string, username: string | null, displayName: string | null, isDebater: boolean) => {
    openUserMenu({ userId, username: username ?? "user", displayName }, {
      room: {
        roomId: room.id, isHost: false, targetIsDebater: isDebater, targetIsSpectator: !isDebater,
        audioMutedLocally: call.mutedLocally.has(userId), cameraHiddenLocally: call.hiddenCameras.has(userId),
        onToggleLocalMute: () => call.toggleLocalMute(userId), onToggleHideCamera: () => call.toggleHideCamera(userId),
      },
    });
  };
  const onPressTile = (t: StageTile) => {
    if (t.source === "screen" || t.local) return;
    const seat = seats.find((s) => s.user_id === t.identity);
    const role = seat ? deriveStageRole(seat, room.host_id) : "speaker";
    if (canManage && seat && role !== "host") setTileSheet({ seat, role });
    else openPerson(t.identity, t.handle, t.username, true);
  };
  const hostActions = useMemo<StageActions | null>(() => canManage ? {
    bringUp: (s) => void seatHost.bringUp(supabase, s.id).then(p.onRefresh),
    dismiss: (s) => void seatHost.dismiss(supabase, s.id).then(p.onRefresh),
    toAudience: (s) => void seatHost.toAudience(supabase, s.id).then(p.onRefresh),
    makeCohost: (s, make) => void seatHost.setCohost(supabase, s.id, make).then(p.onRefresh),
  } : null, [canManage, p.onRefresh]);
  const tileActions: SheetAction[] = tileSheet ? [
    { label: tileSheet.seat.mic_muted ? "Unmute" : "Mute", onPress: () => void setSeatMuted(supabase, tileSheet.seat.id, !tileSheet.seat.mic_muted).then(p.onRefresh) },
    ...(tileSheet.role === "speaker" && isHostViewer ? [{ label: "Make co-host", onPress: () => void seatHost.setCohost(supabase, tileSheet.seat.id, true).then(p.onRefresh) }] : []),
    ...(tileSheet.role === "cohost" && isHostViewer ? [{ label: "Back to speaker", onPress: () => void seatHost.setCohost(supabase, tileSheet.seat.id, false).then(p.onRefresh) }] : []),
    { label: "Send to the audience", danger: true, onPress: () => void seatHost.toAudience(supabase, tileSheet.seat.id).then(p.onRefresh) },
    { label: "More…", onPress: () => openPerson(tileSheet.seat.user_id, seatUser(tileSheet.seat)?.username ?? null, seatName(tileSheet.seat), true) },
  ] : [];

  const shareRoom = () => void Share.share({ message: room.motion, url: roomLink(room) }).catch(() => undefined);
  const reportHost = () => setReport({ userId: room.host_id, username: hostUser?.username ?? "host", context: "room", roomId: room.id });
  const controlsBand = CONTROLS_H + 8 + insets.bottom;
  const stageH = Math.max(160, Math.min(width * 1.05, height - controlsBand - 260));
  const hlsAudience = !!call.hls;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* ── Top bar ── */}
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))} hitSlop={8} accessibilityLabel="Back" style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center", marginLeft: -6 }}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          {hostUser?.username && (
            <Pressable onPress={() => router.push({ pathname: "/u/[username]", params: { username: hostUser.username! } })} accessibilityLabel="The host's profile" style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingLeft: 3, paddingRight: 10, borderRadius: 999, backgroundColor: "#0e0e11", borderWidth: 1, borderColor: "#2a2a33", maxWidth: 150 }}>
              <Avatar url={hostUser.avatar_url} name={hostUser.display_name || hostUser.username} size={22} />
              <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 11.5, flexShrink: 1 }}>{hostUser.display_name?.trim() || hostUser.username}</Text>
            </Pressable>
          )}
          {!isHostViewer && (
            <Pressable onPress={p.onToggleFollow} disabled={p.followBusy} style={{ height: 30, paddingHorizontal: 10, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: p.following ? "#141418" : colors.yellow, borderWidth: 1, borderColor: p.following ? "#2a2a33" : colors.yellow, opacity: p.followBusy ? 0.6 : 1 }}>
              <Text style={{ color: p.following ? colors.text : colors.ink, fontFamily: fonts.bold, fontSize: 11.5 }}>{p.following ? "Following ✓" : "Follow"}</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setFrameOpen(true)} accessibilityLabel="About this room" style={{ height: 30, paddingHorizontal: 9, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#0e0e11", borderWidth: 1, borderColor: "#2a2a33" }}>
            <Ionicons name="information-circle-outline" size={14} color={colors.text} />
            <Text style={{ color: colors.text, fontFamily: fonts.semi, fontSize: 11.5 }}>About</Text>
            {frameNews && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.yellow }} />}
          </Pressable>
          <Pressable onPress={() => setTopMenu(true)} accessibilityLabel="Room options" style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#0e0e11", borderWidth: 1, borderColor: "#2a2a33" }}>
            <Ionicons name="ellipsis-horizontal" size={16} color={colors.text} />
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: room.status === "live" ? colors.live : colors.faint }} />
            <Text style={{ color: room.status === "live" ? colors.live : colors.muted, fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 1 }}>{room.status === "live" ? "LIVE DISCUSSION" : room.status === "created" ? "STARTING SOON" : "DISCUSSION"}</Text>
          </View>
          <Text numberOfLines={1} style={{ flex: 1, color: colors.muted, fontFamily: fonts.body, fontSize: 10.5 }}>
            <Ionicons name="time-outline" size={10} color={colors.muted} /> {elapsed}  <Ionicons name="people-outline" size={10} color={colors.muted} /> {audienceCount} in audience
            {topic ? `  · ${topic.label}` : ""}{p.communityName ? `  · ${p.communityName}` : ""}
            {call.live && !call.connected ? (call.reconnecting ? "  · Reconnecting…" : "  · Connecting…") : ""}
          </Text>
        </View>
        <Text numberOfLines={2} style={{ color: colors.text, fontFamily: fonts.title, fontSize: 14, lineHeight: 18, marginTop: 3 }}>{room.motion}</Text>
      </View>

      {/* ── The stage, the hands, the listeners ── */}
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: controlsBand + 56 }} showsVerticalScrollIndicator={false}>
          <StageView
            seats={seats}
            hostId={room.host_id}
            meId={meId}
            myRole={myRole}
            speaking={call.speaking}
            actions={hostActions}
            requestsLocked={!!room.speaker_requests_locked}
            onToggleLock={() => void seatHost.lockRequests(supabase, room.id, !room.speaker_requests_locked).then(p.onRefresh)}
            onPressPerson={(s) => openPerson(s.user_id, seatUser(s)?.username ?? null, seatName(s), false)}
            stageSlot={
              hlsAudience ? (
                <BroadcastView url={call.hls!.url} height={stageH} />
              ) : (
                <StageTiles tiles={tiles} speaking={call.speaking} layout={p.duel ? "gallery" : layout} pinned={pinned} onPin={setPinned} height={stageH} onPressTile={onPressTile} />
              )
            }
          />
        </ScrollView>
        <ReactionOverlay reactions={call.reactions} />
      </View>

      {/* ── Band A: the pill and the host's button; the cards ── */}
      <View pointerEvents="box-none" style={{ position: "absolute", left: 10, right: 10, bottom: controlsBand + 8, gap: 8 }}>
        {p.ended && <EndedCard room={room} onWatch={p.onWatchReplay} onHome={p.onHome} />}
        {call.mediaError && <MediaErrorCard message={call.mediaError} settings={call.mediaErrorSettings} onDismiss={call.clearMediaError} />}
        {p.invite && <InviteCard inviterName={p.invite.inviterName} busy={p.inviteBusy} onJoin={() => p.onRespondInvite(true)} onDecline={() => p.onRespondInvite(false)} />}
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
          {meId ? <QueuePill amMicHolder={amMicHolder} position={myQueuePos} /> : <View />}
          {canManage && <HostButton requests={requests.length} onPress={() => setHostOpen(true)} />}
        </View>
      </View>

      {!p.ended && (
        <RoomControls
          call={call}
          onStage={onStage(myRole)}
          canRaise={!!meId && room.status === "live" && !isHostRole(myRole) && myRole !== "speaker"}
          handRaised={p.handRaised}
          handBusy={p.handBusy}
          requestsLocked={!!room.speaker_requests_locked && !p.handRaised}
          amMicHolder={amMicHolder}
          onToggleHand={p.onToggleHand}
          onStepDown={p.onStepDown}
          onChat={() => setChatOpen(true)}
          chatBadge={chatBadge}
          onLeave={p.onLeave}
          onSettings={() => setSettingsOpen(true)}
          onCopyLink={() => void copyRoomLink(roomLink(room))}
          layout={layout}
          onLayout={setLayout}
          duel={p.duel}
        />
      )}

      {/* ── Sheets ── */}
      <RoomChatSheet open={chatOpen} onClose={() => setChatOpen(false)} roomId={room.id} meId={meId} messages={messages} />
      <RoomFrameSheet open={frameOpen} onClose={() => setFrameOpen(false)} room={room} seats={seats} myRole={myRole} meId={meId} onChange={p.onFraming} />
      {canManage && meId && <HostControlsSheet open={hostOpen} onClose={() => setHostOpen(false)} room={room} seats={seats} meId={meId} myRole={myRole} onChanged={p.onRefresh} />}
      <CallSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} call={call} />
      <NoteRequestSheet open={noteOpen} onClose={() => setNoteOpen(false)} room={room} />
      <ReportSheet target={report} onClose={() => setReport(null)} />
      <ActionSheet
        open={topMenu}
        title={room.motion}
        sub={hostUser ? `Hosted by ${hostUser.display_name?.trim() || `@${hostUser.username}`}` : undefined}
        onClose={() => setTopMenu(false)}
        actions={[
          { label: "Share room", onPress: shareRoom },
          { label: "Copy room link", onPress: () => void copyRoomLink(roomLink(room)) },
          { label: "Request a community note", onPress: () => setNoteOpen(true) },
          { label: "Report stream", onPress: reportHost, danger: true },
          { label: "Report something else", onPress: reportHost, danger: true },
        ]}
      />
      <ActionSheet open={!!tileSheet} title={tileSheet ? seatName(tileSheet.seat) : ""} sub={tileSheet ? ROLE_LABEL[tileSheet.role] : undefined} actions={tileActions} onClose={() => setTileSheet(null)} />
    </View>
  );
}
