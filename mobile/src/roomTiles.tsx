/* The pictures (components/agora/CallLayouts.tsx, the phone's two flat
   layouts): every on-stage person as a tile, live camera or the avatar
   plate, the name tag, the mute badge, a yellow ring while they talk; a
   shared screen as a tile of its own. Gallery is the grid; multi-speaker
   features one picture (a share first, then whoever is pinned, then the
   last to speak) over a strip of the rest. Tap a tile for the person. */
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "./avatar";
import { TileVideo } from "./tileVideo";
import type { CallTile } from "./roomCall";
import { colors, fonts } from "./theme";

export type Layout = "gallery" | "multi";

export interface StageTile {
  key: string;
  identity: string;
  username: string;
  handle: string | null;
  avatarUrl: string | null;
  local: boolean;
  source: "camera" | "screen";
  micMuted: boolean;
  roleLabel: string;
  call: CallTile | null;
}

const one = StyleSheet.hairlineWidth;

function Tile({ tile, speaking, small, featured, onPress, onLongPress }: { tile: StageTile; speaking: boolean; small?: boolean; featured?: boolean; onPress?: () => void; onLongPress?: () => void }) {
  const screen = tile.source === "screen";
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={{ flex: 1, borderRadius: small ? 9 : 12, overflow: "hidden", backgroundColor: "#0e0e11", borderWidth: speaking ? 2 : one, borderColor: speaking ? colors.yellow : "#2a2a33" }}
    >
      {tile.call ? (
        <TileVideo tile={tile.call} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", backgroundColor: "#111114" }]}>
          <Avatar url={tile.avatarUrl} name={tile.username} size={small ? 34 : featured ? 96 : 64} ring={speaking} />
        </View>
      )}
      <View style={{ position: "absolute", left: small ? 4 : 8, bottom: small ? 4 : 8, right: small ? 4 : 8, flexDirection: "row", alignItems: "center", gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: small ? 5 : 7, paddingVertical: small ? 2 : 3, borderRadius: 6, backgroundColor: "#0a0a0c", maxWidth: "100%" }}>
          {tile.micMuted && !screen && <Ionicons name="mic-off" size={small ? 9 : 11} color={colors.red} />}
          {screen && <Ionicons name="desktop-outline" size={small ? 9 : 11} color={colors.soft} />}
          <Text numberOfLines={1} style={{ color: colors.text, fontFamily: fonts.semi, fontSize: small ? 9.5 : 11.5 }}>
            {tile.local ? "You" : tile.username}{screen ? " · screen" : ""}
          </Text>
          {!small && !screen && <Text style={{ color: speaking ? colors.yellow : colors.muted, fontFamily: fonts.body, fontSize: 10 }}>· {speaking ? "Speaking" : tile.roleLabel}</Text>}
        </View>
      </View>
    </Pressable>
  );
}

export function StageTiles({ tiles, speaking, layout, pinned, onPin, height, onPressTile }: {
  tiles: StageTile[];
  speaking: ReadonlySet<string>;
  layout: Layout;
  pinned: string | null;
  onPin: (key: string | null) => void;
  /** The room the tiles have; the grid sizes its rows to it. */
  height: number;
  onPressTile: (tile: StageTile) => void;
}) {
  /* The last to speak takes the featured slot when nothing is pinned or shared. */
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  useEffect(() => {
    const first = tiles.find((t) => t.source === "camera" && speaking.has(t.identity));
    if (first) setLastSpeaker(first.key);
  }, [speaking, tiles]);

  const share = tiles.find((t) => t.source === "screen") ?? null;
  const featuredKey = useMemo(() => {
    if (pinned && tiles.some((t) => t.key === pinned)) return pinned;
    if (share) return share.key;
    if (lastSpeaker && tiles.some((t) => t.key === lastSpeaker)) return lastSpeaker;
    return tiles[0]?.key ?? null;
  }, [pinned, share, lastSpeaker, tiles]);

  if (tiles.length === 0) {
    return (
      <View style={{ height: Math.min(height, 150), borderRadius: 12, backgroundColor: "#0e0e11", borderWidth: one, borderColor: "#2a2a33", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <Ionicons name="mic-outline" size={22} color={colors.faint} />
        <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>The stage is empty.</Text>
      </View>
    );
  }

  const isSpeaking = (t: StageTile) => t.source === "camera" && speaking.has(t.identity);

  if (layout === "multi" || (share && tiles.length > 1)) {
    const featured = tiles.find((t) => t.key === featuredKey) ?? tiles[0];
    const rest = tiles.filter((t) => t.key !== featured.key);
    const stripH = rest.length ? 76 : 0;
    return (
      <View style={{ height, gap: 8 }}>
        <View style={{ flex: 1, flexDirection: "row" }}>
          <Tile tile={featured} speaking={isSpeaking(featured)} featured onPress={() => onPressTile(featured)} onLongPress={() => onPin(pinned === featured.key ? null : featured.key)} />
          {pinned === featured.key && (
            <Pressable onPress={() => onPin(null)} hitSlop={8} style={{ position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: "#0a0a0c", alignItems: "center", justifyContent: "center", borderWidth: one, borderColor: "#2a2a33" }} accessibilityLabel="Unpin">
              <Ionicons name="pin" size={13} color={colors.yellow} />
            </Pressable>
          )}
        </View>
        {rest.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: stripH, flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
            {rest.map((t) => (
              <View key={t.key} style={{ width: 100, height: stripH }}>
                <Tile tile={t} speaking={isSpeaking(t)} small onPress={() => onPin(t.key)} onLongPress={() => onPressTile(t)} />
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    );
  }

  /* Gallery: one fills the room; two stack; up to four make a square; more scroll in rows of two. */
  const cols = tiles.length <= 1 ? 1 : 2;
  const rows = Math.ceil(tiles.length / cols);
  const gap = 6;
  const rowH = rows <= 3 ? (height - gap * (rows - 1)) / rows : (height - gap * 2) / 3;
  const rowsOf: StageTile[][] = [];
  for (let i = 0; i < tiles.length; i += cols) rowsOf.push(tiles.slice(i, i + cols));
  const body = rowsOf.map((r, i) => (
    <View key={i} style={{ height: rowH, flexDirection: "row", gap }}>
      {r.map((t) => (
        <Tile key={t.key} tile={t} speaking={isSpeaking(t)} onPress={() => onPressTile(t)} onLongPress={() => onPin(t.key)} />
      ))}
      {r.length < cols && <View style={{ flex: 1 }} />}
    </View>
  ));
  if (rows <= 3) return <View style={{ height, gap }}>{body}</View>;
  return (
    <ScrollView style={{ height }} contentContainerStyle={{ gap }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
      {body}
    </ScrollView>
  );
}
