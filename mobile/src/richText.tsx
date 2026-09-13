/* Post and comment text: the site's markdown, rendered plainly — bold,
   italics, code, links and mentions as coloured text, lists as bullets. */
import { Fragment, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { colors, fonts } from "./theme";

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s)]+|(?<![\w@])@[A-Za-z0-9_]{2,})/g;

/* Marks dropped, whitespace folded: the one-line preview of a body. */
export function plainPreview(md: string | null | undefined): string {
  if (!md) return "";
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`+/g, "")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(<Fragment key={`${key}-t${i++}`}>{text.slice(last, start)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) out.push(<Text key={`${key}-b${i++}`} style={{ fontFamily: fonts.bold }}>{tok.slice(2, -2)}</Text>);
    else if (tok.startsWith("`")) out.push(<Text key={`${key}-c${i++}`} style={{ fontFamily: "Menlo", fontSize: 12, color: colors.gold }}>{tok.slice(1, -1)}</Text>);
    else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]("));
      out.push(<Text key={`${key}-l${i++}`} style={{ color: colors.yellow }}>{label}</Text>);
    } else if (tok.startsWith("http")) out.push(<Text key={`${key}-u${i++}`} style={{ color: colors.yellow }}>{tok}</Text>);
    else if (tok.startsWith("@")) out.push(<Text key={`${key}-m${i++}`} style={{ color: colors.blueText }}>{tok}</Text>);
    else out.push(<Text key={`${key}-i${i++}`} style={{ fontStyle: "italic" }}>{tok.slice(1, -1)}</Text>);
    last = start + tok.length;
  }
  if (last < text.length) out.push(<Fragment key={`${key}-t${i++}`}>{text.slice(last)}</Fragment>);
  return out;
}

export function RichText({ text, style, numberOfLines }: { text: string | null | undefined; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  if (!text) return null;
  const paragraphs = text.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (numberOfLines) {
    return <Text numberOfLines={numberOfLines} style={style}>{inline(plainPreview(text), "p")}</Text>;
  }
  return (
    <>
      {paragraphs.map((p, pi) => {
        const lines = p.split("\n").map((l) => l.replace(/^\s{0,3}(#{1,6})\s+/, "").replace(/^\s{0,3}([-*+]|\d+\.)\s+/, "•  ").replace(/^\s{0,3}>\s?/, "").replace(/!\[[^\]]*\]\([^)]*\)/g, ""));
        const heading = /^\s{0,3}#{1,6}\s+/.test(p);
        return (
          <Text key={pi} style={[style, pi > 0 && { marginTop: 10 }, heading && { fontFamily: fonts.bold, fontSize: 15 }]}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 ? "\n" : null}
                {inline(l, `${pi}-${li}`)}
              </Fragment>
            ))}
          </Text>
        );
      })}
    </>
  );
}
