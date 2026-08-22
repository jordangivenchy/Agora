"use client";

/* Renders the markdown subset from src/lib/richText.ts as React elements.
   Never touches innerHTML — every string becomes a text node. */

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { parseBlocks, parseInline, type Block, type Inline } from "@/lib/richText";

const codeStyle: CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  border: "0.5px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  padding: "0 5px",
  fontSize: "0.9em",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};
const linkStyle: CSSProperties = { color: "#4a9eff", textDecoration: "underline", textUnderlineOffset: 2 };
const stop = (e: React.MouseEvent) => e.stopPropagation();

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      role="button"
      title={open ? undefined : "Spoiler — click to reveal"}
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      style={{
        cursor: open ? "inherit" : "pointer",
        borderRadius: 3,
        padding: "0 3px",
        background: open ? "rgba(255,255,255,0.06)" : "rgba(238,238,245,0.85)",
        color: open ? "inherit" : "transparent",
        textShadow: open ? undefined : "none",
        transition: "background 120ms",
        userSelect: open ? "auto" : "none",
      }}
    >
      {children}
    </span>
  );
}

function renderInlines(nodes: Inline[], onMentionClick?: (name: string) => void): ReactNode[] {
  return nodes.map((n, k) => {
    switch (n.type) {
      case "text": return n.text;
      case "br": return <br key={k} />;
      case "bold": return <strong key={k} style={{ fontWeight: 700, color: "#eeeef5" }}>{renderInlines(n.children, onMentionClick)}</strong>;
      case "italic": return <em key={k}>{renderInlines(n.children, onMentionClick)}</em>;
      case "strike": return <s key={k} style={{ opacity: 0.65 }}>{renderInlines(n.children, onMentionClick)}</s>;
      case "sup": return <sup key={k} style={{ fontSize: "0.75em", lineHeight: 0 }}>{renderInlines(n.children, onMentionClick)}</sup>;
      case "code": return <code key={k} style={codeStyle}>{n.text}</code>;
      case "spoiler": return <Spoiler key={k}>{renderInlines(n.children, onMentionClick)}</Spoiler>;
      case "link":
        return (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer" style={linkStyle} onClick={stop}>
            {renderInlines(n.children, onMentionClick)}
          </a>
        );
      case "url":
        return <a key={k} href={n.href} target="_blank" rel="noopener noreferrer" style={linkStyle} onClick={stop}>{n.href}</a>;
      case "mention":
        return (
          <a
            key={k}
            href={`/users/${encodeURIComponent(n.name)}`}
            className="cursor-pointer no-underline"
            style={{ color: "#4a9eff", fontWeight: 600 }}
            onClick={(e) => {
              e.stopPropagation();
              if (onMentionClick) { e.preventDefault(); onMentionClick(n.name); }
            }}
          >
            @{n.name}
          </a>
        );
    }
  });
}

const HEADING_SIZE = { 1: "1.25em", 2: "1.15em", 3: "1.05em" } as const;
const cellStyle: CSSProperties = {
  border: "0.5px solid rgba(255,255,255,0.12)",
  padding: "4px 8px",
  textAlign: "left",
  verticalAlign: "top",
};

function renderBlocks(blocks: Block[], onMentionClick?: (name: string) => void): ReactNode[] {
  return blocks.map((b, k) => {
    switch (b.type) {
      case "paragraph":
        return <p key={k} style={{ margin: "0 0 0.6em" }}>{renderInlines(b.children, onMentionClick)}</p>;
      case "heading":
        return (
          <p key={k} style={{ margin: "0.4em 0 0.4em", fontSize: HEADING_SIZE[b.level], fontWeight: 700, color: "#eeeef5", lineHeight: 1.3 }}>
            {renderInlines(b.children, onMentionClick)}
          </p>
        );
      case "list": {
        const Tag = b.ordered ? "ol" : "ul";
        return (
          <Tag key={k} style={{ margin: "0 0 0.6em", paddingLeft: "1.5em", listStyle: b.ordered ? "decimal" : "disc" }}>
            {b.items.map((it, j) => <li key={j} style={{ margin: "0.15em 0" }}>{renderInlines(it, onMentionClick)}</li>)}
          </Tag>
        );
      }
      case "quote":
        return (
          <blockquote key={k} style={{
            margin: "0 0 0.6em", padding: "2px 0 2px 10px",
            borderLeft: "3px solid rgba(255,255,255,0.18)", color: "rgba(238,238,245,0.7)",
          }}>
            {renderBlocks(b.children, onMentionClick)}
          </blockquote>
        );
      case "code":
        return (
          <pre key={k} style={{
            margin: "0 0 0.6em", padding: "8px 10px", borderRadius: 8,
            background: "rgba(0,0,0,0.45)", border: "0.5px solid rgba(255,255,255,0.1)",
            whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.88em",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}>
            {b.text}
          </pre>
        );
      case "table":
        return (
          <div key={k} style={{ overflowX: "auto", margin: "0 0 0.6em" }}>
            <table style={{ borderCollapse: "collapse", fontSize: "0.95em" }}>
              <thead>
                <tr>{b.header.map((c, j) => <th key={j} style={{ ...cellStyle, fontWeight: 600, background: "rgba(255,255,255,0.04)" }}>{renderInlines(c, onMentionClick)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={cellStyle}>{renderInlines(c, onMentionClick)}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        );
      case "hr":
        return <hr key={k} style={{ border: 0, borderTop: "0.5px solid rgba(255,255,255,0.14)", margin: "0.7em 0" }} />;
    }
  });
}

export default function RichText({
  text,
  inline = false,
  onMentionClick,
}: {
  text: string;
  inline?: boolean;
  onMentionClick?: (name: string) => void;
}) {
  const tree = useMemo(() => (inline ? parseInline(text) : parseBlocks(text)), [text, inline]);
  if (inline) return <>{renderInlines(tree as Inline[], onMentionClick)}</>;
  /* Last block's bottom margin would add dead space under the body. */
  return <div className="rich-text" style={{ marginBottom: "-0.6em" }}>{renderBlocks(tree as Block[], onMentionClick)}</div>;
}
