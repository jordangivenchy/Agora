import { Image, Text, View } from "react-native";
import { colors } from "./theme";

/** A face: the photo, or the initial on the site's dark surface. `ring` lights it up. */
export function Avatar({ url, name, size, ring, dim }: { url: string | null | undefined; name: string; size: number; ring?: boolean; dim?: boolean }) {
  const initial = name.replace(/^@/, "").slice(0, 1).toUpperCase() || "?";
  const border = ring ? 3 : 1;
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2, overflow: "hidden", alignItems: "center", justifyContent: "center",
        backgroundColor: colors.surface2, borderWidth: border, borderColor: ring ? colors.yellow : colors.border, opacity: dim ? 0.55 : 1,
      }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: size - border * 2, height: size - border * 2, borderRadius: size / 2 }} />
      ) : (
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: Math.round(size * 0.38) }}>{initial}</Text>
      )}
    </View>
  );
}
