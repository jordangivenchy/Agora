"use client";

/* Reddit-style rich text editor for the community composers. The value
   in and out is markdown (see richEditorExtensions.ts); the DB never sees
   anything else. Toolbar layout mirrors the old FormatToolbar:
     link · image · gif │ B I S x² H │ • 1. │ spoiler quote code {} table */

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type KeyboardEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { EditorContent, ReactRenderer, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { createClient } from "@/lib/supabase-browser";
import { Icon, type IconName } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import { buildExtensions, cleanMarkdown, isSafeHref } from "./richEditorExtensions";

export type RichEditorHandle = {
  insertText: (text: string) => void;
  focus: () => void;
  editor: Editor | null;
};

type MentionUser = { id: string; username: string; display_name: string | null; avatar_url: string | null };

/* ---------- @mention dropdown (portal) ---------- */

type MentionListProps = SuggestionProps<MentionUser, { id: string; label: string }>;

const MentionList = forwardRef<{ onKeyDown: (p: SuggestionKeyDownProps) => boolean }, MentionListProps>(
  function MentionList({ items, command, clientRect }, ref) {
    const [index, setIndex] = useState(0);
    useEffect(() => setIndex(0), [items]);
    const pick = useCallback((i: number) => {
      const u = items[i];
      if (u) command({ id: u.username, label: u.username });
    }, [items, command]);
    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") { setIndex((i) => (i + items.length - 1) % Math.max(items.length, 1)); return true; }
        if (event.key === "ArrowDown") { setIndex((i) => (i + 1) % Math.max(items.length, 1)); return true; }
        if (event.key === "Enter" || event.key === "Tab") { pick(index); return true; }
        return false;
      },
    }), [items.length, index, pick]);
    const rect = clientRect?.();
    if (!rect || items.length === 0 || typeof document === "undefined") return null;
    return createPortal(
      <div
        className="fixed z-[200] overflow-hidden"
        style={{
          top: rect.bottom + 4, left: rect.left, minWidth: 220,
          background: "rgba(14,14,17,0.97)",
          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        }}
      >
        {items.map((u, i) => (
          <div
            key={u.id}
            onMouseDown={(e) => { e.preventDefault(); pick(i); }}
            onMouseEnter={() => setIndex(i)}
            className="flex items-center gap-2 px-3 py-2 cursor-pointer"
            style={{ background: i === index ? "rgba(255,255,255,0.06)" : undefined }}
          >
            <UserAvatar size={20} username={u.username} avatarUrl={u.avatar_url} seed={u.id} />
            <span className="text-[12px]" style={{ color: "#eeeef5" }}>@{u.username}</span>
            {u.display_name?.trim() && (
              <span className="text-[10.5px] truncate" style={{ color: "rgba(238,238,245,0.4)" }}>{u.display_name}</span>
            )}
          </div>
        ))}
      </div>,
      document.body,
    );
  },
);

function makeMentionSuggestion(supabase: ReturnType<typeof createClient>) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    char: "@",
    allowSpaces: false,
    items: ({ query }: { query: string }) =>
      new Promise<MentionUser[]>((resolve) => {
        if (timer) clearTimeout(timer);
        if (!query) { resolve([]); return; }
        timer = setTimeout(async () => {
          const { data } = await supabase.rpc("search_mention_users", { p_query: query, p_limit: 5 });
          resolve((data ?? []) as MentionUser[]);
        }, 180);
      }),
    render: () => {
      let component: ReactRenderer<{ onKeyDown: (p: SuggestionKeyDownProps) => boolean }, MentionListProps> | null = null;
      return {
        onStart: (props: MentionListProps) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor });
        },
        onUpdate: (props: MentionListProps) => { component?.updateProps(props); },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === "Escape") { component?.destroy(); component = null; return true; }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => { component?.destroy(); component = null; },
      };
    },
  };
}

/* ---------- toolbar ---------- */

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

type Btn = { icon?: IconName; label?: string; tip: string; active?: string | [string, Record<string, unknown>]; run: (e: Editor) => void };

function ToolButton({
  b, size, iconSize, active, onClick,
}: { b: Btn; size: number; iconSize: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={b.tip}
      aria-label={b.tip}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="cursor-pointer"
      style={{
        width: b.label ? undefined : size, height: size, padding: b.label ? "0 6px" : 0,
        borderRadius: 6, border: "0.5px solid transparent",
        background: active ? "rgba(255,255,255,0.12)" : "transparent",
        color: active ? "#eeeef5" : "rgba(238,238,245,0.62)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, fontFamily: "inherit", letterSpacing: "0.02em",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#eeeef5"; }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? "rgba(255,255,255,0.12)" : "transparent";
        e.currentTarget.style.color = active ? "#eeeef5" : "rgba(238,238,245,0.62)";
      }}
    >
      {b.icon ? <Icon name={b.icon} size={iconSize} /> : b.label}
    </button>
  );
}

