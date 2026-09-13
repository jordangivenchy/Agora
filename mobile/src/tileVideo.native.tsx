/* A live picture: LiveKit's video view over the tile. The local camera
   is mirrored, a shared screen is fitted rather than cropped. */
import { StyleSheet } from "react-native";
import type { TrackReference } from "@livekit/react-native";
import { loadLiveKit } from "./livekit";
import type { CallTile } from "./roomCall";

export function TileVideo({ tile }: { tile: CallTile }) {
  const lk = loadLiveKit();
  if (!lk) return null;
  const Video = lk.VideoTrack;
  return <Video trackRef={tile.ref as TrackReference} style={StyleSheet.absoluteFill} objectFit={tile.source === "screen" ? "contain" : "cover"} mirror={tile.local && tile.source === "camera"} />;
}
