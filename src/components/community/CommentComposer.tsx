"use client";

/* The comment composer: its own screen, like Reddit's. A centred card on
   desktop, a full-screen sheet on phones (sized to the visual viewport so
   the toolbar rides above the keyboard). What you're answering — the
   post's title or the comment you're replying to — sits under the header;
   the text fills the middle; formatting is one scrolling row at the
   bottom. The page owns the draft and the send; this owns the frame. */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import EmojiPicker from "@/components/EmojiPicker";
import GifPicker from "@/components/community/GifPicker";
import RichEditor, { type RichEditorHandle } from "@/components/community/RichEditor";
import useEscapeClose from "@/lib/useEscapeClose";
import { YELLOW } from "@/components/messages/DmThread";
import { errorNote, modalCard, modalClose, modalOverlay, modalTitle, pillDark, pillYellow } from "@/components/messages/groups";

export type ComposerContext =
  | { kind: "post"; title: string }
  | { kind: "comment"; author: string; body: string };

export default function CommentComposer({
  title,
  context,
  value,
  onChange,
  placeholder,
  submitLabel,
  busy,
  error,
  imagePreview,
  gifUrl,
  onPickImage,
  onGif,
  giphyEnabled,
  mentions,
  maxLength,
  onSubmit,
  onClose,
}: {
  title: string;
  context: ComposerContext;
  value: string;
  onChange: (markdown: string) => void;
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  imagePreview: string | null;
  gifUrl: string | null;
  onPickImage: (file: File | null) => void;
  onGif: (url: string | null) => void;
  giphyEnabled: boolean;
  mentions: boolean;
  maxLength: number;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const editorRef = useRef<RichEditorHandle | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [picker, setPicker] = useState<null | "emoji" | "gif">(null);
  const [phone, setPhone] = useState(false);
  /* Phones: the sheet tracks the visual viewport so the bottom toolbar
     sits on the keyboard instead of behind it. */
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null);
  useEscapeClose(true, onClose);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setPhone(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!phone) {
      setVv(null);
      return;
    }
    document.documentElement.classList.add("cmt-sheet-open");
    const v = window.visualViewport;
    const apply = () => {
      if (!v) return;
      setVv({ top: v.offsetTop, height: v.height });
    };
    apply();
    v?.addEventListener("resize", apply);
    v?.addEventListener("scroll", apply);
    return () => {
      document.documentElement.classList.remove("cmt-sheet-open");
      v?.removeEventListener("resize", apply);
      v?.removeEventListener("scroll", apply);
    };
  }, [phone]);

  const canSend = !busy && value.trim().length > 0 && value.length <= maxLength;
  const nearMax = value.length > maxLength * 0.9;
  const attachment = imagePreview ?? gifUrl;

  const submitBtn = (compact: boolean) => (
    <button
      type="button"
      onClick={onSubmit}
      disabled={!canSend}
      style={{
        ...pillYellow,
        height: compact ? 32 : 36,
        padding: compact ? "0 14px" : "0 18px",
        opacity: canSend ? 1 : 0.45,
        cursor: canSend ? "pointer" : "default",
      }}
    >
      {busy ? "Posting…" : submitLabel}
    </button>
  );

  const cardStyle: CSSProperties = phone
    ? {
        ...modalCard,
        padding: "0 16px",
        boxShadow: "none",
        ...(vv ? { top: vv.top, height: vv.height, bottom: "auto" } : {}),
      }
    : { ...modalCard, maxWidth: 600, height: "min(640px, 88vh)", padding: "18px 22px 18px" };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-5 crm-overlay"
      style={modalOverlay}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        className="w-full cmt-composer-card"
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {phone ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 56, flexShrink: 0 }}>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer"
              style={{ background: "none", border: "none", padding: "6px 0", color: "rgba(238,238,245,0.7)", fontSize: 15, fontFamily: "inherit" }}
            >
              Cancel
            </button>
            <span style={{ ...modalTitle, fontSize: 16, flex: 1, textAlign: "center", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {title}
            </span>
            {submitBtn(true)}
          </div>
        ) : (
          <div className="flex items-center justify-between" style={{ marginBottom: 12, flexShrink: 0 }}>
            <h2 style={modalTitle}>{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" style={modalClose}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {/* What this answers */}
        {context.kind === "post" ? (
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 12.5,
              lineHeight: 1.4,
              color: "rgba(238,238,245,0.5)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <span style={{ color: "rgba(238,238,245,0.35)" }}>On </span>
            <span style={{ color: "rgba(238,238,245,0.75)", fontWeight: 600 }}>{context.title}</span>
          </p>
        ) : (
          <div
            style={{
              margin: "0 0 12px",
              padding: "6px 10px",
              borderLeft: `2px solid ${YELLOW}`,
              borderRadius: 6,
              background: "#0b0b0d",
              flexShrink: 0,
            }}
          >
            <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#eeeef5" }}>@{context.author}</span>
            <span
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                fontSize: 12.5,
                lineHeight: 1.4,
                color: "rgba(238,238,245,0.6)",
              }}
            >
              {context.body}
            </span>
          </div>
        )}

        {/* The text — fills whatever is left */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <RichEditor
            ref={editorRef}
            frameless
            toolbarPosition="bottom"
            autoFocus
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            onSubmit={onSubmit}
            mentions={mentions}
            onImage={() => fileRef.current?.click()}
            onGif={giphyEnabled ? () => setPicker(picker === "gif" ? null : "gif") : undefined}
            onEmoji={() => setPicker(picker === "emoji" ? null : "emoji")}
            trailing={
              <span className="relative inline-block cm-popover-host shrink-0" style={{ alignSelf: "stretch" }}>
                {picker === "emoji" && (
                  <EmojiPicker
                    align="right"
                    vertical="above"
                    onPick={(e) => editorRef.current?.insertText(e)}
                    onClose={() => setPicker(null)}
                  />
                )}
                {picker === "gif" && (
                  <GifPicker
                    placement="above"
                    align="right"
                    onPick={(u) => {
                      onGif(u);
                      onPickImage(null);
                      setPicker(null);
                    }}
                    onClose={() => setPicker(null)}
                  />
                )}
              </span>
            }
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              onPickImage(e.target.files?.[0] ?? null);
              onGif(null);
              e.target.value = "";
            }}
          />
        </div>

        {attachment && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0 2px", flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachment} alt="" style={{ height: 64, maxWidth: 160, borderRadius: 8, objectFit: "cover", display: "block" }} />
            <button
              type="button"
              onClick={() => {
                onPickImage(null);
                onGif(null);
              }}
              aria-label="Remove attachment"
              style={{ ...modalClose, width: 26, height: 26, borderRadius: 999 }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        )}

        {error && <p style={{ ...errorNote, marginTop: 8, flexShrink: 0 }}>{error}</p>}

        {/* Desktop footer: the send sits under the toolbar. Phones send from the header. */}
        {!phone && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexShrink: 0 }}>
            {nearMax && (
              <span style={{ fontSize: 11, color: value.length > maxLength ? "#e26b6b" : "rgba(238,238,245,0.35)" }}>
                {value.length.toLocaleString()} / {maxLength.toLocaleString()}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={onClose} style={{ ...pillDark, height: 36 }}>
              Cancel
            </button>
            {submitBtn(false)}
          </div>
        )}
        {phone && nearMax && (
          <span style={{ fontSize: 11, padding: "4px 0 8px", color: value.length > maxLength ? "#e26b6b" : "rgba(238,238,245,0.35)", flexShrink: 0 }}>
            {value.length.toLocaleString()} / {maxLength.toLocaleString()}
          </span>
        )}
        {phone && <div style={{ height: 8, flexShrink: 0 }} />}
      </div>
    </div>,
    document.body
  );
}
