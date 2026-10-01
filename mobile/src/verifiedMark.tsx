/* The verification mark, drawn as the site draws it
   (components/VerifiedBadge.tsx, which says how the outline is built):
   the seal in the brand yellow with the check in ink. Not in a call.
   VerifiedBadge always draws, for a screen that already has the flag;
   VerifiedMark goes right after any name, asks the shared list
   (verified.ts) by id or username, and draws nothing for everyone
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
        d="M8.25 2.94A4.6 4.6 0 0 1 15.75 2.94A4.6 4.6 0 0 1 21.06 8.25A4.6 4.6 0 0 1 21.06 15.75A4.6 4.6 0 0 1 15.75 21.06A4.6 4.6 0 0 1 8.25 21.06A4.6 4.6 0 0 1 2.94 15.75A4.6 4.6 0 0 1 2.94 8.25A4.6 4.6 0 0 1 8.25 2.94Z"
        fill="#ffb700"
      />
      <Path d="M7.6 12.05L10.6 14.95L16.4 9.05" stroke="#1a0e00" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
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
