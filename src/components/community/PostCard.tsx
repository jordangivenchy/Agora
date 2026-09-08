"use client";

import { useRef, useState } from "react";
import { createLongPress } from "@/lib/longPress";

/* One community post as a feed card — shared by the Communities board
   and the home feed so both render the identical thing. The card owns
   the layout (vote column, meta line, title, clamped body, image,
   repost embed, action row); the page that renders it supplies the
   pieces that depend on its own state through slots:

     author   — the clickable identity chip (needs the page's avatar cache)
     actions  — share / repost / pin / delete row (needs its modals)
     embed    — the repost's embedded original (needs its post navigation)

   The row type mirrors get_community_posts' return columns exactly;
   get_home_feed's post payloads use the same set. */

import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import RichText from "./RichText";
import { clipIdInBody, stripClipLink } from "./ClipEmbed";
import { openImage } from "@/lib/lightbox";
import PostTopicQueue from "./PostTopicQueue";

export type PostRow = {
  id: string;
  community_id: string;
  community_name: string;
  author_id: string | null;
  author_username: string;
  author_display_name: string | null;
  title: string;
  body: string | null;
  created_at: string;
  score: number;
  my_vote: number | null;
  comment_count: number;
  image_url: string | null;
  tag_id: string | null;
  tag_name: string | null;
  tag_color: string | null;
  author_role: string | null;
  is_repost: boolean;
  repost_of: string | null;
  orig_title: string | null;
  orig_body: string | null;
  orig_image_url: string | null;
  orig_community_name: string | null;
  orig_author_username: string | null;
  orig_author_display_name: string | null;
  pinned_at: string | null;
};

/* Homepage v5 glass: translucent card, blur, hairline border. */
export const postCardStyle: React.CSSProperties = {
  background: "rgba(14,14,17,0.72)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14,
};

export function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - +new Date(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/* On the boards a person is their handle: stable, unique, what mods act
   on and what the profile URL spells. Display names stay for rooms and
   profiles (the feed's room rows pass their own label). */
export const authorLabel = (_dn: string | null, username: string) => `@${username}`;

/* Status labels are small tracked caps in a colour — no fill, no box.
   A tinted pill behind nine-point type was the one thing on the card
   that looked like a sticker. */
export const badgeStyle = (color: string): React.CSSProperties => ({
  color, fontSize: 9, fontWeight: 800, letterSpacing: "0.09em", lineHeight: 1,
  display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap",
});

/* MOD / OWNER label next to author names. */
export function RoleBadge({ role }: { role: string | null }) {
  if (role !== "owner" && role !== "moderator") return null;
  const owner = role === "owner";
  return <span style={badgeStyle(owner ? "#e2b96b" : "#00b894")}>{owner ? "OWNER" : "MOD"}</span>;
}

export function PinnedBadge() {
  return <span style={badgeStyle("#4a9eff")}><Icon name="pin" size={10} /> PINNED</span>;
}

/* Solid, not tinted: a near-black pill with a hairline; the tag's colour
   is a dot, never a wash behind the text. Shared by community tags and
   the feed's topic chips. */
export function TagChip({ name, color, small }: { name: string; color: string | null; small?: boolean }) {
  const c = color || "rgba(238,238,245,0.5)";
  return (
    <span
      className="rounded-full inline-flex items-center"
      style={{
        fontSize: small ? 9.5 : 10.5,
        padding: small ? "1px 7px 1px 6px" : "2px 9px 2px 7px",
        gap: 5,
        background: "#0b0b0d",
        border: "0.5px solid rgba(255,255,255,0.14)",
        color: "#eeeef5",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0 }} />
      {name}
    </span>
  );
}

/* Vote column shared by feed cards and the detail view. */
export function VoteBox<P extends Pick<PostRow, "score" | "my_vote">>({
  post, onVote, size = 13, centerOn, selfCenter = false,
}: {
  post: P;
  onVote: (p: P, v: number) => void;
  size?: number;
  /** Centre the score on a neighbour's box of this height (the community
      tile): the column takes that height and the arrows overflow it
      evenly above and below. */
  centerOn?: { height: number; offset?: number };
  /** Centre the column in the row instead (cards with nothing above the tile). */
  selfCenter?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center shrink-0 vote-box"
      style={{
        width: 34,
        ...(centerOn ? { height: centerOn.height, marginTop: centerOn.offset ?? 0, justifyContent: "center", overflow: "visible" } : {}),
        ...(selfCenter ? { alignSelf: "center" } : {}),
      }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onVote(post, post.my_vote === 1 ? 0 : 1); }}
        className="cursor-pointer bg-transparent border-none px-1 inline-flex items-center justify-center"
        style={{ color: post.my_vote === 1 ? "#e2b96b" : "rgba(238,238,245,0.32)", lineHeight: 1 }}
        aria-label="Upvote"
      >
        <Icon name="chevron-up" size={size + 5} />
      </button>
      <span className="text-center" style={{ color: "#eeeef5", fontSize: size, fontWeight: 600 }}>
        {post.score}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onVote(post, post.my_vote === -1 ? 0 : -1); }}
        className="cursor-pointer bg-transparent border-none px-1 inline-flex items-center justify-center"
        style={{ color: post.my_vote === -1 ? "#64B5F6" : "rgba(238,238,245,0.32)", lineHeight: 1 }}
        aria-label="Downvote"
      >
        <Icon name="chevron-down" size={size + 5} />
      </button>
    </div>
  );
}

