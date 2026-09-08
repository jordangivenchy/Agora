"use client";

/* Creating a post is its own screen, Reddit-style: a centred card on
   desktop, a full-screen sheet on phones (sized to the visual viewport
   so nothing hides behind the keyboard). Community (when composing from
   All), title, then the formatting row above a text area that fills the
   rest; tags and the attachment ride underneath. The page owns the
   draft and the send; this owns the frame. */

import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import EmojiPicker from "@/components/EmojiPicker";
import GifPicker from "@/components/community/GifPicker";
import CommunityPicker from "@/components/community/CommunityPicker";
import { TagChip } from "@/components/community/PostCard";
import RichEditor, { type RichEditorHandle } from "@/components/community/RichEditor";
import useEscapeClose from "@/lib/useEscapeClose";
import { errorNote, fieldStyle, modalCard, modalClose, modalOverlay, modalTitle, pillDark, pillYellow } from "@/components/messages/groups";
import { TOPICS } from "@/types/database";
import { EMPTY_TOPIC, TOPIC_QUEUE_KEYS, type TopicDraft } from "@/lib/postTopics";

export const POST_TITLE_MAX = 200;
export const POST_BODY_MAX = 10000;

type PickerCommunities = ComponentProps<typeof CommunityPicker>["communities"];

