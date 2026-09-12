/* A room: title and host, then the people and the stage. Entering asks
   the site for a token (the same mint the browser uses, with the app's
   bearer and pass, which decides whether you may speak), hands the call
   to the app's root so it keeps playing when you go back to the tabs,
   and takes a seat in debate_participants like the website does. Hands,
   promotions and the host's controls write the same rows; realtime
   brings every change back; a promotion re-asks for a token that can
   publish. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { useCall } from "../../src/callSession";
import { mintToken } from "../../src/token";
import { hostName, type RoomRow } from "../../src/rooms";
import { fetchSeats, heartbeat, host, raiseHand, subscribeRoom, takeSeat, vacateSeat } from "../../src/seats";
import { deriveStageRole, isHostRole, onStage, type Seat, type StageRole } from "../../src/stageModel";
import { SeatList, type SeatActions } from "../../src/seatList";
import { ConnectionNote, MicButton, useSpeakingIds } from "../../src/stage";
import { colors } from "../../src/theme";
import { Button, Note, Screen, Spinner } from "../../src/ui";

const LIVEKIT_URL = process.env.EXPO_PUBLIC_LIVEKIT_URL ?? "";
const SELECT = "id, motion, status, scheduled_start, viewer_count, host_id, topic_key, created_at, speaker_requests_locked, host:users!host_id(username, display_name, avatar_url)";

type RoomDetail = RoomRow & { speaker_requests_locked: boolean | null };

export default function RoomScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const { session, pass } = useSession();
  const { active, join, update, leave } = useCall();
  const meId = session?.user.id ?? null;
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [handBusy, setHandBusy] = useState(false);
  const speaking = useSpeakingIds();
  const inThisRoom = active?.roomId === id;

  const refresh = useCallback(async (): Promise<RoomDetail | null> => {
    const [{ data }, list] = await Promise.all([
      supabase.from("debate_rooms").select(SELECT).eq("id", id).maybeSingle(),
      fetchSeats(supabase, id).catch(() => null),
    ]);
    const r = (data as unknown as RoomDetail | null) ?? null;
    if (r) setRoom(r);
    if (list) setSeats(list);
    return r;
  }, [id]);

  /* Entering: the room, the token, a seat. Once per room id. */
  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      const r = await refresh();
      if (!alive) return;
      if (!r) {
        setError("This room isn't available.");
        return;
      }
      if (r.status === "ended") {
        setError("This room has ended.");
        return;
      }
      if (active?.roomId !== id) {
        const m = await mintToken({ token: session?.access_token, pass }, id);
        if (!alive) return;
        if (!m.ok) {
          setError(m.message);
          return;
        }
        join({ roomId: id, motion: r.motion, hostName: hostName(r), serverUrl: LIVEKIT_URL, token: m.minted.token, onStage: m.minted.onStage });
      }
      if (meId) {
        await takeSeat(supabase, id, meId).catch(() => {});
        if (alive) void refresh();
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* While in the room: every change to seats or the room comes back, and the seat stays warm. */
  useEffect(() => {
    if (!id || !inThisRoom) return;
    const unsubscribe = subscribeRoom(supabase, id, () => void refresh());
    heartbeat(supabase, id);
    const timer = setInterval(() => heartbeat(supabase, id), 30_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [id, inThisRoom, refresh]);

  const mySeat = useMemo(() => seats.find((s) => s.user_id === meId) ?? null, [seats, meId]);
  const myRole: StageRole = room ? (mySeat ? deriveStageRole(mySeat, room.host_id) : meId === room.host_id ? "host" : "audience") : "audience";
  const handRaised = !!mySeat?.hand_raised_at;

  /* Brought up, or sent back down: the token has to change with it. */
  const reminting = useRef(false);
  useEffect(() => {
    if (!active || !inThisRoom || !room) return;
    const want = onStage(myRole);
    if (want === active.onStage || reminting.current) return;
    reminting.current = true;
    (async () => {
      const m = await mintToken({ token: session?.access_token, pass }, id);
      reminting.current = false;
      if (!m.ok) return;
      update({ token: m.minted.token, onStage: m.minted.onStage });
      if (m.minted.onStage) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    })();
  }, [myRole, active, inThisRoom, room, id, session?.access_token, pass, update]);

  useEffect(() => {
    if (room?.status === "ended" && inThisRoom) {
      leave();
      setError("This room has ended.");
    }
  }, [room?.status, inThisRoom, leave]);

  const canRaise = !!meId && room?.status === "live" && !isHostRole(myRole) && myRole !== "speaker";
  const locked = !!room?.speaker_requests_locked;

  async function toggleHand() {
    if (!id || handBusy) return;
    setHandBusy(true);
    void Haptics.selectionAsync();
    const err = await raiseHand(supabase, id, !handRaised);
    setHandBusy(false);
    if (err) setError(err);
    else void refresh();
  }

  const actions = useMemo<SeatActions | null>(
    () =>
      isHostRole(myRole)
        ? {
            bringUp: (s) => void host.bringUp(supabase, s.id).then(() => refresh()),
            dismiss: (s) => void host.dismiss(supabase, s.id).then(() => refresh()),
            toAudience: (s) => void host.toAudience(supabase, s.id).then(() => refresh()),
          }
        : null,
    [myRole, refresh]
  );

  async function leaveRoom() {
    if (mySeat) await vacateSeat(supabase, mySeat.id).catch(() => {});
    leave();
    router.back();
  }

  if (!room && !error) return <Spinner />;

  return (
    <Screen>
      <Stack.Screen options={{ title: room?.status === "live" ? "Live" : "Room" }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} style={{ flex: 1 }}>
        {room && (
          <View style={{ paddingTop: 12, paddingBottom: 12 }}>
            <Text style={{ color: colors.text, fontSize: 19, fontWeight: "800", lineHeight: 25 }}>{room.motion}</Text>
            <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 4 }}>Hosted by {hostName(room)}{room.status !== "live" ? ` · ${room.status}` : ""}</Text>
          </View>
        )}
        {error ? (
          <View>
            <Note tone="error">{error}</Note>
            <View style={{ height: 12 }} />
            <Button kind="secondary" onPress={() => router.back()}>Back</Button>
          </View>
        ) : inThisRoom && room ? (
          <View>
            <ConnectionNote />
            {isHostRole(myRole) && (
              <Pressable onPress={() => void host.lockRequests(supabase, id, !locked).then(() => refresh())} style={{ alignSelf: "flex-start", marginBottom: 12, paddingHorizontal: 11, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: "700" }}>{locked ? "Open requests" : "Close requests"}</Text>
              </Pressable>
            )}
            <SeatList seats={seats} hostId={room.host_id} meId={meId} myRole={myRole} speaking={speaking} actions={actions} />
          </View>
        ) : (
          <Note>Getting you in…</Note>
        )}
      </ScrollView>
      {!error && inThisRoom && room && (
        <View style={{ flexDirection: "row", gap: 10, paddingVertical: 12 }}>
          {canRaise && (
            <View style={{ flex: 1 }}>
              <Button kind={handRaised ? "primary" : "secondary"} onPress={() => void toggleHand()} busy={handBusy} disabled={locked && !handRaised}>
                {locked && !handRaised ? "Requests closed" : handRaised ? "Lower hand" : "Raise hand"}
              </Button>
            </View>
          )}
          {onStage(myRole) && (
            <View style={{ flex: 1 }}>
              <MicButton />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Button kind="danger" onPress={() => void leaveRoom()}>Leave</Button>
          </View>
        </View>
      )}
    </Screen>
  );
}
