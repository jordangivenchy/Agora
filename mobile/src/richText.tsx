/* Post and comment text: the site's markdown (components/community/
   RichText.tsx), rendered plainly — bold, italics, strikethrough, code,
   spoilers that open on a tap, lists as bullets — with links and
   @mentions in the site's blue. A link to one of AgoraSphere's own pages
   opens that screen; any other opens in the in-app browser; a mention
   opens the person. */
import { Fragment, useState, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { router } from "expo-router";
import { openLink } from "./siteLinks";
import { colors, fonts } from "./theme";

const INLINE = new RegExp(
  [
    String.raw`\*\*[^*\n]+\*\*`,
    String.raw`(?<!\w)__[^_\n]+__(?!\w)`,
    String.raw`\*[^*\n]+\*`,
    String.raw`(?<!\w)_[^_\n]+_(?!\w)`,
    String.raw`~~[^~\n]+~~`,
    "`[^`\\n]+`",
    String.raw`\[[^\]\n]+\]\([^)\s]+\)`,
    String.raw`>![^\n]+?!<`,
    String.raw`https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]`,
    String.raw`(?<![\w/@])@[A-Za-z0-9_]{1,20}(?![\w@])`,
  ].join("|"),
  "g",
);

export const LINK_STYLE: TextStyle = { color: colors.blueText, textDecorationLine: "underline" };
export const MENTION_STYLE: TextStyle = { color: colors.blueText, fontFamily: fonts.semi };

/* Marks dropped, whitespace folded: the one-line preview of a body.
   Emphasis goes by its pairs, so a name like @jo_ann keeps its underscore. */
export function plainPreview(md: string | null | undefined): string {
  if (!md) return "";
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`+/g, "")
    .replace(/^\s{0,3}(#{1,6}|>(?!!)|[-*+]|\d+\.)\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(?<!\w)__([^_\n]+)__(?!\w)/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function Spoiler({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Text
      onPress={open ? undefined : () => setOpen(true)}
      accessibilityRole={open ? undefined : "button"}
      accessibilityLabel={open ? undefined : "Spoiler, tap to reveal"}
      style={open ? { backgroundColor: "#1f1f26" } : { backgroundColor: "#34343d", color: "transparent" }}
    >
      {text}
    </Text>
  );
}

function openMention(name: string) {
  router.push({ pathname: "/u/[username]", params: { username: name } });
}

/** One line of markdown as pieces — for callers that own their own
    <Text> (the home notice, which clamps its own lines). */
export function inlineRich(text: string, key: string): ReactNode[] {
  return inline(text, key);
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
    else if (tok.startsWith("~~")) out.push(<Text key={`${key}-s${i++}`} style={{ textDecorationLine: "line-through" }}>{tok.slice(2, -2)}</Text>);
    else if (tok.startsWith("`")) out.push(<Text key={`${key}-c${i++}`} style={{ fontFamily: "Menlo", fontSize: 12, color: colors.gold }}>{tok.slice(1, -1)}</Text>);
    else if (tok.startsWith("[")) {
      const cut = tok.indexOf("](");
      const label = tok.slice(1, cut);
      const href = tok.slice(cut + 2, -1);
      /* Only http(s) links survive, as on the site; anything else is its label. */
      if (/^https?:\/\//i.test(href)) out.push(<Text key={`${key}-l${i++}`} style={LINK_STYLE} onPress={() => void openLink(href)} accessibilityRole="link">{label}</Text>);
      else out.push(<Fragment key={`${key}-l${i++}`}>{label}</Fragment>);
    } else if (tok.startsWith(">!")) out.push(<Spoiler key={`${key}-x${i++}`} text={tok.slice(2, -2)} />);
    else if (tok.startsWith("http")) out.push(<Text key={`${key}-u${i++}`} style={LINK_STYLE} onPress={() => void openLink(tok)} accessibilityRole="link">{tok}</Text>);
    else if (tok.startsWith("@")) out.push(<Text key={`${key}-m${i++}`} style={MENTION_STYLE} onPress={() => openMention(tok.slice(1))} accessibilityRole="link">{tok}</Text>);
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
        const lines = p.split("\n").map((l) => l.replace(/^\s{0,3}(#{1,6})\s+/, "").replace(/^\s{0,3}([-*+]|\d+\.)\s+/, "•  ").replace(/^\s{0,3}>(?!!)\s?/, "").replace(/!\[[^\]]*\]\([^)]*\)/g, ""));
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
