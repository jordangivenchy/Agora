/* Live: what is on now, what is coming. Tap a room to enter. */
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../src/supabase";
import { fetchRooms, hostName, whenLabel, type RoomRow } from "../../src/rooms";
import { colors } from "../../src/theme";
import { Note, Screen } from "../../src/ui";

export default function Live() {
  const [live, setLive] = useState<RoomRow[]>([]);
  const [scheduled, setScheduled] = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchRooms(supabase);
      setLive(r.live);
      setScheduled(r.scheduled);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load rooms.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.yellow} />}
      >
        <Section title="Live now" count={live.length}>
          {live.length === 0 && !loading && <Note>No one is live right now. Rooms are hosted from agorasphere.net for now.</Note>}
          {live.map((r) => <RoomCard key={r.id} room={r} live />)}
        </Section>
        <Section title="Scheduled" count={scheduled.length}>
          {scheduled.length === 0 && !loading && <Note>Nothing on the calendar yet.</Note>}
          {scheduled.map((r) => <RoomCard key={r.id} room={r} />)}
        </Section>
        {error && <Note tone="error">{error}</Note>}
      </ScrollView>
    </Screen>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>{title}</Text>
        {count > 0 && <Text style={{ color: colors.muted, fontSize: 12.5 }}>{count}</Text>}
      </View>
      {children}
    </View>
  );
}

function RoomCard({ room, live }: { room: RoomRow; live?: boolean }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/room/[id]", params: { id: room.id } })}
      style={({ pressed }) => ({
        backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14,
        padding: 14, marginBottom: 10, opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {live ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.red }} />
            <Text style={{ color: colors.red, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 }}>LIVE</Text>
          </View>
        ) : (
          <Text style={{ color: colors.yellow, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 }}>{whenLabel(room.scheduled_start).toUpperCase()}</Text>
        )}
        {live && room.viewer_count ? <Text style={{ color: colors.muted, fontSize: 11.5 }}>{room.viewer_count} watching</Text> : null}
      </View>
      <Text style={{ color: colors.text, fontSize: 15.5, fontWeight: "700", lineHeight: 21 }}>{room.motion}</Text>
      <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 4 }}>Hosted by {hostName(room)}</Text>
    </Pressable>
  );
}
