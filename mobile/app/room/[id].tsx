/* A room, the site's amphitheater page (app/agora/[id]/page.tsx) on a
   phone. The sky stays over everything until the call is up, as the
   site's entrance does; a room this visitor can't read gets the gate's
   answer — gone, or a private room's door with its code entry; a
   scheduled room's door counts down. Entering asks the site for a
   token (the app's bearer and pass decide whether you may speak), hands
   the call to the app's root so it keeps playing when you go back to
   the tabs, and takes a seat like the website does. Over the audience
   ceiling the mint answers with the broadcast, which plays here
   instead. Hands, promotions and the host's controls write the same
   rows; realtime brings every change back; a promotion re-asks for a
   token that can publish; a drop that wasn't ours comes straight back. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, AppState, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { useMe } from "../../src/me";
import { useCall } from "../../src/callSession";
import { mintToken, type HlsMode } from "../../src/token";
import { hostName } from "../../src/rooms";
import { fetchSeats, heartbeat, raiseHand, subscribeRoom, takeSeat, vacateSeat } from "../../src/seats";
import { deriveStageRole, isHostRole, onStage, sortRequests, type Seat, type StageRole } from "../../src/stageModel";
import {
  advanceQueue, clearHostLeft, egress, endDiscussion, fetchCommunityName, fetchGate, fetchPendingInvite, fetchRoom, isFollowing, parseRoomParam, resolvePrefix,
  respondToInvite, restoreSeat, setFollowing, stepDownFromMic, touchSeat, watchInvites, type Gate, type PendingInvite, type RoomDetail, type RoomFraming,
} from "../../src/roomData";
import { LiveCall } from "../../src/liveRoom";
import { RoomBody } from "../../src/roomBody";
import { DeniedDoor, ScheduledDoor, TroubleCard } from "../../src/roomCards";
import { showToast } from "../../src/toast";
import { LoadingScreen } from "../../src/sky";
import { useReduceMotion } from "../../src/motion";
import { colors } from "../../src/theme";

const LIVEKIT_URL = process.env.EXPO_PUBLIC_LIVEKIT_URL ?? "";
const DOOR_MS = 30 * 60 * 1000;
const ENTER_MIN_MS = 1200, ENTER_CAP_MS = 12000, ENTER_FADE_MS = 420;
/* LiveKit's DisconnectReason values that are a verdict, not an accident. */
const NO_RECONNECT = new Set([1 /* CLIENT_INITIATED */, 2 /* DUPLICATE_IDENTITY */, 4 /* PARTICIPANT_REMOVED */, 5 /* ROOM_DELETED */, 8 /* JOIN_FAILURE */, 10 /* ROOM_CLOSED */, 11 /* USER_UNAVAILABLE */, 12 /* USER_REJECTED */]);

/* The route param may be a uuid, or a pretty slug ending in an id prefix. */
export default function RoomScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const raw = typeof params.id === "string" ? params.id : "";
  const parsed = useMemo(() => parseRoomParam(raw), [raw]);
  const [roomId, setRoomId] = useState<string | null>(parsed.uuid ?? null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (parsed.uuid) { setRoomId(parsed.uuid); return; }
    if (!parsed.prefix) { setGone(true); return; }
    let stale = false;
    const attempt = (n: number) => {
      resolvePrefix(supabase, parsed.prefix!).then((id) => {
        if (stale) return;
        if (id) setRoomId(id);
        else if (n < 4) setTimeout(() => attempt(n + 1), 800 * (n + 1));
        else setGone(true);
      }, () => { if (!stale && n < 4) setTimeout(() => attempt(n + 1), 800 * (n + 1)); else if (!stale) setGone(true); });
    };
    attempt(0);
    return () => { stale = true; };
  }, [parsed]);
  if (gone) return <View style={{ flex: 1, backgroundColor: colors.bg }}><Stack.Screen options={{ headerShown: false }} /><TroubleCard message="That room isn't here anymore." onBack={() => (router.canGoBack() ? router.back() : router.navigate("/"))} /></View>;
  if (!roomId) return <View style={StyleSheet.absoluteFill}><Stack.Screen options={{ headerShown: false }} /><LoadingScreen label="Entering the Agora" /></View>;
  return <Room key={roomId} roomId={roomId} />;
}