/* Default repost embed — read-only; pages that can navigate to the
   original pass their own `embed`. */
export function RepostEmbed({ post: p, onOpenOriginal }: { post: PostRow; onOpenOriginal?: (id: string) => void }) {
  if (!p.is_repost) return null;
  if (!p.repost_of) {
    return (
      <p className="m-0 px-3 py-2 text-[11.5px] rounded-lg"
        style={{ background: "rgba(255,255,255,0.03)", border: "0.5px dashed rgba(255,255,255,0.14)", color: "rgba(238,238,245,0.32)", marginTop: 10 }}>
        The original post was unavailable or deleted.
      </p>
    );
  }
  return (
    <div
      className="rounded-lg cursor-pointer"
      style={{
        background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.1)",
        marginTop: 10, padding: "10px 12px 11px",
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (p.repost_of) onOpenOriginal?.(p.repost_of);
      }}
    >
      <p className="m-0 text-[10px] inline-flex items-center gap-1" style={{ color: "rgba(238,238,245,0.5)" }}>
        <Icon name="repeat" size={11} /> from <span style={{ color: "#e2b96b" }}>{p.orig_community_name ?? "a community"}</span>
        {p.orig_author_username && <> · {authorLabel(p.orig_author_display_name, p.orig_author_username)}</>}
      </p>
      <p className="m-0 text-[12.5px] font-medium" style={{ color: "rgba(238,238,245,0.88)", marginTop: 5 }}>
        <RichText text={p.orig_title ?? ""} inline />
      </p>
      {stripClipLink(p.orig_body) && (
        <div className="text-[11.5px]" style={{
          color: "rgba(238,238,245,0.55)", marginTop: 4, lineHeight: 1.5,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          <RichText text={stripClipLink(p.orig_body)} />
        </div>
      )}
      <ClipChip clipId={clipIdInBody(p.orig_body)} small />
      {p.orig_image_url && (
        <button type="button" onClick={(e) => { e.stopPropagation(); if (p.orig_image_url) openImage(p.orig_image_url); }} aria-label="Open image" style={{ display: "block", padding: 0, border: "none", background: "none", cursor: "zoom-in", marginTop: 6, maxWidth: "100%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.orig_image_url} alt="" className="rounded-lg"
            style={{ maxHeight: 160, maxWidth: "100%", objectFit: "cover", display: "block" }} />
        </button>
      )}
    </div>
  );
}

interface PostCardProps<P extends PostRow> {
  post: P;
  onOpen: (post: P) => void;
  /** Phones: press-and-hold on the card (the caller opens its action sheet). */
  onLongPress?: (post: P) => void;
  /** Vote column is rendered only when a handler is supplied. */
  onVote?: (post: P, value: number) => void;
  /** Show the community name before the author (board-wide lists). */
  showCommunity?: boolean;
  onOpenCommunity?: (communityId: string) => void;
  /** Identity chip for the author (page-specific: avatar cache, menus). */
  author: ReactNode;
  /** Share / repost / pin / delete row; comment count is appended unless `compact`. */
  actions?: ReactNode;
  /** Repost embed; defaults to the read-only RepostEmbed. */
  embed?: ReactNode;
  /** Muted "why you're seeing this" line above the title. */
  reason?: string | null;
  /** The board's art — its avatar, or a coloured tile with its initial —
      a 30px mark at the left of the post. Replaces the author's picture. */
  communityArt?: { name: string; color?: string | null; avatarUrl?: string | null };
  compact?: boolean;
  className?: string;
}

/* The board's mark: 30px, softly rounded, image or initial on the board's colour. */
export function CommunityTile({ name, color, avatarUrl, size = 30 }: { name: string; color?: string | null; avatarUrl?: string | null; size?: number }) {
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center overflow-hidden"
      title={name}
      style={{
        width: size, height: size, borderRadius: Math.round(size * 0.32),
        background: color || "#2f7fe0", color: "#fff",
        fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: Math.round(size * 0.45),
      }}
    >
      {avatarUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export default function PostCard<P extends PostRow>({
  post: p, onOpen, onVote, showCommunity, onOpenCommunity, author, actions, embed, reason, communityArt, compact, className, onLongPress,
}: PostCardProps<P>) {
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  /* Touch/pen only — the helper ignores mouse pointers. The click the
     browser synthesises after a press is swallowed. */
  const [press] = useState(() => createLongPress<P>((post) => onLongPressRef.current?.(post)));
  return (
    <div
      className={`cm-card ${compact ? "p-3" : "p-4"} mb-3 flex flex-col cursor-pointer${className ? ` ${className}` : ""}`}
      style={postCardStyle}
      onClick={(e) => {
        if (press.consumeClick()) { e.preventDefault(); return; }
        onOpen(p);
      }}
      onPointerDown={onLongPress ? (e) => press.onPointerDown(e, p) : undefined}
      onPointerMove={onLongPress ? press.onPointerMove : undefined}
      onPointerUp={onLongPress ? press.onPointerUp : undefined}
      onPointerCancel={onLongPress ? press.onPointerCancel : undefined}
      onContextMenu={onLongPress ? (e) => { if (press.lastPointerType() !== "mouse") e.preventDefault(); } : undefined}
    >
      {/* The "why it's here" caption runs across the top; below it the row:
          votes (the score centred on the community tile), the tile level
          with the community name, then the text. */}
      {reason && (
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          {/* A blank exactly as wide as the vote column plus the row gap
              puts the first letter on the tile's left edge; the sparkle
              rides at the blank's right end, in the gap between the score
              and the tile. Inline layout — nothing here for a reset to
              override. */}
          {onVote && (
            <span
              aria-hidden="true"
              className="cm-caption-spacer"
              style={{
                /* vote column + row gap: 34 + 12 here, 28 + 10 on phones (globals.css).
                   The 4px on the right is the icon's usual distance from the text. */
                width: 46, flexShrink: 0, boxSizing: "border-box", paddingRight: 4,
                display: "inline-flex", alignItems: "center", justifyContent: "flex-end",
                color: "rgba(238,238,245,0.38)", lineHeight: 0,
              }}
            >
              <Icon name="sparkles" size={11} />
            </span>
          )}
          <p style={{ margin: 0, minWidth: 0, fontSize: 10.5, lineHeight: "16px", color: "rgba(238,238,245,0.38)" }}>
            {reason}
          </p>
        </div>
      )}
      <div className="flex gap-3 cm-card-row">
      {/* With a caption above, the score sits level with the tile; without
          one the column is centred in the card. */}
      {onVote && (
        <VoteBox
          post={p}
          onVote={onVote}
          centerOn={communityArt && reason ? { height: 30, offset: 2 } : undefined}
          selfCenter={!reason}
        />
      )}
      {communityArt && (
        <span
          className="shrink-0"
          style={{ marginTop: 2, cursor: onOpenCommunity ? "pointer" : undefined }}
          onClick={(e) => { if (!onOpenCommunity) return; e.stopPropagation(); onOpenCommunity(p.community_id); }}
        >
          <CommunityTile name={communityArt.name} color={communityArt.color} avatarUrl={communityArt.avatarUrl} />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="m-0 text-[10.5px] flex items-center gap-1.5 flex-wrap" style={{ color: "rgba(238,238,245,0.5)" }}>
          <span className="inline-flex items-center gap-1">
            {showCommunity && (
              <>
                <span
                  onClick={(e) => { e.stopPropagation(); onOpenCommunity?.(p.community_id); }}
                  className="cursor-pointer inline-flex items-center gap-1.5"
                  title={`Go to ${p.community_name}`}
                  style={{ color: "#e2b96b", textDecoration: "underline dotted rgba(226,185,107,0.4)", textUnderlineOffset: 2 }}
                >
                  {p.community_name}
                </span>
                <span>·</span>
              </>
            )}
            {author}
            <span>·</span>
            <span>{timeAgo(p.created_at)}</span>
          </span>
          <RoleBadge role={p.author_role} />
          {/* No repost glyph up here: the embed below says "from <board>". */}
          {p.pinned_at && <PinnedBadge />}
          {p.tag_name && <TagChip name={p.tag_name} color={p.tag_color} small />}
        </p>
        <p className="m-0 mt-0.5 text-[14px] font-medium" style={{ color: "#eeeef5" }}>
          <RichText text={p.title} inline />
        </p>
        {stripClipLink(p.body) && (
          <div className="mt-1 text-[12px] leading-relaxed" style={{
            color: "rgba(238,238,245,0.55)",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            <RichText text={stripClipLink(p.body)} />
          </div>
        )}
        <ClipChip clipId={clipIdInBody(p.body)} small={compact} />
        {p.image_url && (
          <button type="button" onClick={(e) => { e.stopPropagation(); if (p.image_url) openImage(p.image_url); }} aria-label="Open image" style={{ display: "block", padding: 0, border: "none", background: "none", cursor: "zoom-in", marginTop: 6, maxWidth: "100%" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.image_url} alt="" className="rounded-lg"
              style={{ maxHeight: compact ? 160 : 220, maxWidth: "100%", objectFit: "cover", display: "block" }} />
          </button>
        )}
        <PostTopicQueue postId={p.id} compact />
        {embed !== undefined ? embed : <RepostEmbed post={p} />}
        {/* The actions row hangs its leading icon (14px + 4px gap) into the
            column gap, so the comment count starts on the title's first
            letter — the same treatment as the caption's sparkle. */}
        <div className="m-0 text-[11px]" style={{ color: "#c9c9d2", marginTop: compact ? 10 : 16, marginLeft: communityArt ? -18 : 0 }}>
          {actions ?? (
            <span className="text-[12px] inline-flex items-center gap-1" style={{ color: "#c9c9d2" }}>
              <Icon name="message-circle" size={14} /> {p.comment_count} comment{p.comment_count === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

/* A post that shares a clip carries the clip link in its body; the card
   swaps that line of URL for this chip (the open post gets the player,
   community/ClipEmbed.tsx). Clicking it goes to the clip's page without
   opening the post. Renders nothing for ordinary posts. */
export function ClipChip({ clipId, small }: { clipId: string | null; small?: boolean }) {
  if (!clipId) return null;
  return (
    <a
      href={`/clips/${clipId}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center no-underline"
      style={{
        gap: 6, marginTop: 6, padding: small ? "3px 10px 3px 8px" : "4px 12px 4px 9px", borderRadius: 999,
        background: "#0b0b0d", border: "1px solid rgba(255,255,255,0.14)",
        color: "#4a9eff", fontSize: small ? 11 : 12, fontWeight: 600, lineHeight: 1.4,
      }}
    >
      <Icon name="play" size={9} strokeWidth={0} style={{ fill: "currentColor" }} />
      Clip
    </a>
  );
}