export default function PostComposer({
  pickCommunity,
  title,
  onTitle,
  body,
  onBody,
  tags,
  tagId,
  onTagId,
  imagePreview,
  gifUrl,
  onPickImage,
  onGif,
  busy,
  error,
  canSubmit,
  giphyEnabled,
  mentions,
  maxLength,
  onSubmit,
  onClose,
  clip,
  canAttachTopic,
  topic,
  onTopic,
}: {
  /** Verified accounts: the post can carry a conversation people queue into. */
  canAttachTopic?: boolean;
  topic?: TopicDraft;
  onTopic?: (next: TopicDraft) => void;
  /** A clip riding along with the post (the clip page's "Post to
      community"): shown as a fixed attachment under the text. */
  clip?: { title: string; duration: string | null } | null;
  /** Shown when composing from All: which community this goes to. */
  pickCommunity: { communities: PickerCommunities; value: string; onChange: (id: string) => void } | null;
  title: string;
  onTitle: (title: string) => void;
  body: string;
  onBody: (markdown: string) => void;
  tags: { id: string; name: string; color: string | null }[];
  tagId: string;
  onTagId: (id: string) => void;
  imagePreview: string | null;
  gifUrl: string | null;
  onPickImage: (file: File | null) => void;
  onGif: (url: string | null) => void;
  busy: boolean;
  error: string | null;
  canSubmit: boolean;
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
  /* Phones: the sheet tracks the visual viewport so the keyboard never
     covers the bottom of it. */
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
    document.documentElement.classList.add("composer-sheet-open");
    const v = window.visualViewport;
    const apply = () => {
      if (!v) return;
      setVv({ top: v.offsetTop, height: v.height });
    };
    apply();
    v?.addEventListener("resize", apply);
    v?.addEventListener("scroll", apply);
    return () => {
      document.documentElement.classList.remove("composer-sheet-open");
      v?.removeEventListener("resize", apply);
      v?.removeEventListener("scroll", apply);
    };
  }, [phone]);

  const nearMax = body.length > maxLength * 0.9;
  const attachment = imagePreview ?? gifUrl;

  const submitBtn = (compact: boolean) => (
    <button
      type="button"
      onClick={onSubmit}
      disabled={!canSubmit}
      style={{
        ...pillYellow,
        height: compact ? 32 : 36,
        padding: compact ? "0 14px" : "0 18px",
        opacity: canSubmit ? 1 : 0.45,
        cursor: canSubmit ? "pointer" : "default",
      }}
    >
      {busy ? "Posting…" : "Post"}
    </button>
  );

  const cardStyle: CSSProperties = phone
    ? {
        ...modalCard,
        padding: "0 16px",
        boxShadow: "none",
        ...(vv ? { top: vv.top, height: vv.height, bottom: "auto" } : {}),
      }
    : { ...modalCard, maxWidth: 640, height: "min(720px, 92vh)", padding: "18px 22px 18px" };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-5 crm-overlay"
      style={modalOverlay}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={clip ? "Post clip" : "New post"}
        className="w-full composer-sheet"
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
            <span style={{ ...modalTitle, fontSize: 16, flex: 1, textAlign: "center" }}>{clip ? "Post clip" : "New post"}</span>
            {submitBtn(true)}
          </div>
        ) : (
          <div className="flex items-center justify-between" style={{ marginBottom: 12, flexShrink: 0 }}>
            <h2 style={modalTitle}>{clip ? "Post clip" : "New post"}</h2>
            <button type="button" onClick={onClose} aria-label="Close" style={modalClose}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {pickCommunity && (
          <div style={{ marginBottom: 10, flexShrink: 0 }}>
            <CommunityPicker
              communities={pickCommunity.communities}
              value={pickCommunity.value}
              onChange={pickCommunity.onChange}
            />
          </div>
        )}

        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 10, flexShrink: 0 }}>
          <input
            className="composer-title"
            value={title}
            onChange={(e) => onTitle(e.target.value.slice(0, POST_TITLE_MAX))}
            placeholder="Title"
            maxLength={POST_TITLE_MAX}
            autoFocus={!phone}
            aria-label="Title"
            style={{
              flex: 1,
              minWidth: 0,
              background: "none",
              border: "none",
              outline: "none",
              color: "#f5f5f0",
              fontSize: 20,
              fontWeight: 700,
              fontFamily: "'Space Grotesk', sans-serif",
              letterSpacing: "-0.01em",
              padding: "6px 0 10px",
            }}
          />
          {title.length > POST_TITLE_MAX - 40 && (
            <span style={{ fontSize: 11, color: title.length >= POST_TITLE_MAX ? "#e26b6b" : "rgba(238,238,245,0.35)", flexShrink: 0 }}>
              {title.length} / {POST_TITLE_MAX}
            </span>
          )}
        </div>

        {/* Formatting row above the text; the text fills whatever is left */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <RichEditor
            ref={editorRef}
            frameless
            value={body}
            onChange={onBody}
            placeholder={clip ? "Say something about the clip (optional — @ to mention someone)" : "Text (optional — @ to mention someone)"}
            mentions={mentions}
            onImage={() => fileRef.current?.click()}
            onGif={giphyEnabled ? () => setPicker(picker === "gif" ? null : "gif") : undefined}
            onEmoji={() => setPicker(picker === "emoji" ? null : "emoji")}
            trailing={
              <span className="relative inline-block cm-popover-host shrink-0" style={{ alignSelf: "stretch" }}>
                {picker === "emoji" && (
                  <EmojiPicker
                    align="right"
                    onPick={(e) => editorRef.current?.insertText(e)}
                    onClose={() => setPicker(null)}
                  />
                )}
                {picker === "gif" && (
                  <GifPicker
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

        {canAttachTopic && onTopic && (() => {
          const t = topic ?? EMPTY_TOPIC;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0 2px", flexShrink: 0 }}>
              <label style={{ display: "inline-flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 12.5, color: "#eeeef5", alignSelf: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={t.on}
                  onChange={(e) => onTopic({ ...t, on: e.target.checked, question: t.question || title })}
                  style={{ accentColor: "#ffb700", marginTop: 2 }}
                />
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="swords" size={13} style={{ color: "#ffb700" }} />
                    Attach a Queue
                  </span>
                  <span style={{ fontSize: 11.5, color: "rgba(238,238,245,0.5)", lineHeight: 1.4 }}>
                    Readers pick a side and line up from your post; two opposite sides get matched into a live room.
                  </span>
                </span>
              </label>
              {t.on && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    value={t.question}
                    onChange={(e) => onTopic({ ...t, question: e.target.value.slice(0, 200) })}
                    placeholder="The question to argue (5–200 characters)"
                    maxLength={200}
                    aria-label="Conversation question"
                    style={{ ...fieldStyle, flex: "1 1 260px", minWidth: 0 }}
                  />
                  <select
                    value={t.topicKey}
                    onChange={(e) => onTopic({ ...t, topicKey: e.target.value })}
                    aria-label="Field"
                    style={{ ...fieldStyle, flex: "0 0 auto", width: "auto" }}
                  >
                    {TOPICS.filter((x) => TOPIC_QUEUE_KEYS.has(x.key)).map((x) => (
                      <option key={x.key} value={x.key}>{x.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })()}

        {tags.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "10px 0 2px", flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: "rgba(238,238,245,0.35)" }}>Tag:</span>
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onTagId(t.id)}
                className="cursor-pointer bg-transparent border-none p-0"
                style={{ opacity: tagId && tagId !== t.id ? 0.45 : 1 }}
              >
                <TagChip name={t.name} color={t.color} />
              </button>
            ))}
          </div>
        )}

        {clip && (
          <div style={{ display: "flex", alignItems: "center", padding: "8px 0 2px", flexShrink: 0, minWidth: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "6px 12px 6px 7px", borderRadius: 10, background: "#0b0b0d", border: "1px solid rgba(255,255,255,0.12)", maxWidth: "100%", minWidth: 0 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: "#ffb700", color: "#1a0e00", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name="play" size={11} strokeWidth={0} style={{ fill: "currentColor", marginLeft: 1 }} />
              </span>
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#f5f5f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clip.title}</span>
                <span style={{ fontSize: 11, color: "rgba(238,238,245,0.5)" }}>Clip{clip.duration ? ` · ${clip.duration}` : ""} · attached to this post</span>
              </span>
            </span>
          </div>
        )}

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

        {/* Desktop footer. Phones post from the header. */}
        {!phone && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexShrink: 0 }}>
            {nearMax && (
              <span style={{ fontSize: 11, color: body.length > maxLength ? "#e26b6b" : "rgba(238,238,245,0.35)" }}>
                {body.length.toLocaleString()} / {maxLength.toLocaleString()}
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
          <span style={{ fontSize: 11, padding: "4px 0 8px", color: body.length > maxLength ? "#e26b6b" : "rgba(238,238,245,0.35)", flexShrink: 0 }}>
            {body.length.toLocaleString()} / {maxLength.toLocaleString()}
          </span>
        )}
        {phone && <div style={{ height: 8, flexShrink: 0 }} />}
      </div>
    </div>,
    document.body
  );
}
