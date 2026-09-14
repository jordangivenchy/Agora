/* The pictures (components/agora/CallLayouts.tsx, the site's two flat
   layouts): every on-stage person as a tile, live camera or the avatar
   plate, the name tag, the mute badge, a yellow ring while they talk; a
   shared screen as a tile of its own. Gallery is Discord's grid
   (callGrid.ts): square windows as big as the room allows, a screen two
   windows wide, nine to a page. Multi-speaker features one picture (a
   share first, then whoever is pinned, then the last to speak) over a
   strip of square windows. Tap a tile for the person. */
import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "./avatar";
import { TileVideo } from "./tileVideo";
import type { CallTile } from "./roomCall";
import { planGrid } from "./callGrid";
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

export function Tile({ tile, speaking, small, featured, size, onPress, onLongPress }: { tile: StageTile; speaking: boolean; small?: boolean; featured?: boolean; /** The window's shorter side, for the face on a camera that's off. */ size?: number; onPress?: () => void; onLongPress?: () => void }) {
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
          <Avatar url={tile.avatarUrl} name={tile.username} size={size ? Math.round(Math.max(28, Math.min(110, size * 0.4))) : small ? 34 : featured ? 96 : 64} ring={speaking} />
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

export function StageTiles({ tiles, speaking, layout, pinned, onPin, width, height, onPressTile }: {
  tiles: StageTile[];
  speaking: ReadonlySet<string>;
  layout: Layout;
  pinned: string | null;
  onPin: (key: string | null) => void;
  /** The room the pictures have. */
  width: number;
  height: number;
  onPressTile: (tile: StageTile) => void;
}) {
  /* The last to speak takes the featured slot when nothing is pinned or shared. */
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  useEffect(() => {
    const first = tiles.find((t) => t.source === "camera" && speaking.has(t.identity));
    if (first) setLastSpeaker(first.key);
  }, [speaking, tiles]);

  /* Windows glide to their new places when someone comes on or leaves, as Discord's do. */
  const count = tiles.length;
  const shown = useRef({ count, layout });
  if (shown.current.count !== count || shown.current.layout !== layout) {
    shown.current = { count, layout };
    LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
  }

  const share = tiles.find((t) => t.source === "screen") ?? null;
  const featuredKey = useMemo(() => {
    if (pinned && tiles.some((t) => t.key === pinned)) return pinned;
    if (share) return share.key;
    if (lastSpeaker && tiles.some((t) => t.key === lastSpeaker)) return lastSpeaker;
    return tiles[0]?.key ?? null;
  }, [pinned, share, lastSpeaker, tiles]);

  const [page, setPage] = useState(0);

  if (tiles.length === 0) {
    return (
      <View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: Math.min(width, 260), paddingVertical: 22, borderRadius: 12, backgroundColor: "#0e0e11", borderWidth: one, borderColor: "#2a2a33", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Ionicons name="videocam-off-outline" size={22} color={colors.faint} />
          <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 12.5 }}>No cameras are live</Text>
        </View>
      </View>
    );
  }

  const isSpeaking = (t: StageTile) => t.source === "camera" && speaking.has(t.identity);

  if (layout === "multi") {
    const featured = tiles.find((t) => t.key === featuredKey) ?? tiles[0];
    const rest = tiles.filter((t) => t.key !== featured.key);
    const areaH = height - (rest.length ? STRIP + GAP : 0);
    const screen = featured.source === "screen";
    const fw = screen ? width : Math.min(width, areaH);
    const fh = screen ? Math.min(areaH, Math.round((width * 9) / 16)) : fw;
    return (
      <View style={{ width, height }}>
        <View style={{ height: areaH, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: fw, height: fh }}>
            <Tile tile={featured} speaking={isSpeaking(featured)} featured size={Math.min(fw, fh)} onPress={() => onPressTile(featured)} onLongPress={() => onPin(pinned === featured.key ? null : featured.key)} />
            {pinned === featured.key && (
              <Pressable onPress={() => onPin(null)} hitSlop={8} style={{ position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: "#0a0a0c", alignItems: "center", justifyContent: "center", borderWidth: one, borderColor: "#2a2a33" }} accessibilityLabel="Unpin">
                <Ionicons name="pin" size={13} color={colors.yellow} />
              </Pressable>
            )}
          </View>
        </View>
        {rest.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: STRIP, flexGrow: 0, marginTop: GAP }} contentContainerStyle={{ gap: GAP, minWidth: width, justifyContent: "center" }}>
            {rest.map((t) => (
              <View key={t.key} style={{ width: t.source === "screen" ? STRIP * 2 + GAP : STRIP, height: STRIP }}>
                <Tile tile={t} speaking={isSpeaking(t)} small size={STRIP} onPress={() => onPin(t.key)} onLongPress={() => onPressTile(t)} />
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    );
  }

  /* Gallery: screens first, then the cameras; nine to a page. */
  const ordered = [...tiles.filter((t) => t.source === "screen"), ...tiles.filter((t) => t.source === "camera")];
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const pageTiles = ordered.slice(current * PAGE, current * PAGE + PAGE);
  const pagerH = pages > 1 ? 28 : 0;
  const plan = planGrid(pageTiles.map((t) => t.source), width, height - pagerH, GAP);
  return (
    <View style={{ width, height }}>
      <View style={{ width, height: height - pagerH }}>
        {plan.cells.map((cell) => {
          const t = pageTiles[cell.index];
          return (
            <View key={t.key} style={{ position: "absolute", left: cell.x, top: cell.y, width: cell.w, height: cell.h }}>
              <Tile tile={t} speaking={isSpeaking(t)} size={Math.min(cell.w, cell.h)} onPress={() => onPressTile(t)} onLongPress={() => onPin(t.key)} />
            </View>
          );
        })}
      </View>
      {pages > 1 && (
        <View style={{ height: pagerH, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <Pressable onPress={() => setPage(Math.max(0, current - 1))} disabled={current === 0} hitSlop={8} accessibilityLabel="Previous page" style={{ opacity: current === 0 ? 0.35 : 1 }}>
            <Ionicons name="chevron-back" size={16} color={colors.text} />
          </Pressable>
          {Array.from({ length: pages }, (_, i) => (
            <Pressable key={i} onPress={() => setPage(i)} hitSlop={6} accessibilityLabel={`Page ${i + 1}`}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i === current ? colors.yellow : "#3a3a44" }} />
            </Pressable>
          ))}
          <Pressable onPress={() => setPage(Math.min(pages - 1, current + 1))} disabled={current === pages - 1} hitSlop={8} accessibilityLabel="Next page" style={{ opacity: current === pages - 1 ? 0.35 : 1 }}>
            <Ionicons name="chevron-forward" size={16} color={colors.text} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const GAP = 6;
const PAGE = 9;
const STRIP = 72;
