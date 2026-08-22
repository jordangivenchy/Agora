/* Markdown-subset parser for community posts / comments. Pure functions —
   no React here; RichText.tsx turns the tree into elements. The subset is
   deliberately small (Reddit's toolbar) and never produces raw HTML.

   Block syntax (line-based, must start the line):
     # / ## / ###     headings
     - / *            bullet list
     1.               numbered list
     >                block quote
     ```              fenced code block
     | a | b |        table (needs a |---|---| separator on the 2nd row)
     ---              horizontal rule
   Inline syntax:
     **bold** *italic* _italic_ ~~strike~~ `code` ^(sup) ^word
     >!spoiler!< [label](https://url) https://bare.url @mention */

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "strike"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "sup"; children: Inline[] }
  | { type: "spoiler"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "url"; href: string }
  | { type: "mention"; name: string }
  | { type: "br" };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Block[] }
  | { type: "code"; text: string }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] }
  | { type: "hr" };

const URL_RX = /https?:\/\/[^\s<>"')\]]+/y;
const MENTION_RX = /@[a-zA-Z0-9_]{3,20}/y;
const SUP_WORD_RX = /\^([^\s^()]+)/y;

function isSafeUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

/* Find the closing marker for `close` starting at `from`, or -1. Stops at a
   newline so a stray opener never swallows the rest of the text. */
function findClose(src: string, close: string, from: number): number {
  const nl = src.indexOf("\n", from);
  const end = src.indexOf(close, from);
  if (end === -1) return -1;
  if (nl !== -1 && nl < end) return -1;
  return end;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ type: "text", text: buf });
    buf = "";
  };
  let i = 0;
  const n = src.length;

  /* Try a delimiter pair; on success push the node and return true. */
  const tryWrap = (open: string, close: string, make: (inner: string) => Inline | null): boolean => {
    if (!src.startsWith(open, i)) return false;
    const from = i + open.length;
    const end = findClose(src, close, from);
    if (end === -1 || end === from) return false;
    const node = make(src.slice(from, end));
    if (!node) return false;
    flush();
    out.push(node);
    i = end + close.length;
    return true;
  };

  while (i < n) {
    const ch = src[i];
    if (ch === "\n") {
      flush();
      out.push({ type: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      if (tryWrap("`", "`", (t) => ({ type: "code", text: t }))) continue;
    }
    if (ch === ">" && src.startsWith(">!", i)) {
      if (tryWrap(">!", "!<", (t) => ({ type: "spoiler", children: parseInline(t) }))) continue;
    }
    if (ch === "*") {
      /* ***bold italic*** — the toolbar produces this when both are applied. */
      if (src.startsWith("***", i)) {
        if (tryWrap("***", "***", (t) => ({ type: "bold", children: [{ type: "italic", children: parseInline(t) }] }))) continue;
      }
      if (src.startsWith("**", i)) {
        if (tryWrap("**", "**", (t) => ({ type: "bold", children: parseInline(t) }))) continue;
      }
      /* Single `*` needs a non-space right after it so "2 * 3 * 4" stays text. */
      if (src[i + 1] && !/\s/.test(src[i + 1])) {
        if (tryWrap("*", "*", (t) => (/\s$/.test(t) ? null : { type: "italic", children: parseInline(t) }))) continue;
      }
    }
    if (ch === "_") {
      /* Only at a word boundary, so snake_case_names survive. */
      const prev = i === 0 ? " " : src[i - 1];
      if (/[\s(]/.test(prev) && src[i + 1] && !/\s/.test(src[i + 1])) {
        if (tryWrap("_", "_", (t) => (/\s$/.test(t) ? null : { type: "italic", children: parseInline(t) }))) continue;
      }
    }
    if (ch === "~" && src.startsWith("~~", i)) {
      if (tryWrap("~~", "~~", (t) => ({ type: "strike", children: parseInline(t) }))) continue;
    }
    if (ch === "^") {
      if (tryWrap("^(", ")", (t) => ({ type: "sup", children: parseInline(t) }))) continue;
      SUP_WORD_RX.lastIndex = i;
      const m = SUP_WORD_RX.exec(src);
      if (m) {
        flush();
        out.push({ type: "sup", children: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const lb = findClose(src, "](", i + 1);
      if (lb !== -1 && lb > i + 1) {
        const rb = findClose(src, ")", lb + 2);
        if (rb !== -1) {
          const href = src.slice(lb + 2, rb).trim();
          if (isSafeUrl(href) && !/\s/.test(href)) {
            flush();
            out.push({ type: "link", href, children: parseInline(src.slice(i + 1, lb)) });
            i = rb + 1;
            continue;
          }
        }
      }
    }
    if (ch === "h" && (src.startsWith("http://", i) || src.startsWith("https://", i))) {
      URL_RX.lastIndex = i;
      const m = URL_RX.exec(src);
      if (m) {
        /* Trailing punctuation almost always belongs to the sentence. */
        let u = m[0];
        while (/[.,;:!?]$/.test(u)) u = u.slice(0, -1);
        flush();
        out.push({ type: "url", href: u });
        i += u.length;
        continue;
      }
    }
    if (ch === "@") {
      const prev = i === 0 ? " " : src[i - 1];
      if (!/[a-zA-Z0-9_]/.test(prev)) {
        MENTION_RX.lastIndex = i;
        const m = MENTION_RX.exec(src);
        if (m) {
          flush();
          out.push({ type: "mention", name: m[0].slice(1) });
          i += m[0].length;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const HEADING_RX = /^(#{1,3})\s+(.*)$/;
const BULLET_RX = /^[-*]\s+(.*)$/;
const ORDERED_RX = /^\d+\.\s+(.*)$/;
const QUOTE_RX = /^>\s?(.*)$/;
const HR_RX = /^-{3,}\s*$/;
const FENCE_RX = /^```/;
const TABLE_SEP_RX = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", children: parseInline(para.join("\n")) });
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (FENCE_RX.test(line)) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RX.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or EOF)
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    if (HR_RX.test(line)) {
      flushPara();
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const h = HEADING_RX.exec(line);
    if (h) {
      flushPara();
      blocks.push({ type: "heading", level: h[1].length as 1 | 2 | 3, children: parseInline(h[2]) });
      i++;
      continue;
    }

    if (BULLET_RX.test(line) || ORDERED_RX.test(line)) {
      flushPara();
      const ordered = ORDERED_RX.test(line);
      const rx = ordered ? ORDERED_RX : BULLET_RX;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = rx.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (QUOTE_RX.test(line) && !line.startsWith(">!")) {
      flushPara();
      const inner: string[] = [];
      while (i < lines.length) {
        const m = QUOTE_RX.exec(lines[i]);
        if (!m || lines[i].startsWith(">!")) break;
        inner.push(m[1]);
        i++;
      }
      blocks.push({ type: "quote", children: parseBlocks(inner.join("\n")) });
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && TABLE_SEP_RX.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flushPara();
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = splitRow(lines[i]).map(parseInline);
        while (cells.length < header.length) cells.push([]);
        rows.push(cells.slice(0, header.length));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

/* ---- composer helpers (shared by FormatToolbar + keyboard shortcuts) ---- */

export type Edit = { value: string; selStart: number; selEnd: number };

/* Wrap [s,e) in `open`…`close`; if already wrapped, unwrap. Empty selection
   inserts the pair and parks the caret between them. */
export function wrapSelection(value: string, s: number, e: number, open: string, close = open): Edit {
  const sel = value.slice(s, e);
  /* Decide wrap vs unwrap by the run of marker characters on each side:
     `*world*` and `***world***` both carry an italic layer (odd run),
     `**world**` carries bold (run ≥ 2) but no italic. */
  const ch = open[0];
  const L = open.length;
  const same = open === close && [...open].every((c) => c === ch);
  let runL = 0, runR = 0;
  if (same) {
    while (s - runL - 1 >= 0 && value[s - runL - 1] === ch) runL++;
    while (e + runR < value.length && value[e + runR] === ch) runR++;
  }
  const wrapped = same
    ? (L === 1 ? runL % 2 === 1 && runR % 2 === 1 : runL >= L && runR >= L)
    : value.slice(s - open.length, s) === open && value.slice(e, e + close.length) === close;
  if (wrapped) {
    return {
      value: value.slice(0, s - open.length) + sel + value.slice(e + close.length),
      selStart: s - open.length,
      selEnd: s - open.length + sel.length,
    };
  }
  return {
    value: value.slice(0, s) + open + sel + close + value.slice(e),
    selStart: s + open.length,
    selEnd: s + open.length + sel.length,
  };
}

/* Toggle a prefix on every line touched by [s,e). `prefix` is a string or a
   per-line function (numbered lists). Toggles off when every touched line
   already carries a matching prefix (`strip` regex). */
export function toggleLinePrefix(
  value: string,
  s: number,
  e: number,
  prefix: string | ((n: number) => string),
  strip: RegExp,
): Edit {
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  let lineEnd = value.indexOf("\n", Math.max(e, s));
  if (e > s && value[e - 1] === "\n") lineEnd = e - 1; // selection ending at a line break
  if (lineEnd === -1) lineEnd = value.length;
  const chunk = value.slice(lineStart, lineEnd);
  const lines = chunk.split("\n");
  const allOn = lines.every((l) => strip.test(l));
  const next = lines.map((l, idx) =>
    allOn ? l.replace(strip, "") : (typeof prefix === "string" ? prefix : prefix(idx + 1)) + l.replace(strip, ""),
  );
  const replaced = next.join("\n");
  return {
    value: value.slice(0, lineStart) + replaced + value.slice(lineEnd),
    selStart: lineStart,
    selEnd: lineStart + replaced.length,
  };
}

/* Fenced code block on its own lines around the selection. */
export function wrapCodeBlock(value: string, s: number, e: number): Edit {
  const sel = value.slice(s, e);
  const before = value.slice(0, s);
  const after = value.slice(e);
  const lead = before.length === 0 || before.endsWith("\n") ? "" : "\n";
  const tail = after.length === 0 || after.startsWith("\n") ? "" : "\n";
  const open = `${lead}\`\`\`\n`;
  const inserted = `${open}${sel}\n\`\`\`${tail}`;
  return {
    value: before + inserted + after,
    selStart: s + open.length,
    selEnd: s + open.length + sel.length,
  };
}

export const TABLE_TEMPLATE = "| Header | Header |\n|---|---|\n| Cell | Cell |\n| Cell | Cell |";

export function insertBlock(value: string, s: number, e: number, text: string): Edit {
  const before = value.slice(0, s);
  const after = value.slice(e);
  const lead = before.length === 0 || before.endsWith("\n") ? "" : "\n";
  const tail = after.length === 0 || after.startsWith("\n") ? "" : "\n";
  const inserted = lead + text + tail;
  return { value: before + inserted + after, selStart: s + lead.length, selEnd: s + lead.length + text.length };
}

/* `[text](url)` with `url` selected so the user can type over it. */
export function wrapLink(value: string, s: number, e: number): Edit {
  const sel = value.slice(s, e) || "text";
  const placeholder = "url";
  const inserted = `[${sel}](${placeholder})`;
  return {
    value: value.slice(0, s) + inserted + value.slice(e),
    selStart: s + sel.length + 3,
    selEnd: s + sel.length + 3 + placeholder.length,
  };
}
