/* The site's square discussion block (components/RoomCard.tsx): the
   picture, the status badge, the field up top, the motion and the host
   on a solid panel below. Explore renders these two across. */
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { personName, type Person } from "./home";
import { topicOf } from "./topics";
import { whenLabel } from "./rooms";
import { colors, fonts } from "./theme";

const FORMAT_LABEL: Record<string, string> = { open: "Open", oxford: "Oxford", "1v1": "1v1", panel: "Panel" };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export interface SquareRoom {
  id: string;
  motion: string;
  topic_key: string;
  status: string;
  format: string;
  scheduled_start: string | null;
  viewer_count: number | null;
  thumbnail_url: string | null;
  host: Person | Person[] | null;
  community?: { id: string; name: string; color: string | null } | { id: string; name: string; color: string | null }[] | null;
}

export function RoomSquare({ room: r, size = 168, onPress }: { room: SquareRoom; size?: number; onPress: () => void }) {
  const host = one(r.host);
  const community = one(r.community);
  const img = r.thumbnail_url || host?.avatar_url || null;
  const scheduled = r.status !== "live" && !!r.scheduled_start;
  const badge = r.status === "live"
    ? { label: "LIVE", bg: "#ef4444" }
    : scheduled ? { label: "SCHEDULED", bg: "#6d55c8" } : { label: "OPEN", bg: colors.blue };
  const initial = personName(host).replace(/^@/, "").charAt(0).toUpperCase();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ width: size, height: size, borderRadius: 16, overflow: "hidden", backgroundColor: colors.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, opacity: pressed ? 0.88 : 1 })}>
      {img ? (
        <Image source={{ uri: img }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          <Text style={{ color: colors.text, fontFamily: fonts.title, fontSize: Math.round(size * 0.3) }}>{initial}</Text>
        </View>
      )}
      <View style={{ position: "absolute", top: 8, left: 8, backgroundColor: badge.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
        <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 0.5 }}>{badge.label}</Text>
      </View>
      <View style={{ position: "absolute", top: 8, right: 8, backgroundColor: colors.bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
        <Text style={{ color: "rgba(255,255,255,0.75)", fontFamily: fonts.medium, fontSize: 9.5 }}>{topicOf(r.topic_key).label}</Text>
      </View>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, paddingHorizontal: 10, paddingTop: 7, paddingBottom: 8 }}>
        <Text numberOfLines={2} style={{ color: "#fff", fontFamily: fonts.title, fontSize: 12, lineHeight: 15 }}>{r.motion}</Text>
        {(community || host) && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
            <Text style={{ color: "rgba(255,255,255,0.8)", fontFamily: fonts.body, fontSize: 10.5 }}>by</Text>
            {community ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 13, height: 13, borderRadius: 4, backgroundColor: community.color ?? colors.blueText, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#fff", fontFamily: fonts.bold, fontSize: 8 }}>{community.name.charAt(0).toUpperCase()}</Text>
                </View>
                <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.8)", fontFamily: fonts.body, fontSize: 10.5 }}>{community.name}</Text>
              </View>
            ) : (
              <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.8)", fontFamily: fonts.body, fontSize: 10.5 }}>{personName(host)}</Text>
            )}
          </View>
        )}
        <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.55)", fontFamily: fonts.body, fontSize: 9.5, marginTop: 2 }}>
          {FORMAT_LABEL[r.format] ?? r.format}
          {r.status === "live" ? ` · ${r.viewer_count ?? 0} watching` : scheduled ? ` · ${whenLabel(r.scheduled_start)}` : ""}
        </Text>
      </View>
    </Pressable>
  );
}