function Room({ roomId }: { roomId: string }) {
  const { session, pass } = useSession();
  const me = useMe();
  const meId = session?.user.id ?? null;
  const auth = useMemo(() => ({ token: session?.access_token, pass }), [session?.access_token, pass]);
  const { active, dropped, join, update, leave } = useCall();
  const reduce = useReduceMotion();
  const inThisRoom = active?.roomId === roomId;

  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [denied, setDenied] = useState<Gate | null>(null);
  const [missing, setMissing] = useState(false);
  const [firstStatus, setFirstStatus] = useState<string | null>(null);
  const [communityName, setCommunityName] = useState<string | null>(null);
  const [hls, setHls] = useState<HlsMode | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [handBusy, setHandBusy] = useState(false);
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [following, setFollowingState] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [callUp, setCallUp] = useState(false);
  const leftRef = useRef(false);
  const joinTries = useRef(0);
  const joiningRef = useRef(false);

  /* ── The room and its seats ── */
  const refresh = useCallback(async (): Promise<RoomDetail | null> => {
    try {
      const [r, list] = await Promise.all([fetchRoom(supabase, roomId), fetchSeats(supabase, roomId).catch(() => null)]);
      if (!r) { setUnreadable(true); return null; }
      setUnreadable(false);
      setRoom(r);
      setFirstStatus((prev) => prev ?? r.status);
      if (list) setSeats(list);
      return r;
    } catch {
      /* a failed request is not a missing room: keep what we have */
      return null;
    } finally {
      setLoaded(true);
    }
  }, [roomId]);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeRoom(supabase, roomId, () => void refresh());
    return unsubscribe;
  }, [roomId, refresh]);

  useEffect(() => {
    if (!room?.community_id) { setCommunityName(null); return; }
    void fetchCommunityName(supabase, room.community_id).then(setCommunityName);
  }, [room?.community_id]);

  /* The row came back empty: gone, or a door. */
  useEffect(() => {
    if (!loaded || !unreadable || denied) return;
    let stale = false;
    void fetchGate(supabase, roomId).then((g) => {
      if (stale || !g) { if (!stale) setUnreadable(false); return; }
      if (!g.room_exists) { setMissing(true); return; }
      if (g.allowed) { setUnreadable(false); void refresh(); return; }
      setDenied(g);
    });
    return () => { stale = true; };
  }, [loaded, unreadable, denied, roomId, refresh]);

  const mySeat = useMemo(() => seats.find((s) => s.user_id === meId && !s.left_at) ?? null, [seats, meId]);
  const myRole: StageRole = room ? (mySeat ? deriveStageRole(mySeat, room.host_id) : meId === room.host_id ? "host" : "audience") : "audience";
  const handRaised = !!mySeat?.hand_raised_at;
  const duel = !!room && room.pro_size === 1 && room.con_size === 1;
  const ended = room?.status === "ended";
  const arrivedEnded = firstStatus === "ended";

  /* A scheduled room opens 30 minutes before its start; only the host may set up before. */
  const opensAt = useMemo(() => {
    if (!room?.scheduled_start || room.status === "live" || room.status === "ended") return null;
    return new Date(room.scheduled_start).getTime() - DOOR_MS;
  }, [room?.scheduled_start, room?.status]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (opensAt === null || Date.now() >= opensAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [opensAt]);
  const gated = opensAt !== null && now < opensAt && myRole !== "host";

  /* Arriving after the close: the replay. */
  useEffect(() => {
    if (room && arrivedEnded) router.replace({ pathname: "/replay/[id]", params: { id: roomId } });
  }, [room, arrivedEnded, roomId]);

  /* ── Entering: the token, the call (or the broadcast), the seat ── */
  const ensureJoined = useCallback(async () => {
    if (!room || room.status === "ended" || gated || leftRef.current || joiningRef.current) return;
    if (inThisRoom || hls) return;
    if (dropped && dropped.roomId === roomId && dropped.reason !== undefined && NO_RECONNECT.has(dropped.reason)) {
      setJoinError(dropped.reason === 2 ? "This room is open on another device — the call moved there." : dropped.reason === 4 ? "You were removed from the call." : "The call ended.");
      return;
    }
    if (joinTries.current >= 5) { setJoinError("Couldn't connect to the live call."); return; }
    joiningRef.current = true;
    joinTries.current += 1;
    try {
      const m = await mintToken(auth, roomId);
      if (leftRef.current) return;
      if (!m.ok) {
        if (m.code === "room_ended") { void refresh(); return; }
        setJoinError(m.message);
        return;
      }
      setJoinError(null);
      if (m.hls) { setHls(m.hls); return; }
      if (active && !inThisRoom) leave();
      join({ roomId, motion: room.motion, hostName: hostName(room), serverUrl: LIVEKIT_URL, token: m.minted.token, onStage: m.minted.onStage });
    } finally {
      joiningRef.current = false;
    }
  }, [room, gated, inThisRoom, hls, dropped, roomId, auth, active, leave, join, refresh]);

  useEffect(() => {
    if (!room || inThisRoom || hls) return;
    const wait = dropped && dropped.roomId === roomId ? 1500 : 0;
    const t = setTimeout(() => void ensureJoined(), wait);
    return () => clearTimeout(t);
  }, [room, inThisRoom, hls, dropped, roomId, ensureJoined]);

  /* Walking in seats you. */
  const seatTried = useRef(false);
  useEffect(() => {
    if (seatTried.current || !loaded || !meId || !room || room.status === "ended" || gated) return;
    seatTried.current = true;
    if (mySeat) return;
    void takeSeat(supabase, roomId, meId).catch(() => undefined).then(() => refresh());
  }, [loaded, meId, room, gated, mySeat, roomId, refresh]);

  /* The seat stays warm. */
  const heartbeatOn = !!meId && !!room && room.status !== "ended" && !gated;
  useEffect(() => {
    if (!heartbeatOn) return;
    heartbeat(supabase, roomId);
    const t = setInterval(() => heartbeat(supabase, roomId), 60_000);
    return () => clearInterval(t);
  }, [heartbeatOn, roomId]);

  /* Brought up, or sent back down: the token has to change with it. */
  const reminting = useRef(false);
  useEffect(() => {
    if (!active || !inThisRoom || !room) return;
    const want = onStage(myRole);
    if (want === active.onStage || reminting.current) return;
    reminting.current = true;
    (async () => {
      const m = await mintToken(auth, roomId);
      reminting.current = false;
      if (!m.ok || !m.minted) return;
      update({ token: m.minted.token, onStage: m.minted.onStage });
      if (m.minted.onStage) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    })();
  }, [myRole, active, inThisRoom, room, roomId, auth, update]);

  /* Watching the broadcast: a raised hand near the front of the line, a stream that died, or a promotion re-asks for a seat on the call. */
  const hlsRef = useRef(hls);
  hlsRef.current = hls;
  useEffect(() => {
    if (!hls || !room) return;
    const streamDied = room.status === "live" && !room.hls_url;
    if (!streamDied && !handRaised && !onStage(myRole)) return;
    let stale = false;
    void mintToken(auth, roomId).then((m) => {
      if (stale || !m.ok || !room) return;
      if (m.minted) {
        setHls(null);
        join({ roomId, motion: room.motion, hostName: hostName(room), serverUrl: LIVEKIT_URL, token: m.minted.token, onStage: m.minted.onStage });
      }
    });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handRaised, myRole, room?.hls_url, room?.status]);

  /* Ended under us: the call goes, the card stays. */
  useEffect(() => {
    if (ended && inThisRoom) leave();
  }, [ended, inThisRoom, leave]);

  /* Invites: the consent moment arrives live. */
  useEffect(() => {
    if (!meId) return;
    void fetchPendingInvite(supabase, roomId, meId).then((inv) => { if (inv) setInvite(inv); });
    return watchInvites(supabase, roomId, meId, setInvite);
  }, [meId, roomId]);

  /* Following the host. */
  const hostId = room?.host_id ?? null;
  useEffect(() => {
    if (!meId || !hostId || meId === hostId) return;
    let alive = true;
    void isFollowing(supabase, meId, hostId).then((f) => { if (alive) setFollowingState(f); });
    return () => { alive = false; };
  }, [meId, hostId]);
  const toggleFollow = async () => {
    if (!hostId) return;
    if (!meId) { router.push("/sign-in"); return; }
    if (followBusy) return;
    setFollowBusy(true);
    const { error } = await setFollowing(supabase, hostId, !following);
    setFollowBusy(false);
    if (!error) setFollowingState(!following);
  };

  /* Open-mic mode: the host's client brings up the front of the line whenever the mic is free. */
  const advanceGuard = useRef(0);
  useEffect(() => {
    if (!room || !meId || !isHostRole(myRole)) return;
    if (!room.queue_auto_advance || room.mic_user_id || room.status !== "live") return;
    const line = sortRequests(seats.filter((s) => !s.left_at && s.hand_raised_at && !isHostRole(deriveStageRole(s, room.host_id))));
    if (line.length === 0) return;
    const t = Date.now();
    if (t - advanceGuard.current < 2000) return;
    advanceGuard.current = t;
    void advanceQueue(supabase, roomId).then(() => refresh());
  }, [room, meId, myRole, seats, roomId, refresh]);

  /* Default recording: the host's phone starts the room's stream once connected, as the site's host does. */
  const autoHls = useRef(false);
  useEffect(() => {
    if (autoHls.current || !room || room.status !== "live" || room.hls_url || !meId || meId !== room.host_id || !callUp) return;
    autoHls.current = true;
    void egress(auth, room.id, { action: "start_hls" }).then(({ ok, data }) => {
      if (ok) return;
      if (/recording_disabled|storage_full/.test(String(data.error ?? ""))) return;
      autoHls.current = false;
    });
  }, [room, meId, callUp, auth]);

  /* Back on the screen: the seat, the host's grace, the row that was stamped out while we were away. */
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") { hiddenAt.current = Date.now(); return; }
      if (!meId || !room || room.status === "ended" || leftRef.current) return;
      void touchSeat(supabase, roomId);
      if (meId === room.host_id) void clearHostLeft(supabase, roomId);
      const awaySince = hiddenAt.current ?? 0;
      void (awaySince ? restoreSeat(supabase, roomId, meId, awaySince) : Promise.resolve()).finally(() => void refresh());
    });
    return () => sub.remove();
  }, [meId, room, roomId, refresh]);
  useEffect(() => {
    if (!meId || !room?.host_left_at || room.host_id !== meId) return;
    void clearHostLeft(supabase, roomId);
  }, [meId, room?.host_left_at, room?.host_id, roomId]);

  /* ── Hands, the mic, invites ── */
  async function toggleHand() {
    if (!meId || handBusy || !room) return;
    setHandBusy(true);
    void Haptics.selectionAsync();
    const err = await raiseHand(supabase, roomId, !handRaised);
    setHandBusy(false);
    if (err) showToast(err);
    else void refresh();
  }
  async function stepDown() {
    await stepDownFromMic(supabase, roomId);
    void refresh();
  }
  async function respondInvite(accept: boolean) {
    if (!invite || !meId) return;
    setInviteBusy(true);
    try {
      await respondToInvite(supabase, invite.id, accept, roomId, meId, mySeat);
      void refresh();
    } finally {
      setInviteBusy(false);
      setInvite(null);
    }
  }

  /* ── Leaving ── */
  const goHome = () => (router.canGoBack() ? router.back() : router.navigate("/"));
  const walkOut = async () => {
    leftRef.current = true;
    if (mySeat) await vacateSeat(supabase, mySeat.id).catch(() => undefined);
    leave();
    goHome();
  };
  const onLeave = () => {
    if (room && meId && isHostRole(myRole) && !duel && room.status !== "ended") {
      Alert.alert("Close the stage?", "You're the host — leaving closes the stage for everyone.", [
        { text: "Stay", style: "cancel" },
        {
          text: "Close stage", style: "destructive",
          onPress: () => {
            leftRef.current = true;
            void endDiscussion(supabase, roomId).then(() => { void egress(auth, roomId, { action: "stop_all" }); });
            leave();
            goHome();
          },
        },
      ]);
      return;
    }
    void walkOut();
  };

  /* ── The sky while the call connects: at least a beat, at most twelve seconds ── */
  const [entering, setEntering] = useState<"up" | "leaving" | "gone">("up");
  const enteredAt = useRef(Date.now());
  const skyOpacity = useRef(new Animated.Value(1)).current;
  const done = !!denied || missing || !!joinError || gated || ended;
  useEffect(() => {
    if (entering !== "up") return;
    const elapsed = Date.now() - enteredAt.current;
    const wait = callUp || done ? Math.max(0, ENTER_MIN_MS - elapsed) : Math.max(0, ENTER_CAP_MS - elapsed);
    const t = setTimeout(() => setEntering("leaving"), wait);
    return () => clearTimeout(t);
  }, [entering, callUp, done]);
  useEffect(() => {
    if (entering !== "leaving") return;
    Animated.timing(skyOpacity, { toValue: 0, duration: reduce ? 0 : ENTER_FADE_MS, useNativeDriver: true }).start();
    /* A timer, not the animation's callback, takes the sky down: a
       native-driven fade that never reports back must not leave the
       sky over the room. */
    const t = setTimeout(() => setEntering("gone"), (reduce ? 0 : ENTER_FADE_MS) + 40);
    return () => clearTimeout(t);
  }, [entering, skyOpacity, reduce]);

  const onFraming = useCallback((framing: RoomFraming) => setRoom((r) => (r ? { ...r, framing } : r)), []);
  const username = me?.display_name?.trim() || me?.username || session?.user.email?.split("@")[0] || "Guest";

  let body: React.ReactNode = null;
  if (missing) {
    body = <TroubleCard message="That room isn't here anymore." onBack={goHome} />;
  } else if (denied) {
    body = <DeniedDoor gate={denied} roomId={roomId} signedIn={!!meId} onEntered={() => { setDenied(null); setUnreadable(false); void refresh(); }} />;
  } else if (room && gated && opensAt !== null) {
    body = <ScheduledDoor room={room} opensAt={opensAt} now={now} />;
  } else if (room && joinError && !inThisRoom && !hls) {
    body = <TroubleCard message={joinError} onRetry={() => { joinTries.current = 0; setJoinError(null); void ensureJoined(); }} onBack={goHome} />;
  } else if (room && !arrivedEnded) {
    body = (
      <LiveCall username={username} hls={hls}>
        {(call) => (
          <>
            <CallUp up={(inThisRoom && call.connected) || !!hls} onChange={setCallUp} />
            <RoomBody
              room={room}
              seats={seats}
              meId={meId}
              myRole={myRole}
              mySeat={mySeat}
              call={call}
              duel={duel}
              communityName={communityName}
              handRaised={handRaised}
              handBusy={handBusy}
              onToggleHand={() => void toggleHand()}
              onStepDown={() => void stepDown()}
              invite={invite}
              inviteBusy={inviteBusy}
              onRespondInvite={(a) => void respondInvite(a)}
              onLeave={onLeave}
              onRefresh={() => void refresh()}
              following={following}
              followBusy={followBusy}
              onToggleFollow={() => void toggleFollow()}
              onFraming={onFraming}
              ended={ended}
              onWatchReplay={() => { leftRef.current = true; if (mySeat) void vacateSeat(supabase, mySeat.id).catch(() => undefined); router.replace({ pathname: "/replay/[id]", params: { id: roomId } }); }}
              onHome={() => void walkOut()}
            />
          </>
        )}
      </LiveCall>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
      {entering !== "gone" && (
        <Animated.View pointerEvents={entering === "up" ? "auto" : "none"} style={[StyleSheet.absoluteFill, { opacity: skyOpacity }]}>
          <LoadingScreen label="Entering the Agora" />
        </Animated.View>
      )}
    </View>
  );
}

/* The call's state, reported up from inside the call's own subtree. */
function CallUp({ up, onChange }: { up: boolean; onChange: (up: boolean) => void }) {
  useEffect(() => { onChange(up); }, [up, onChange]);
  return null;
}
