/* Plain text with its links live: room chat and messages. A link to
   AgoraSphere opens its screen; any other opens in the in-app browser.
   A long press on a link still reaches the message's own menu. Inside a
   sheet, beforeOpen closes it first and the link opens once it is down,
   so nothing opens underneath it. */
import { Fragment, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { URL_RE, openLink } from "./siteLinks";
import { LINK_STYLE } from "./richText";
import { AFTER_SHEET_MS } from "./itemSheet";

export function LinkedText({ text, style, linkStyle, numberOfLines, onLongPress, beforeOpen }: { text: string; style?: StyleProp<TextStyle>; linkStyle?: StyleProp<TextStyle>; numberOfLines?: number; onLongPress?: () => void; beforeOpen?: () => void }) {
  const open = (url: string) => {
    if (!beforeOpen) return void openLink(url);
    beforeOpen();
    setTimeout(() => void openLink(url), AFTER_SHEET_MS);
  };
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(<Fragment key={`t${i++}`}>{text.slice(last, start)}</Fragment>);
    const url = m[0];
    parts.push(
      <Text key={`u${i++}`} style={[LINK_STYLE, linkStyle]} onPress={() => open(url)} onLongPress={onLongPress} accessibilityRole="link">
        {url}
      </Text>,
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(<Fragment key={`t${i++}`}>{text.slice(last)}</Fragment>);
  return <Text style={style} numberOfLines={numberOfLines}>{parts}</Text>;
}