/* ---------- editor ---------- */

export type RichEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  compact?: boolean;
  autoFocus?: boolean;
  onSubmit?: () => void;
  onImage?: () => void;
  onGif?: () => void;
  trailing?: ReactNode;
  /* Wraps the editor box (not the toolbar). */
  style?: React.CSSProperties;
  /* Disable @mention lookups (e.g. logged-out). */
  mentions?: boolean;
  onFocus?: () => void;
};

const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor({
  value, onChange, placeholder, compact = false, autoFocus = false, onSubmit, onImage, onGif, trailing, style, mentions = true, onFocus,
}, ref) {
  const [supabase] = useState(() => createClient());
  const lastEmitted = useRef<string>(value);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit); onSubmitRef.current = onSubmit;
  const submit = useCallback(() => { onSubmitRef.current?.(); }, []);

  const extensions = useMemo(() => buildExtensions({
    placeholder,
    onSubmit: submit,
    mentionSuggestion: mentions ? makeMentionSuggestion(supabase) : null,
  }), [placeholder, mentions, submit, supabase]);

  const editor = useEditor({
    extensions,
    content: value,
    contentType: "markdown",
    autofocus: autoFocus ? "end" : false,
    immediatelyRender: false,
    editorProps: { attributes: { class: "rt-content", spellcheck: "true" } },
    onUpdate: ({ editor }) => {
      const md = editor.isEmpty ? "" : cleanMarkdown(editor.getMarkdown());
      lastEmitted.current = md;
      onChangeRef.current(md);
    },
    onFocus: () => onFocus?.(),
  }, [extensions]);

  /* External value changes (reset after submit, or a programmatic fill)
     replace the document; our own emits are ignored so typing isn't
     clobbered. */
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    if (value === "") editor.commands.clearContent(true);
    else editor.commands.setContent(value, { contentType: "markdown" });
  }, [value, editor]);

  useImperativeHandle(ref, () => ({
    insertText: (text) => { editor?.chain().focus().insertContent(text).run(); },
    focus: () => editor?.commands.focus(),
    editor,
  }), [editor]);

  /* Active states, re-rendered on selection change. */
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => e ? ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), strike: e.isActive("strike"),
      sup: e.isActive("superscript"), heading: e.isActive("heading"),
      bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"),
      spoiler: e.isActive("spoiler"), quote: e.isActive("blockquote"),
      code: e.isActive("code"), codeBlock: e.isActive("codeBlock"),
      table: e.isActive("table"), link: e.isActive("link"),
    }) : null,
  });

  /* Link popover */
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkNeedsText, setLinkNeedsText] = useState(false);
  const openLink = useCallback(() => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    const existing = editor.getAttributes("link").href as string | undefined;
    setLinkUrl(existing ?? "");
    setLinkNeedsText(empty && !existing);
    setLinkText(empty ? "" : editor.state.doc.textBetween(from, to, " "));
    setLinkOpen(true);
  }, [editor]);
  const applyLink = useCallback(() => {
    if (!editor) return;
    const url = linkUrl.trim();
    const href = url && !/^https?:\/\//i.test(url) ? `https://${url}` : url;
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else if (!isSafeHref(href)) {
      return;
    } else if (linkNeedsText) {
      const label = linkText.trim() || href;
      editor.chain().focus().insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkOpen(false);
  }, [editor, linkUrl, linkText, linkNeedsText]);

  /* ⌘K opens the popover (ProseMirror sees the key first, so listen on the wrapper). */
  const onWrapperKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); openLink(); }
    if (e.key === "Escape" && linkOpen) { e.preventDefault(); setLinkOpen(false); editor?.commands.focus(); }
  }, [openLink, linkOpen, editor]);

  const size = compact ? 24 : 28;
  const iconSize = compact ? 13 : 15;
  const a = active;

  const groups: Btn[][] = useMemo(() => {
    const g1: Btn[] = [{ icon: "link", tip: `Link (${MOD}K)`, active: "link", run: () => openLink() }];
    if (onImage) g1.push({ icon: "image", tip: "Add image", run: () => onImage() });
    if (onGif) g1.push({ label: "GIF", tip: "Add a GIF", run: () => onGif() });
    const g2: Btn[] = [
      { icon: "bold", tip: `Bold (${MOD}B)`, active: "bold", run: (e) => e.chain().focus().toggleBold().run() },
      { icon: "italic", tip: `Italic (${MOD}I)`, active: "italic", run: (e) => e.chain().focus().toggleItalic().run() },
      { icon: "strikethrough", tip: `Strikethrough (${MOD}⇧X)`, active: "strike", run: (e) => e.chain().focus().toggleStrike().run() },
      { icon: "superscript", tip: "Superscript", active: "sup", run: (e) => e.chain().focus().toggleSuperscript().run() },
    ];
    if (!compact) g2.push({ icon: "heading", tip: "Heading", active: "heading", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() });
    const g3: Btn[] = [
      { icon: "list", tip: `Bullet list (${MOD}⇧8)`, active: "bullet", run: (e) => e.chain().focus().toggleBulletList().run() },
      { icon: "list-ordered", tip: `Numbered list (${MOD}⇧7)`, active: "ordered", run: (e) => e.chain().focus().toggleOrderedList().run() },
    ];
    const g4: Btn[] = [
      { icon: "eye-off", tip: "Spoiler", active: "spoiler", run: (e) => e.chain().focus().toggleSpoiler().run() },
      { icon: "text-quote", tip: "Quote", active: "quote", run: (e) => e.chain().focus().toggleBlockquote().run() },
      { icon: "code", tip: "Inline code", active: "code", run: (e) => e.chain().focus().toggleCode().run() },
      { icon: "square-code", tip: "Code block", active: "codeBlock", run: (e) => e.chain().focus().toggleCodeBlock().run() },
    ];
    if (!compact) g4.push({ icon: "table", tip: "Table", active: "table", run: (e) => {
      if (e.isActive("table")) e.chain().focus().deleteTable().run();
      else e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    } });
    return [g1, g2, g3, g4];
  }, [compact, onImage, onGif, openLink]);

  const tableOps: Btn[] = [
    { icon: "plus", label: "+ row", tip: "Add row below", run: (e) => e.chain().focus().addRowAfter().run() },
    { icon: "minus", label: "− row", tip: "Delete row", run: (e) => e.chain().focus().deleteRow().run() },
    { icon: "plus", label: "+ col", tip: "Add column after", run: (e) => e.chain().focus().addColumnAfter().run() },
    { icon: "minus", label: "− col", tip: "Delete column", run: (e) => e.chain().focus().deleteColumn().run() },
    { icon: "trash", tip: "Delete table", run: (e) => e.chain().focus().deleteTable().run() },
  ];

  return (
    <div className="rich-editor relative" data-compact={compact ? "" : undefined} onKeyDown={onWrapperKeyDown}>
      <div className="flex items-center flex-wrap mb-1.5" style={{ gap: 2 }} role="toolbar" aria-label="Formatting">
        {groups.map((g, gi) => (
          <span key={gi} className="flex items-center" style={{ gap: 2 }}>
            {gi > 0 && <span aria-hidden style={{ width: 1, height: size - 8, background: "rgba(255,255,255,0.12)", margin: "0 4px" }} />}
            {g.map((b) => (
              <ToolButton
                key={b.tip}
                b={b} size={size} iconSize={iconSize}
                active={!!(b.active && a && a[b.active as keyof typeof a])}
                onClick={() => { if (editor) b.run(editor); }}
              />
            ))}
          </span>
        ))}
        {trailing}
      </div>
      {a?.table && !compact && (
        <div className="flex items-center flex-wrap mb-1.5" style={{ gap: 2 }} aria-label="Table">
          {tableOps.map((b) => (
            <button
              key={b.tip} type="button" title={b.tip}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (editor) b.run(editor); }}
              className="cursor-pointer text-[10.5px] px-2 rounded-md inline-flex items-center gap-1"
              style={{ height: 22, background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)", color: "rgba(238,238,245,0.7)", fontFamily: "inherit" }}
            >
              {b.label ? b.label : <><Icon name={b.icon!} size={12} /> {b.tip}</>}
            </button>
          ))}
        </div>
      )}
      {linkOpen && (
        <div
          className="absolute z-30 flex items-center gap-1.5 p-2"
          style={{
            top: size + 8, left: 0,
            background: "rgba(14,14,17,0.97)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
          }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }}
        >
          {linkNeedsText && (
            <input
              value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="Text"
              className="text-[12px] px-2 py-1 rounded-md outline-none"
              style={{ width: 120, background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(255,255,255,0.12)", color: "#eeeef5", fontFamily: "inherit" }}
            />
          )}
          <input
            autoFocus
            value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…"
            className="text-[12px] px-2 py-1 rounded-md outline-none"
            style={{ width: 200, background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(255,255,255,0.12)", color: "#eeeef5", fontFamily: "inherit" }}
          />
          <button type="button" onClick={applyLink} className="cursor-pointer text-[11px] px-2.5 py-1 rounded-md"
            style={{ background: "rgba(74,158,255,0.12)", border: "0.5px solid rgba(74,158,255,0.35)", color: "#4a9eff", fontFamily: "inherit" }}>
            {linkUrl.trim() ? "Apply" : "Remove"}
          </button>
          <button type="button" onClick={() => { setLinkOpen(false); editor?.commands.focus(); }} title="Close"
            className="cursor-pointer bg-transparent border-none p-0.5" style={{ color: "rgba(238,238,245,0.5)" }}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}
      <div className="rich-editor-box" style={style}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

export default RichEditor;
