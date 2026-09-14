/* The pictures (components/agora/CallLayouts.tsx, the site's two flat
   layouts): every on-stage person as a tile, live camera or the avatar
   plate, the name tag, the mute badge, a yellow ring while they talk; a
   shared screen as a tile of its own. Gallery is Discord's grid
   (callGrid.ts): square windows as big as the room allows, a screen two
   windows wide; past nine places the last window is "+N", who is in view
   decided by gallerySlots.ts, and tapping it lists the rest to pin one.
   Multi-speaker features one picture (a share first, then whoever is
   pinned, then the last to speak) over a strip of square windows. Tap a
   tile for the person; hold it to pin. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "./avatar";
import { TileVideo } from "./tileVideo";
import type { CallTile } from "./roomCall";
import { planGrid } from "./callGrid";
import { planSlots, type SlotPerson } from "./gallerySlots";
import { ItemSheet } from "./itemSheet";
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

  const { shown: inView, hidden: behind } = useGallerySlots(tiles, speaking, pinned, layout === "gallery");
  const [moreOpen, setMoreOpen] = useState(false);

  /* Windows glide to their new places when someone comes on, leaves or trades a window, as Discord's do. */
  const arrangement = `${layout}|${inView.map((t) => t.key).join(",")}|${behind.length}`;
  const arranged = useRef(arrangement);
  if (arranged.current !== arrangement) {
    arranged.current = arrangement;
    LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
  }

  const share = tiles.find((t) => t.source === "screen") ?? null;
  const featuredKey = useMemo(() => {
    if (pinned && tiles.some((t) => t.key === pinned)) return pinned;
    if (share) return share.key;
    if (lastSpeaker && tiles.some((t) => t.key === lastSpeaker)) return lastSpeaker;
    return tiles[0]?.key ?? null;
  }, [pinned, share, lastSpeaker, tiles]);

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

  /* Gallery: screens first, then the people in view, then "+N" for the rest. */
  const kinds = [...inView.map((t) => t.source), ...(behind.length ? (["camera"] as const) : [])];
  const plan = planGrid(kinds, width, height, GAP);
  return (
    <View style={{ width, height }}>
      {plan.cells.map((cell) => {
        const t = inView[cell.index];
        if (!t) {
          return (
            <View key="more" style={{ position: "absolute", left: cell.x, top: cell.y, width: cell.w, height: cell.h }}>
              <MoreTile people={behind} speaking={speaking} size={Math.min(cell.w, cell.h)} onPress={() => setMoreOpen(true)} />
            </View>
          );
        }
        return (
          <View key={t.key} style={{ position: "absolute", left: cell.x, top: cell.y, width: cell.w, height: cell.h }}>
            <Tile tile={t} speaking={isSpeaking(t)} size={Math.min(cell.w, cell.h)} onPress={() => onPressTile(t)} onLongPress={() => onPin(pinned === t.key ? null : t.key)} />
            {pinned === t.key && (
              <Pressable onPress={() => onPin(null)} hitSlop={8} accessibilityLabel="Unpin" style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: "#0a0a0c", alignItems: "center", justifyContent: "center", borderWidth: one, borderColor: "#2a2a33" }}>
                <Ionicons name="pin" size={12} color={colors.yellow} />
              </Pressable>
            )}
          </View>
        );
      })}
      <ItemSheet
        open={moreOpen}
        title={`${behind.length} more on stage · pick one to keep in view`}
        onClose={() => setMoreOpen(false)}
        items={behind.map((t) => ({
          icon: speaking.has(t.identity) ? "mic" : t.call ? "videocam-outline" : "person-circle-outline",
          label: t.local ? "You" : t.username,
          run: () => onPin(t.key),
        }))}
      />
    </View>
  );
}

/* The last window past nine: the first few faces of everyone behind it, how many, and a yellow ring when one of them is talking. */
function MoreTile({ people, speaking, size, onPress }: { people: StageTile[]; speaking: ReadonlySet<string>; size: number; onPress: () => void }) {
  const talking = people.some((t) => speaking.has(t.identity));
  const face = Math.round(Math.max(22, Math.min(44, size * 0.24)));
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${people.length} more on stage`}
      style={({ pressed }) => ({ flex: 1, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", gap: Math.round(size * 0.06), backgroundColor: pressed ? "#15151a" : "#0e0e11", borderWidth: talking ? 2 : one, borderColor: talking ? colors.yellow : "#2a2a33" })}
    >
      <View style={{ flexDirection: "row" }}>
        {people.slice(0, 3).map((t, i) => (
          /* The first face — a talker, when there is one — sits on top. */
          <View key={t.key} style={{ marginLeft: i ? -Math.round(face * 0.32) : 0, zIndex: 3 - i, borderRadius: face, borderWidth: 2, borderColor: "#0e0e11" }}>
            <Avatar url={t.avatarUrl} name={t.username} size={face} ring={speaking.has(t.identity)} />
          </View>
        ))}
      </View>
      <Text style={{ color: colors.text, fontFamily: fonts.bold, fontSize: Math.round(Math.max(13, Math.min(22, size * 0.13))) }}>+{people.length}</Text>
    </Pressable>
  );
}

/* The gallery's windows (gallerySlots.ts): who is in view, kept in their
   spots from one moment to the next, re-planned as people talk and every
   second while someone is waiting behind "+N". */
function useGallerySlots(tiles: StageTile[], speaking: ReadonlySet<string>, pinned: string | null, active: boolean): { shown: StageTile[]; hidden: StageTile[] } {
  const joined = useRef(new Map<string, number>());
  const nextJoin = useRef(0);
  const since = useRef(new Map<string, number>());
  const last = useRef(new Map<string, number>());
  const slots = useRef<string[]>([]);
  const [tick, setTick] = useState(0);

  const screens = tiles.filter((t) => t.source === "screen");
  const people = tiles.filter((t) => t.source === "camera");
  const places = Math.max(1, PLACES - screens.length * 2);
  const crowded = active && people.length > places;
  useEffect(() => {
    if (!crowded) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [crowded]);

  const order = useCallback((key: string) => {
    if (!joined.current.has(key)) joined.current.set(key, nextJoin.current++);
    return joined.current.get(key)!;
  }, []);

  return useMemo(() => {
    const now = Date.now();
    for (const t of people) {
      if (speaking.has(t.identity)) {
        if (!since.current.has(t.key)) since.current.set(t.key, now);
        last.current.set(t.key, now);
      } else {
        since.current.delete(t.key);
      }
    }
    const info: SlotPerson[] = people.map((t) => ({
      key: t.key,
      speakingSince: since.current.get(t.key) ?? null,
      lastSpoke: last.current.get(t.key) ?? 0,
      cameraOn: !!t.call,
      local: t.local,
      host: t.roleLabel === "Host" || t.roleLabel === "Co-host",
      join: order(t.key),
    }));
    const plan = active ? planSlots(slots.current, info, places, pinned, now) : { shown: info.sort((a, b) => a.join - b.join).map((p) => p.key), hidden: [] };
    slots.current = plan.shown;
    const byKey = new Map(people.map((t) => [t.key, t] as const));
    return { shown: [...screens, ...plan.shown.map((k) => byKey.get(k)!)], hidden: plan.hidden.map((k) => byKey.get(k)!) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, speaking, pinned, active, places, tick]);
}

const GAP = 6;
/* Three rows of three on a phone. */
const PLACES = 9;
const STRIP = 72;
