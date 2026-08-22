/* TipTap extension set for the community composers. Headless-safe (no
   React) so the markdown round-trip can be unit-tested with a bare
   `Editor` in jsdom. Storage stays markdown: `@tiptap/markdown` parses the
   stored text into the editor and `editor.getMarkdown()` serialises it back.

   Custom syntax on top of GFM, matching what the renderer (RichText.tsx)
   understands:
     >!spoiler!<   Spoiler mark
     ^(sup) / ^x   Superscript mark
     @username     Mention node (serialises to plain `@username`) */

import { Extension, Mark, mergeAttributes, type AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Superscript from "@tiptap/extension-superscript";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import Mention, { type MentionOptions } from "@tiptap/extension-mention";
import { Markdown } from "@tiptap/markdown";

export const MENTION_RE = /^@([a-zA-Z0-9_]{1,20})/;

export function isSafeHref(href: unknown): href is string {
  return typeof href === "string" && /^https?:\/\//i.test(href.trim());
}

/* ---- Spoiler mark: `>!text!<` ---- */
export const Spoiler = Mark.create({
  name: "spoiler",
  parseHTML() {
    return [{ tag: "span[data-spoiler]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-spoiler": "", class: "rt-spoiler" }), 0];
  },
  addCommands() {
    return {
      toggleSpoiler: () => ({ commands }) => commands.toggleMark(this.name),
    };
  },
  markdownTokenName: "spoiler",
  markdownTokenizer: {
    name: "spoiler",
    level: "inline",
    start: ">!",
    tokenize(src, _tokens, lexer) {
      const m = /^>!([\s\S]+?)!</.exec(src);
      if (!m) return undefined;
      return { type: "spoiler", raw: m[0], text: m[1], tokens: lexer.inlineTokens(m[1]) };
    },
  },
  parseMarkdown: (token, h) => h.applyMark("spoiler", h.parseInline(token.tokens || [])),
  renderMarkdown: (node, h) => `>!${h.renderChildren(node)}!<`,
});

/* A line that *starts* with `>!` is a spoiler paragraph, not a blockquote.
   marked would otherwise grab the `>` as a quote marker. */
const SpoilerParagraph = Extension.create({
  name: "spoilerParagraph",
  markdownTokenizer: {
    name: "spoilerParagraph",
    level: "block",
    start: (src) => {
      const m = /(^|\n)>!/.exec(src);
      return m ? m.index + (m[1] ? 1 : 0) : -1;
    },
    tokenize(src, _tokens, lexer) {
      if (!src.startsWith(">!")) return undefined;
      const m = /^[^\n]*(?:\n(?!\s*\n)[^\n]*)*/.exec(src);
      if (!m) return undefined;
      return { type: "paragraph", raw: m[0], text: m[0], tokens: lexer.inlineTokens(m[0]) };
    },
  },
});

/* ---- Superscript: `^(a b)` or `^word` ---- */
const Sup = Superscript.extend({
  markdownTokenName: "superscript",
  markdownTokenizer: {
    name: "superscript",
    level: "inline",
    start: "^",
    tokenize(src, _tokens, lexer) {
      const m = /^\^\(([^)\n]+)\)/.exec(src) ?? /^\^(\S+)/.exec(src);
      if (!m) return undefined;
      return { type: "superscript", raw: m[0], text: m[1], tokens: lexer.inlineTokens(m[1]) };
    },
  },
  parseMarkdown: (token, h) => h.applyMark("superscript", h.parseInline(token.tokens || [])),
  renderMarkdown: (node, h) => `^(${h.renderChildren(node)})`,
});

/* ---- Mention: stored as plain `@username` ---- */
export const MentionNode = Mention.extend({
  renderText({ node }) {
    return `@${node.attrs.label ?? node.attrs.id}`;
  },
  renderHTML({ node, HTMLAttributes }) {
    const name = node.attrs.label ?? node.attrs.id;
    return ["span", mergeAttributes({ class: "rt-mention", "data-type": "mention", "data-id": name }, HTMLAttributes), `@${name}`];
  },
  markdownTokenName: "mention",
  markdownTokenizer: {
    name: "mention",
    level: "inline",
    start: "@",
    tokenize(src) {
      const m = MENTION_RE.exec(src);
      if (!m) return undefined;
      return { type: "mention", raw: m[0], text: m[1] };
    },
  },
  parseMarkdown: (token, h) => h.createNode("mention", { id: token.text, label: token.text }),
  renderMarkdown: (node) => `@${node.attrs?.label ?? node.attrs?.id ?? ""}`,
});

/* ---- Link: only http(s) survives the markdown parse ---- */
const SafeLink = Link.extend({
  parseMarkdown: (token, h) => {
    const inner = h.parseInline(token.tokens || []);
    if (!isSafeHref(token.href)) {
      /* Unsafe scheme → keep the literal source text. */
      return h.createTextNode(String(token.raw ?? token.text ?? ""));
    }
    return h.applyMark("link", inner, { href: token.href, title: token.title || null });
  },
}).configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  protocols: ["http", "https"],
  defaultProtocol: "https",
  isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && /^https?:\/\//i.test(url),
});

/* ---- Keyboard: Tab/Shift+Tab in lists, ⌘/Ctrl+Enter submit ---- */
export type ComposerKeysOptions = { onSubmit?: () => void };
export const ComposerKeys = Extension.create<ComposerKeysOptions>({
  name: "composerKeys",
  addOptions() {
    return { onSubmit: undefined };
  },
  addKeyboardShortcuts() {
    const submit = () => {
      if (!this.options.onSubmit) return false;
      this.options.onSubmit();
      return true;
    };
    return {
      Tab: ({ editor }) => {
        if (editor.isActive("table")) return false; // table's own Tab (next cell)
        if (editor.isActive("listItem")) return editor.commands.sinkListItem("listItem") || true;
        return false;
      },
      "Shift-Tab": ({ editor }) => {
        if (editor.isActive("table")) return false;
        if (editor.isActive("listItem")) return editor.commands.liftListItem("listItem") || true;
        return false;
      },
      "Mod-Enter": submit,
      "Ctrl-Enter": submit,
    };
  },
});

export type BuildOptions = {
  placeholder?: string;
  onSubmit?: () => void;
  mentionSuggestion?: MentionOptions["suggestion"] | null;
};

export function buildExtensions(opts: BuildOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      underline: false,
      codeBlock: { HTMLAttributes: { class: "rt-pre" } },
    }),
    SafeLink,
    Sup,
    Spoiler,
    SpoilerParagraph,
    TableKit.configure({ table: { resizable: false } }),
    MentionNode.configure({
      suggestion: opts.mentionSuggestion ?? { char: "@", items: () => [], render: () => ({}) },
    }),
    Placeholder.configure({ placeholder: opts.placeholder ?? "" }),
    ComposerKeys.configure({ onSubmit: opts.onSubmit }),
    Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
  ];
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    spoiler: { toggleSpoiler: () => ReturnType };
  }
}

/* Serialiser output → what we store. Empty paragraphs come out as `&nbsp;`
   placeholders; collapse them so the DB only ever holds plain GFM. */
export function cleanMarkdown(md: string): string {
  return md
    .replace(/^[ \t]*&nbsp;[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
