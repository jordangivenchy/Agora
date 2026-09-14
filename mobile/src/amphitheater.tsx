/* The amphitheater: a room's audience view, the website's own
   (app/agora/[id]/page.tsx with view = "audience"). The world is the site's
   amphitheater scene itself (components/agora/AgoraScene3D.tsx, run in a
   web view by amphitheaterScene.tsx) — the bowl under the night sky, the
   crowd in its seats, the line for the one mic standing in the aisle. Over
   it, as on the site, "the open amphitheater, pictures riding the dock":
   the discussion strip (Amphitheater.tsx's chips — the stage's people past
   its two pane holders, hosts crowned) and the video dock (AgoraVideoDock:
   every live camera as a small square, a share two squares wide), or an
   overflow viewer's broadcast in the corner. The speaker view is the same
   room, as on the site: the switch under the stage glides the camera down
   to the orchestra, and once it lands the pictures come up over the
   dimmed scene in the call layout; switching back takes them away and the
   camera climbs to the seats. A queue-matched duel never gets this view:
   its two speakers, face to face, are the whole room. */
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AmphitheaterScene from "./amphitheaterScene";
import { Avatar } from "./avatar";
import { Tile, type StageTile } from "./roomTiles";
import type { StageRole } from "./stageModel";
import { colors, fonts } from "./theme";

export interface AmphiPerson { id: string; name: string; handle: string | null; avatarUrl: string | null }
export type AmphiView = "audience" | "speaker";
export interface AmphiStagePerson extends AmphiPerson { role: StageRole }

const seated = (p: AmphiPerson) => ({ id: p.id, username: p.handle ?? "?", name: p.name, avatarUrl: p.avatarUrl });

/* The web view, redrawn only when the people in it or the vantage change. */
const Scene = memo(
  function Scene({ roomId, audience, viewerCount, queue, micHolder, micLive, view, onSettled }: { roomId: string; audience: AmphiPerson[]; viewerCount: number; queue: AmphiPerson[]; micHolder: AmphiPerson | null; micLive: boolean; view: AmphiView; onSettled: (view: AmphiView) => Promise<void> }) {
    return (
      <AmphitheaterScene
        roomId={roomId}
        audience={audience.map(seated)}
        viewerCount={viewerCount}
        queue={queue.map(seated)}
        micHolder={micHolder ? seated(micHolder) : null}
        micLive={micLive}
        performanceMode={false}
        view={view}
        onSettled={onSettled}
        dom={{ style: StyleSheet.absoluteFill, scrollEnabled: false, bounces: false, contentInsetAdjustmentBehavior: "never" }}
      />
    );
  },
  (a, b) =>
    a.roomId === b.roomId && a.viewerCount === b.viewerCount && a.micLive === b.micLive && a.view === b.view &&
    a.micHolder?.id === b.micHolder?.id &&
    a.audience.map((x) => x.id).join(",") === b.audience.map((x) => x.id).join(",") &&
    a.queue.map((x) => x.id).join(",") === b.queue.map((x) => x.id).join(","),
);

/* One person on the discussion strip (Amphitheater.tsx StripChip,
   agora.css .ag-strip-chip): the face with a role ring — gold for the host,
   silver for a co-host — the crown, the yellow ring while they talk. */
function StripChip({ person, speaking, onPress }: { person: AmphiStagePerson; speaking: boolean; onPress: () => void }) {
  const ring = person.role === "host" ? "#e2b96b" : person.role === "cohost" ? "#b9c2d0" : "rgba(255,255,255,0.25)";
  return (
    <Pressable onPress={onPress} accessibilityLabel={`${person.name}, ${person.role}`} style={{ alignItems: "center", gap: 4 }}>
      <View style={{ borderRadius: 21, borderWidth: 2, borderColor: speaking ? colors.yellow : ring }}>
        <Avatar url={person.avatarUrl} name={person.name} size={38} />
        {(person.role === "host" || person.role === "cohost") && (
          <View style={{ position: "absolute", top: -9, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: "#0b0b0d", alignItems: "center", justifyContent: "center" }}>
            <MaterialCommunityIcons name="crown" size={12} color={person.role === "host" ? "#e2b96b" : "#b9c2d0"} />
          </View>
        )}
      </View>
      <Text numberOfLines={1} style={{ color: "#cfd3dc", fontFamily: fonts.semi, fontSize: 10.5, maxWidth: 64 }}>{person.name}</Text>
    </Pressable>
  );
}

export const DOCK_H = 72;
const SWITCH_H = 44;
const STRIP_H = 78;

/* The site's stage rail (Amphitheater.tsx .ag-switch-view): one button
   under the stage, in solid black here rather than the site's glass. */
function SwitchView({ inSpeaker, onPress }: { inSpeaker: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={inSpeaker ? "Switch audience view" : "Switch speaker view"}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, height: SWITCH_H, paddingLeft: 14, paddingRight: 18, borderRadius: 12, backgroundColor: pressed ? "#16161b" : "#0b0b0d", borderWidth: 1, borderColor: "#2a2a33", transform: [{ scale: pressed ? 0.98 : 1 }] })}
    >
      <Ionicons name="desktop-outline" size={16} color="#dfe3ec" />
      <View>
        <Text style={{ color: "#cfd3dc", fontFamily: fonts.bold, fontSize: 13, lineHeight: 16 }}>{inSpeaker ? "Switch audience view" : "Switch speaker view"}</Text>
        <Text style={{ color: "#8a8f9c", fontFamily: fonts.body, fontSize: 10.5, lineHeight: 13 }}>{inSpeaker ? "back to the amphitheater" : "focused view of the speakers"}</Text>
      </View>
    </Pressable>
  );
}

