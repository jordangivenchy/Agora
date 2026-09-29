/* The verification mark, drawn as the site draws it
   (components/VerifiedBadge.tsx): the seal in the brand yellow with the
   check in ink. VerifiedBadge always draws, for a screen that already
   has the flag; VerifiedMark goes right after any name, asks the shared
   list (verified.ts) by id or username, and draws nothing for everyone
   else. Size it to the name's own type; it never shrinks, so a long name
   gives way first. For a name inside a sentence, `inline` sets it on the
   line like a word — a space before it, lowered a touch as the site's
   is — and then it must sit inside a <Text>. */
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useVerified } from "./verified";

/* VoiceOver reads the seal as one element only when it's `accessible`;
   the web build would write that onto the <svg> as a stray attribute. */
const A11Y = Platform.OS === "web" ? {} : { accessible: true };

export function VerifiedBadge({ size = 15, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      {...A11Y}
      accessibilityRole="image"
      accessibilityLabel="Verified account"
      style={StyleSheet.flatten([{ flexShrink: 0 }, style])}
    >
      <Path
        d="M12 1.8l2.3 2 3-.4 1.2 2.8 2.8 1.2-.4 3 2 2.3-2 2.3.4 3-2.8 1.2-1.2 2.8-3-.4-2.3 2-2.3-2-3 .4-1.2-2.8L2.7 17l.4-3-2-2.3 2-2.3-.4-3 2.8-1.2L6.7 2.4l3 .4z"
        fill="#ffb700"
      />
      <Path d="M8.3 12.4l2.5 2.5 5-5.3" stroke="#1a0e00" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function VerifiedMark({ id, username, size = 15, inline, style }: {
  id?: string | null;
  username?: string | null;
  size?: number;
  /** Inside a sentence: a space, then the mark on the line. Only inside a <Text>. */
  inline?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (!useVerified({ id, username })) return null;
  if (inline) {
    return (
      <>
        {" "}
        <View style={[{ transform: [{ translateY: Math.round(size * 0.15) }] }, style]}>
          <VerifiedBadge size={size} />
        </View>
      </>
    );
  }
  return <VerifiedBadge size={size} style={style} />;
}
