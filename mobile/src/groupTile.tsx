/* A group's picture: two members' avatars stacked; one; or a users tile. */
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "./avatar";
import type { GroupMember } from "./messages";
import { colors } from "./theme";

export function GroupTile({ members, size = 44 }: { members: GroupMember[]; size?: number }) {
  const pair = members.slice(0, 2);
  if (pair.length === 2) {
    const s = Math.round(size * 0.68);
    return (
      <View style={{ width: size, height: size }}>
        <View style={{ position: "absolute", top: 0, right: 0 }}><Avatar url={pair[1].avatar_url} name={pair[1].username} size={s} /></View>
        <View style={{ position: "absolute", bottom: 0, left: 0, borderRadius: s / 2 + 2, borderWidth: 2, borderColor: colors.bg }}><Avatar url={pair[0].avatar_url} name={pair[0].username} size={s} /></View>
      </View>
    );
  }
  if (pair.length === 1) return <Avatar url={pair[0].avatar_url} name={pair[0].username} size={size} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#1e2129", alignItems: "center", justifyContent: "center" }}>
      <Ionicons name="people-outline" size={Math.round(size * 0.44)} color="#c9c9d2" />
    </View>
  );
}
