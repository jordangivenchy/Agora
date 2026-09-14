/* The amphitheater: a room's audience view, the website's own
   (app/agora/[id]/page.tsx with view = "audience"). The world is the site's
   amphitheater scene itself (components/agora/AgoraScene3D.tsx, run in a
   web view by amphitheaterScene.tsx) — the bowl under the night sky, the
   crowd in its seats, the line for the one mic standing in the aisle. Over
   it, as on the site, "the open amphitheater, pictures riding the dock":
   the discussion strip (Amphitheater.tsx's chips — the stage's people past
   its two pane holders, hosts crowned) and the video dock (AgoraVideoDock:
   every live camera and share as a small tile, a row on a phone), or an
   overflow viewer's broadcast in the corner. The stage's big pictures are
   the speaker view's. A queue-matched duel never gets this view: its two
   speakers, face to face, are the whole room. */
import { memo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AmphitheaterScene from "./amphitheaterScene";
import { Avatar } from "./avatar";
import { Tile, type StageTile } from "./roomTiles";
import type { StageRole } from "./stageModel";
import { colors, fonts } from "./theme";

export interface AmphiPerson { id: string; name: string; handle: string | null; avatarUrl: string | null }
export interface AmphiStagePerson extends AmphiPerson { role: StageRole }

const seated = (p: AmphiPerson) => ({ id: p.id, username: p.handle ?? "?", name: p.name, avatarUrl: p.avatarUrl });

/* The web view, redrawn only when the people in it change. */
const Scene = memo(
  function Scene({ roomId, audience, viewerCount, queue, micHolder, micLive }: { roomId: string; audience: AmphiPerson[]; viewerCount: number; queue: AmphiPerson[]; micHolder: AmphiPerson | null; micLive: boolean }) {
    return (
      <AmphitheaterScene
        roomId={roomId}
        audience={audience.map(seated)}
        viewerCount={viewerCount}
        queue={queue.map(seated)}
        micHolder={micHolder ? seated(micHolder) : null}
        micLive={micLive}
        performanceMode={false}
        dom={{ style: StyleSheet.absoluteFill, scrollEnabled: false, bounces: false, contentInsetAdjustmentBehavior: "never" }}
      />
    );
  },
  (a, b) =>
    a.roomId === b.roomId && a.viewerCount === b.viewerCount && a.micLive === b.micLive &&
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

export function Amphitheater(p: {
  width: number;
  height: number;
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
  const { width, height, bottomInset } = p;
  const dockH = p.dock.length || p.broadcast ? DOCK_H : 0;
  const dockTop = height - bottomInset - dockH;
  /* The scene's frame: everything above the dock, and a third wider than the
     phone — the site solves its lens from the frame's shape, and a portrait
     frame would push the bowl far off; the wings run off the sides instead. */
  const sceneW = Math.round(width * 1.3);
  const sceneH = Math.max(220, height - bottomInset + 20);

  return (
    <View style={{ width, height, overflow: "hidden", backgroundColor: "#05070f" }}>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: Math.round((width - sceneW) / 2), width: sceneW, height: sceneH }}>
        <Scene roomId={p.roomId} audience={p.audience} viewerCount={p.viewerCount} queue={p.queue} micHolder={p.micHolder} micLive={p.micLive} />
      </View>

      {/* The discussion strip: the stage's people past the pane holders. */}
      {p.strip.length > 0 && (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: dockTop - 86, alignItems: "center" }}>
          <View style={{ flexDirection: "row", gap: 14, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, backgroundColor: "#0b0b0d", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", maxWidth: width - 20 }}>
            {p.strip.slice(0, 5).map((person) => (
              <StripChip key={person.id} person={person} speaking={p.speaking.has(person.id)} onPress={() => p.onPressStrip(person)} />
            ))}
            {p.strip.length > 5 && <Text style={{ alignSelf: "center", color: colors.muted, fontFamily: fonts.bold, fontSize: 11 }}>+{p.strip.length - 5}</Text>}
          </View>
        </View>
      )}

      {/* The dock: every live picture, a row of small tiles; or the broadcast. */}
      {dockH > 0 && (
        <View style={{ position: "absolute", left: 10, right: 10, top: dockTop, height: dockH }}>
          {p.broadcast ? (
            <View style={{ alignSelf: "flex-end", width: Math.round(dockH * 16 / 9), height: dockH, borderRadius: 9, overflow: "hidden" }}>{p.broadcast}</View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {p.dock.map((tile) => (
                <View key={tile.key} style={{ width: 96, height: dockH }}>
                  <Tile tile={tile} small speaking={tile.source === "camera" && p.speaking.has(tile.identity)} onPress={() => p.onPressTile(tile)} />
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}
