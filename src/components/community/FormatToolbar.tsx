"use client";

/* Reddit-style formatting toolbar for the community composers. Every
   button edits the bound textarea's value through `onChange` and restores
   focus + selection afterwards. Pure text helpers live in lib/richText. */

import type { KeyboardEvent, ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  insertBlock, TABLE_TEMPLATE, toggleLinePrefix, wrapCodeBlock, wrapLink, wrapSelection, type Edit,
} from "@/lib/richText";

type Field = HTMLTextAreaElement | HTMLInputElement;
type Action =
  | "link" | "image" | "gif"
  | "bold" | "italic" | "strike" | "sup" | "heading"
  | "bullet" | "ordered"
  | "spoiler" | "quote" | "code" | "codeblock" | "table";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

const BUTTONS: Record<Exclude<Action, "image" | "gif">, { icon: IconName; tip: string }> = {
  link: { icon: "link", tip: `Link (${MOD}K)` },
  bold: { icon: "bold", tip: `Bold (${MOD}B)` },
  italic: { icon: "italic", tip: `Italic (${MOD}I)` },
  strike: { icon: "strikethrough", tip: `Strikethrough (${MOD}⇧X)` },
  sup: { icon: "superscript", tip: "Superscript" },
  heading: { icon: "heading", tip: "Heading" },
  bullet: { icon: "list", tip: "Bullet list" },
  ordered: { icon: "list-ordered", tip: "Numbered list" },
  spoiler: { icon: "eye-off", tip: "Spoiler" },
  quote: { icon: "text-quote", tip: "Quote" },
  code: { icon: "code", tip: "Inline code" },
  codeblock: { icon: "square-code", tip: "Code block" },
  table: { icon: "table", tip: "Table" },
};

const FULL_GROUPS: Action[][] = [
  ["link", "image", "gif"],
  ["bold", "italic", "strike", "sup", "heading"],
  ["bullet", "ordered"],
  ["spoiler", "quote", "code", "codeblock", "table"],
];
const COMPACT_GROUPS: Action[][] = [
  ["bold", "italic", "strike", "sup"],
  ["link", "bullet", "ordered"],
  ["spoiler", "quote", "code", "codeblock"],
];

export function applyFormat(action: Action, value: string, s: number, e: number): Edit | null {
  switch (action) {
    case "bold": return wrapSelection(value, s, e, "**");
    case "italic": return wrapSelection(value, s, e, "*");
    case "strike": return wrapSelection(value, s, e, "~~");
    case "code": return wrapSelection(value, s, e, "`");
    case "sup": return wrapSelection(value, s, e, "^(", ")");
    case "spoiler": return wrapSelection(value, s, e, ">!", "!<");
    case "link": return wrapLink(value, s, e);
    case "heading": return toggleLinePrefix(value, s, e, "## ", /^#{1,3}\s/);
    case "bullet": return toggleLinePrefix(value, s, e, "- ", /^[-*]\s/);
    case "ordered": return toggleLinePrefix(value, s, e, (n) => `${n}. `, /^\d+\.\s/);
    case "quote": return toggleLinePrefix(value, s, e, "> ", /^>\s?/);
    case "codeblock": return wrapCodeBlock(value, s, e);
    case "table": return insertBlock(value, s, e, TABLE_TEMPLATE);
    default: return null;
  }
}

function commit(el: Field | null, edit: Edit, onChange: (v: string) => void) {
  onChange(edit.value);
  requestAnimationFrame(() => {
    el?.focus();
    el?.setSelectionRange(edit.selStart, edit.selEnd);
  });
}

function run(action: Action, el: Field | null, value: string, onChange: (v: string) => void) {
  const s = el?.selectionStart ?? value.length;
  const e = el?.selectionEnd ?? s;
  const edit = applyFormat(action, value, s, e);
  if (edit) commit(el, edit, onChange);
}

/* ⌘/Ctrl+B, I, K (link), ⇧X (strike). Returns true when handled. */
export function handleFormatShortcut(
  ev: KeyboardEvent<Field>,
  value: string,
  onChange: (v: string) => void,
): boolean {
  if (!(ev.metaKey || ev.ctrlKey) || ev.altKey) return false;
  const k = ev.key.toLowerCase();
  let action: Action | null = null;
  if (k === "b") action = "bold";
  else if (k === "i") action = "italic";
  else if (k === "k") action = "link";
  else if (k === "x" && ev.shiftKey) action = "strike";
  if (!action) return false;
  ev.preventDefault();
  run(action, ev.currentTarget, value, onChange);
  return true;
}

export default function FormatToolbar({
  target,
  value,
  onChange,
  compact = false,
  onImage,
  onGif,
  trailing,
}: {
  target: () => Field | null;
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
  onImage?: () => void;
  onGif?: () => void;
  /* Optional content (e.g. a syntax hint) rendered after the groups. */
  trailing?: ReactNode;
}) {
  const size = compact ? 24 : 28;
  const iconSize = compact ? 13 : 15;
  const groups = (compact ? COMPACT_GROUPS : FULL_GROUPS)
    .map((g) => g.filter((a) => (a === "image" ? !!onImage : a === "gif" ? !!onGif : true)))
    .filter((g) => g.length > 0);

  return (
    <div className="flex items-center flex-wrap" style={{ gap: 2 }} role="toolbar" aria-label="Formatting">
      {groups.map((g, gi) => (
        <span key={gi} className="flex items-center" style={{ gap: 2 }}>
          {gi > 0 && <span aria-hidden style={{ width: 1, height: size - 8, background: "rgba(255,255,255,0.12)", margin: "0 4px" }} />}
          {g.map((a) => {
            const meta = a === "image" ? { icon: "image" as IconName, tip: "Add image" } : a === "gif" ? null : BUTTONS[a];
            return (
              <button
                key={a}
                type="button"
                title={meta ? meta.tip : "Add a GIF"}
                aria-label={meta ? meta.tip : "Add a GIF"}
                onMouseDown={(e) => e.preventDefault() /* keep the field's selection */}
                onClick={() => {
                  if (a === "image") return onImage?.();
                  if (a === "gif") return onGif?.();
                  run(a, target(), value, onChange);
                }}
                className="cursor-pointer"
                style={{
                  width: a === "gif" ? undefined : size,
                  height: size,
                  padding: a === "gif" ? "0 6px" : 0,
                  borderRadius: 6,
                  border: "0.5px solid transparent",
                  background: "transparent",
                  color: "rgba(238,238,245,0.62)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: compact ? 10 : 11,
                  fontWeight: 700,
                  fontFamily: "inherit",
                  letterSpacing: "0.02em",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#eeeef5"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(238,238,245,0.62)"; }}
              >
                {meta ? <Icon name={meta.icon} size={iconSize} /> : "GIF"}
              </button>
            );
          })}
        </span>
      ))}
      {trailing}
    </div>
  );
}
