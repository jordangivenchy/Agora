/* A room: its title and host, then the stage. Entering asks the site for
   a token (the same mint the browser uses, with the app's bearer and
   pass, which decides whether you may speak) and hands the call to the
   app's root, so it keeps playing when you go back to the tabs. */
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../src/supabase";
import { useSession } from "../../src/session";
import { useCall } from "../../src/callSession";
import { apiFetch } from "../../src/api";
import { hostName, type RoomRow } from "../../src/rooms";
import { Stage, MicButton } from "../../src/stage";
import { colors } from "../../src/theme";
import { Button, Note, Screen, Spinner } from "../../src/ui";

const LIVEKIT_URL = process.env.EXPO_PUBLIC_LIVEKIT_URL ?? "";

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, pass } = useSession();
  const { active, join, leave } = useCall();
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inThisRoom = active?.roomId === id;

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("debate_rooms")
        .select("id, motion, status, scheduled_start, viewer_count, host_id, topic_key, created_at, host:users!host_id(username, display_name, avatar_url)")
        .eq("id", id)
        .maybeSingle();
      if (!alive) return;
      if (!data) {
        setError("This room isn't available.");
        return;
      }
      const row = data as unknown as RoomRow;
      setRoom(row);
      if (active?.roomId === id) return;
      const res = await apiFetch("/api/livekit", { token: session?.access_token, pass }, {
        method: "POST",
        body: JSON.stringify({ roomId: id, role: "spectator" }),
      }).catch(() => null);
      if (!alive) return;
      if (!res) {
        setError("Couldn't reach AgoraSphere.");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string; mode?: string; opensAt?: string };
      if (!res.ok) {
        setError(
          body.error === "room_ended" ? "This room has ended."
            : body.error === "room_not_open" ? `The doors open ${body.opensAt ? new Date(body.opensAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "soon"}.`
              : `Couldn't join (${res.status}).`
        );
        return;
      }
      if (body.mode === "hls") {
        setError("This room is over the audience limit for live listening. Watch it on agorasphere.net.");
        return;
      }
      if (!body.token) {
        setError("No token came back.");
        return;
      }
      join({ roomId: id, motion: row.motion, hostName: hostName(row), serverUrl: LIVEKIT_URL, token: body.token });
    })();
    return () => {
      alive = false;
    };
    // The call is joined once per room id; a re-render must not re-request the token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session?.access_token, pass]);

  if (!room && !error) return <Spinner />;

  return (
    <Screen>
      <Stack.Screen options={{ title: room?.status === "live" ? "Live" : "Room" }} />
      {room && (
        <View style={{ paddingTop: 12 }}>
          <Text style={{ color: colors.text, fontSize: 19, fontWeight: "800", lineHeight: 25 }}>{room.motion}</Text>
          <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 4 }}>Hosted by {hostName(room)}</Text>
        </View>
      )}
      {error ? (
        <View style={{ paddingTop: 16 }}>
          <Note tone="error">{error}</Note>
          <View style={{ height: 12 }} />
          <Button kind="secondary" onPress={() => router.back()}>Back</Button>
        </View>
      ) : inThisRoom ? (
        <View style={{ flex: 1, paddingTop: 12 }}>
          <Stage />
          <View style={{ flexDirection: "row", gap: 10, paddingVertical: 12 }}>
            <View style={{ flex: 1 }}>
              <MicButton />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="danger" onPress={() => { leave(); router.back(); }}>Leave</Button>
            </View>
          </View>
          <Note>Go back to the tabs and this keeps playing; the bar at the bottom brings you here again.</Note>
        </View>
      ) : (
        <Note>Getting you in…</Note>
      )}
    </Screen>
  );
}
