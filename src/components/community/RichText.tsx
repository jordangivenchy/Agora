"use client";

/* Renders stored markdown (GFM via react-markdown + remark-gfm) plus the
   Reddit-style extras the composer emits:
     >!spoiler!<   click-to-reveal span
     ^(x) / ^x     <sup>
     @name         link to /users/name
   Only http(s) links survive; everything else degrades to plain text.
   Styles live in globals.css under `.rich-text` (shared with the editor so
   WYSIWYG matches output). */

import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Parent, PhrasingContent, Root, Text } from "mdast";

type MdNode = Parent | PhrasingContent | Root;

/* ---------- remark plugin: spoilers, superscript, mentions ---------- */

const MENTION = /(^|[^\w/])@([a-zA-Z0-9_]{1,20})(?![\w@])/g;
const SUP_WORD = /\^(\S+)/g;

function textNode(value: string): Text {
  return { type: "text", value };
}

/* Wrap `open … close` (possibly spanning sibling inline nodes, e.g.
   `>!**bold** text!<`) into a node rendered as `tag`. */
function wrapDelimited(parent: Parent, open: string, close: string, tag: string, props: Record<string, unknown>) {
  const kids = parent.children as PhrasingContent[];
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.type !== "text") continue;
    const oi = n.value.indexOf(open);
    if (oi < 0) continue;
    /* find the closing delimiter at or after this node */
    for (let j = i; j < kids.length; j++) {
      const m = kids[j];
      if (m.type !== "text") continue;
      const from = j === i ? oi + open.length : 0;
      const ci = m.value.indexOf(close, from);
      if (ci < 0) continue;
      if (j === i && ci === from) continue; // empty `>!!<`
      /* split the opening node */
      const before = n.value.slice(0, oi);
      const innerStart = j === i ? n.value.slice(oi + open.length, ci) : n.value.slice(oi + open.length);
      const innerEnd = j === i ? "" : m.value.slice(0, ci);
      const after = m.value.slice(ci + close.length);
      const inner: PhrasingContent[] = [];
      if (innerStart) inner.push(textNode(innerStart));
      if (j > i) inner.push(...kids.slice(i + 1, j));
      if (innerEnd) inner.push(textNode(innerEnd));
      const wrapped = { type: "spoilerLike", data: { hName: tag, hProperties: props }, children: inner } as unknown as PhrasingContent;
      const repl: PhrasingContent[] = [];
      if (before) repl.push(textNode(before));
      repl.push(wrapped);
      if (after) repl.push(textNode(after));
      kids.splice(i, j - i + 1, ...repl);
      i += repl.length - 2; // re-scan the `after` node for more
      break;
    }
  }
}

function splitText(parent: Parent, fn: (value: string) => PhrasingContent[] | null) {
  const kids = parent.children as PhrasingContent[];
  for (let i = kids.length - 1; i >= 0; i--) {
    const n = kids[i];
    if (n.type !== "text") continue;
    const out = fn(n.value);
    if (out) kids.splice(i, 1, ...out);
  }
}

const SKIP = new Set(["inlineCode", "code", "link", "linkReference", "spoilerLike"]);

function walk(node: MdNode, inLink = false) {
  if (!("children" in node) || !Array.isArray(node.children)) return;
  const parent = node as Parent;
  const isPhrasingParent = parent.children.some((c) => c.type === "text");
  if (isPhrasingParent) {
    wrapDelimited(parent, ">!", "!<", "span", { className: "rt-spoiler" });
    wrapDelimited(parent, "^(", ")", "sup", {});
    splitText(parent, (value) => {
      if (!/[@^]/.test(value)) return null;
      const out: PhrasingContent[] = [];
      let last = 0;
      const re = new RegExp(`${MENTION.source}|${SUP_WORD.source}`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(value))) {
        if (m[2] !== undefined) {
          const pre = m[1];
          if (m.index + pre.length > last) out.push(textNode(value.slice(last, m.index + pre.length)));
          if (inLink) out.push(textNode(`@${m[2]}`));
          else out.push({ type: "spoilerLike", data: { hName: "a", hProperties: { href: `/users/${encodeURIComponent(m[2])}`, className: "rt-mention" } }, children: [textNode(`@${m[2]}`)] } as unknown as PhrasingContent);
        } else {
          if (m.index > last) out.push(textNode(value.slice(last, m.index)));
          out.push({ type: "spoilerLike", data: { hName: "sup" }, children: [textNode(m[3])] } as unknown as PhrasingContent);
        }
        last = m.index + m[0].length;
      }
      if (out.length === 0) return null;
      if (last < value.length) out.push(textNode(value.slice(last)));
      return out;
    });
  }
  for (const c of parent.children) {
    if (SKIP.has(c.type)) {
      const hName = (c as { data?: { hName?: string } }).data?.hName;
      if ((c.type as string) === "spoilerLike" && hName !== "a") walk(c as unknown as MdNode, inLink);
      if (c.type === "link") walk(c as MdNode, true);
      continue;
    }
    walk(c as MdNode, inLink);
  }
}

function remarkAgora() {
  return (tree: Root) => { walk(tree); };
}

/* `>!` at line start would otherwise be read as a blockquote. */
function preprocess(text: string): string {
  return text.replace(/^([ \t]*)>!(?=[\s\S]*!<)/gm, "$1&#x3E;!");
}

/* ---------- components ---------- */

const stop = (e: React.MouseEvent) => e.stopPropagation();

function Spoiler({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="rt-spoiler"
      data-open={open ? "" : undefined}
      role="button"
      title={open ? undefined : "Spoiler — click to reveal"}
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
    >
      {children}
    </span>
  );
}

function makeComponents(onMentionClick?: (name: string) => void, inline = false): Components {
  return {
    a: ({ href, className, children }) => {
      if (className === "rt-mention") {
        const name = decodeURIComponent((href ?? "").replace(/^\/users\//, ""));
        return (
          <a
            href={href}
            className="rt-mention cursor-pointer"
            onClick={(e) => { e.stopPropagation(); if (onMentionClick) { e.preventDefault(); onMentionClick(name); } }}
          >
            {children}
          </a>
        );
      }
      if (!href || !/^https?:\/\//i.test(href)) return <>{children}</>;
      return <a href={href} target="_blank" rel="noopener noreferrer" onClick={stop}>{children}</a>;
    },
    span: ({ className, children }) => (className === "rt-spoiler" ? <Spoiler>{children}</Spoiler> : <span>{children}</span>),
    table: ({ children }) => <div className="rt-table"><table>{children}</table></div>,
    img: ({ alt }) => <>{alt ?? ""}</>,
    ...(inline ? { p: ({ children }) => <>{children}</> } : {}),
  };
}

const INLINE_DISALLOWED = ["h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "table", "thead", "tbody", "tr", "th", "td", "hr"];

export default function RichText({
  text,
  inline = false,
  onMentionClick,
}: {
  text: string;
  inline?: boolean;
  onMentionClick?: (name: string) => void;
}) {
  const components = useMemo(() => makeComponents(onMentionClick, inline), [onMentionClick, inline]);
  const src = useMemo(() => preprocess(text), [text]);
  const md = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks, remarkAgora]}
      components={components}
      disallowedElements={inline ? INLINE_DISALLOWED : undefined}
      unwrapDisallowed={inline}
    >
      {src}
    </ReactMarkdown>
  );
  if (inline) return <span className="rich-text-inline">{md}</span>;
  return <div className="rich-text">{md}</div>;
}