export function Amphitheater(p: {
  width: number;
  height: number;
  view: AmphiView;
  onSwitchView: () => void;
  /** The speaker view's pictures, in the room left above the switch. */
  speakerLayout: (area: { width: number; height: number }) => ReactNode;
  /** Room the overlays at the foot of the room take (the queue pill, the host's button, the controls). */
  bottomInset: number;
  roomId: string;
  /** In their seats: listeners not in the line and not on the mic. */
  audience: AmphiPerson[];
  viewerCount: number;
  /** The line, front first, the mic holder not in it. */
  queue: AmphiPerson[];
  micHolder: AmphiPerson | null;
  micLive: boolean;
  /** The stage's people past its two pane holders. */
  strip: AmphiStagePerson[];
  /** Every live picture: cameras and shares. */
  dock: StageTile[];
  speaking: ReadonlySet<string>;
  /** An overflow viewer's broadcast, small in the corner. */
  broadcast?: ReactNode;
  onPressTile: (tile: StageTile) => void;
  onPressStrip: (person: AmphiStagePerson) => void;
}) {
  const { width, height, bottomInset, view } = p;
  /* Where the camera has landed. The pictures wait for the speaker vantage
     (the site holds its stage back the same way); the fallback covers a
     report lost over the bridge. */
  const [landed, setLanded] = useState<AmphiView>(view);
  const viewRef = useRef(view);
  viewRef.current = view;
  const onSettled = useCallback(async (v: AmphiView) => { if (v === viewRef.current) setLanded(v); }, []);
  useEffect(() => {
    if (landed === view) return;
    const t = setTimeout(() => setLanded(viewRef.current), 1800);
    return () => clearTimeout(t);
  }, [view, landed]);
  const inSpeaker = view === "speaker";
  const picturesUp = inSpeaker && landed === "speaker";
  /* The scene dims as the camera goes down; the pictures fade in on arrival. */
  const veil = useRef(new Animated.Value(inSpeaker ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(veil, { toValue: inSpeaker ? 1 : 0, duration: 600, useNativeDriver: true }).start();
  }, [inSpeaker, veil]);
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!picturesUp) { shown.setValue(0); return; }
    const frame = requestAnimationFrame(() => Animated.timing(shown, { toValue: 1, duration: 260, useNativeDriver: true }).start());
    return () => cancelAnimationFrame(frame);
  }, [picturesUp, shown]);

  const base = height - bottomInset;
  const dockH = !inSpeaker && (p.dock.length || p.broadcast) ? DOCK_H : 0;
  const dockTop = base - dockH;
  const switchTop = (dockH ? dockTop - 10 : base - 2) - SWITCH_H;
  /* The scene's frame: everything above the dock, and a third wider than the
     phone — the site solves its lens from the frame's shape, and a portrait
     frame would push the bowl far off; the wings run off the sides instead. */
  const sceneW = Math.round(width * 1.3);
  const sceneH = Math.max(220, height - bottomInset + 20);

  return (
    <View style={{ width, height, overflow: "hidden", backgroundColor: "#05070f" }}>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: Math.round((width - sceneW) / 2), width: sceneW, height: sceneH }}>
        <Scene roomId={p.roomId} audience={p.audience} viewerCount={p.viewerCount} queue={p.queue} micHolder={p.micHolder} micLive={p.micLive} view={view} onSettled={onSettled} />
      </View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#05070f", opacity: veil.interpolate({ inputRange: [0, 1], outputRange: [0, 0.62] }) }]} />

      {/* The speaker view: the call layout over the dimmed scene, once the camera has landed. */}
      {inSpeaker && (
        <Animated.View pointerEvents={picturesUp ? "box-none" : "none"} style={{ position: "absolute", left: 10, top: 8, width: width - 20, height: Math.max(120, switchTop - 18), opacity: shown }}>
          {picturesUp && p.speakerLayout({ width: width - 20, height: Math.max(120, switchTop - 18) })}
        </Animated.View>
      )}

      {/* The discussion strip: the stage's people past the pane holders. */}
      {!inSpeaker && p.strip.length > 0 && (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: switchTop - 8 - STRIP_H, alignItems: "center" }}>
          <View style={{ flexDirection: "row", gap: 14, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", maxWidth: width - 20 }}>
            {p.strip.slice(0, 5).map((person) => (
              <StripChip key={person.id} person={person} speaking={p.speaking.has(person.id)} onPress={() => p.onPressStrip(person)} />
            ))}
            {p.strip.length > 5 && <Text style={{ alignSelf: "center", color: colors.muted, fontFamily: fonts.bold, fontSize: 11 }}>+{p.strip.length - 5}</Text>}
          </View>
        </View>
      )}

      {/* The switch, under the stage. */}
      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: switchTop, alignItems: "center" }}>
        <SwitchView inSpeaker={inSpeaker} onPress={p.onSwitchView} />
      </View>

      {/* The dock: every live picture, a row of small tiles; or the broadcast. */}
      {dockH > 0 && (
        <View style={{ position: "absolute", left: 10, right: 10, top: dockTop, height: dockH }}>
          {p.broadcast ? (
            <View style={{ alignSelf: "flex-end", width: Math.round(dockH * 16 / 9), height: dockH, borderRadius: 9, overflow: "hidden" }}>{p.broadcast}</View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {p.dock.map((tile) => (
                /* Square windows, a screen two wide, as in the speaker view's grid. */
                <View key={tile.key} style={{ width: tile.source === "screen" ? dockH * 2 + 8 : dockH, height: dockH }}>
                  <Tile tile={tile} small size={dockH} speaking={tile.source === "camera" && p.speaking.has(tile.identity)} onPress={() => p.onPressTile(tile)} />
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}
