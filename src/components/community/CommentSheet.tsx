"use client";

/* The phone comment composer, after Reddit's app: a sheet that rises
   over the keyboard with what it answers up top ("Commenting on <the
   post>", "Replying to @someone"), the text, then a row of GIF, image,
   emoji, a divider, "Aa" for the formatting strip, and the send button
   at the right. Sized to the visual viewport so the keyboard never
   covers it; the expand button gives the text the whole screen. The
   page owns the draft and the send (CommunitiesPage.tsx); this owns
   the frame. Wide screens keep the inline composer. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import EmojiPicker from "@/components/EmojiPicker";
import GifPicker from "@/components/community/GifPicker";
import RichEditor, { type RichEditorHandle } from "@/components/community/RichEditor";
import useEscapeClose from "@/lib/useEscapeClose";
import { useVisualViewport } from "@/lib/media";

export default function CommentSheet({
  heading,
  placeholder,
  value,
  onChange,
  onSubmit,
  canSubmit,
  busy,
  onClose,
  imagePreview,
  gifUrl,
  onPickImage,
  onGif,
  giphyEnabled,
  mentions,
}: {
  heading: ReactNode;
  placeholder: string;
  value: string;
  onChange: (markdown: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  busy: boolean;
  onClose: () => void;
  imagePreview: string | null;
  gifUrl: string | null;
  onPickImage: (file: File | null) => void;
  onGif: (url: string | null) => void;
  giphyEnabled: boolean;
  mentions: boolean;
}) {
  const editorRef = useRef<RichEditorHandle | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [picker, setPicker] = useState<null | "emoji" | "gif">(null);
  const [format, setFormat] = useState(false);
  const [tall, setTall] = useState(false);
  /* The sheet tracks the visual viewport so the keyboard never covers it. */
  const vv = useVisualViewport();
  useEscapeClose(true, onClose);

  /* The page behind holds still while the sheet is up. */
  useEffect(() => {
    document.documentElement.classList.add("composer-sheet-open");
    return () => { document.documentElement.classList.remove("composer-sheet-open"); };
  }, []);

  if (typeof document === "undefined") return null;
  const attachment = imagePreview ?? gifUrl;
  const send = () => { if (canSubmit && !busy) onSubmit(); };

  return createPortal(
    <div className="cm-sheet-veil" style={vv ? { top: vv.top, height: vv.height } : undefined} onClick={onClose}>
      <div
        role="dialog"
        aria-label="Comment"
        className={`cm-sheet${tall ? " is-tall" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cm-sheet-handle" aria-hidden="true" />
        <div className="cm-sheet-head">
          <span className="cm-sheet-title">{heading}</span>
          <button
            type="button"
            className="cm-sheet-expand"
            onClick={() => setTall((t) => !t)}
            aria-label={tall ? "Shrink" : "Expand"}
          >
            <Icon name={tall ? "minimize" : "maximize"} size={18} />
          </button>
        </div>
        <div className="cm-sheet-editor">
          <RichEditor
            ref={editorRef}
            frameless
            compact
            autoFocus
            toolbar={format}
            toolbarPosition="bottom"
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            mentions={mentions}
            onSubmit={send}
          />
        </div>
        {attachment && (
          <div className="cm-sheet-attach">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachment} alt="" />
            <button type="button" onClick={() => { onPickImage(null); onGif(null); }}>Remove</button>
          </div>
        )}
        <div className="cm-sheet-row">
          {giphyEnabled && (
            <button type="button" className="cm-sheet-tool" onClick={() => setPicker(picker === "gif" ? null : "gif")} aria-label="Add a GIF">
              <span className="cm-sheet-gif">GIF</span>
            </button>
          )}
          <button type="button" className="cm-sheet-tool" onClick={() => fileRef.current?.click()} aria-label="Add image">
            <Icon name="image" size={22} />
          </button>
          <button type="button" className="cm-sheet-tool" onClick={() => setPicker(picker === "emoji" ? null : "emoji")} aria-label="Emoji">
            <Icon name="smile" size={22} />
          </button>
          <span className="cm-sheet-divider" aria-hidden="true" />
          <button
            type="button"
            className={`cm-sheet-tool cm-sheet-aa${format ? " is-on" : ""}`}
            onClick={() => setFormat((f) => !f)}
            aria-label="Formatting"
            aria-pressed={format}
          >
            Aa
          </button>
          <span className="relative inline-block cm-popover-host" style={{ alignSelf: "stretch" }}>
            {picker === "emoji" && (
              <EmojiPicker onPick={(e) => editorRef.current?.insertText(e)} onClose={() => setPicker(null)} />
            )}
            {picker === "gif" && (
              <GifPicker onPick={(u) => { onGif(u); onPickImage(null); setPicker(null); }} onClose={() => setPicker(null)} />
            )}
          </span>
          <button type="button" className="cm-sheet-send" onClick={send} disabled={!canSubmit || busy} aria-label="Send">
            <Icon name="send" size={20} />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { onPickImage(e.target.files?.[0] ?? null); onGif(null); e.target.value = ""; }}
        />
      </div>
    </div>,
    document.body,
  );
}
