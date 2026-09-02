"use client";

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

export const authorLabel = (dn: string | null, username: string) => dn?.trim() || `@${username}`;

/* MOD / OWNER badge next to author names. */
export function RoleBadge({ role }: { role: string | null }) {
  if (role !== "owner" && role !== "moderator") return null;
  const owner = role === "owner";
  return (
    <span
      className="text-[9px] font-bold px-1.5 rounded"
      style={{
        background: owner ? "rgba(226,185,107,0.14)" : "rgba(0,184,148,0.14)",
        border: `0.5px solid ${owner ? "rgba(226,185,107,0.4)" : "rgba(0,184,148,0.4)"}`,
        color: owner ? "#e2b96b" : "#00b894",
        letterSpacing: "0.04em",
        padding: "1px 5px",
      }}
    >
      {owner ? "OWNER" : "MOD"}
    </span>
  );
}

export function TagChip({ name, color, small }: { name: string; color: string | null; small?: boolean }) {
  const c = color || "rgba(238,238,245,0.5)";
  return (
    <span
      className="rounded-full"
      style={{
        fontSize: small ? 9.5 : 10.5,
        padding: small ? "1px 7px" : "2px 8px",
        background: `${c}22`,
        border: `0.5px solid ${c}66`,
        color: c,
        fontWeight: 600,
      }}
    >
      {name}
    </span>
  );
}

/* Vote column shared by feed cards and the detail view. */
export function VoteBox<P extends Pick<PostRow, "score" | "my_vote">>({
  post, onVote, size = 13,
}: { post: P; onVote: (p: P, v: number) => void; size?: number }) {
  return (
    <div className="flex flex-col items-center shrink-0 vote-box" style={{ width: 34 }}>
      <button
        onClick={(e) => { e.stopPropagation(); onVote(post, post.my_vote === 1 ? 0 : 1); }}
        className="cursor-pointer bg-transparent border-none px-1"
        style={{ color: post.my_vote === 1 ? "#e2b96b" : "rgba(238,238,245,0.32)", fontSize: size + 1 }}
        aria-label="Upvote"
      >
        ▲
      </button>
      <span className="text-center" style={{ color: "#eeeef5", fontSize: size, fontWeight: 600 }}>
        {post.score}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onVote(post, post.my_vote === -1 ? 0 : -1); }}
        className="cursor-pointer bg-transparent border-none px-1"
        style={{ color: post.my_vote === -1 ? "#64B5F6" : "rgba(238,238,245,0.32)", fontSize: size + 1 }}
        aria-label="Downvote"
      >
        ▼
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
      {p.orig_body && (
        <div className="text-[11.5px]" style={{
          color: "rgba(238,238,245,0.55)", marginTop: 4, lineHeight: 1.5,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          <RichText text={p.orig_body} />
        </div>
      )}
      {p.orig_image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.orig_image_url} alt="" className="mt-1.5 rounded-lg"
          style={{ maxHeight: 160, maxWidth: "100%", objectFit: "cover" }} />
      )}
    </div>
  );
}

interface PostCardProps<P extends PostRow> {
  post: P;
  onOpen: (post: P) => void;
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
  compact?: boolean;
  className?: string;
}

export default function PostCard<P extends PostRow>({
  post: p, onOpen, onVote, showCommunity, onOpenCommunity, author, actions, embed, reason, compact, className,
}: PostCardProps<P>) {
  return (
    <div
      className={`cm-card ${compact ? "p-3" : "p-4"} mb-3 flex gap-3 cursor-pointer${className ? ` ${className}` : ""}`}
      style={postCardStyle}
      onClick={() => onOpen(p)}
    >
      {onVote && <VoteBox post={p} onVote={onVote} />}
      <div className="flex-1 min-w-0">
        {reason && (
          <p className="m-0 mb-1 text-[10.5px] inline-flex items-center gap-1" style={{ color: "rgba(238,238,245,0.38)" }}>
            <Icon name="sparkles" size={11} /> {reason}
          </p>
        )}
        <p className="m-0 text-[10.5px] flex items-center gap-1.5 flex-wrap" style={{ color: "rgba(238,238,245,0.5)" }}>
          <span className="inline-flex items-center gap-1">
            {showCommunity && (
              <>
                <span
                  onClick={(e) => { e.stopPropagation(); onOpenCommunity?.(p.community_id); }}
                  className="cursor-pointer"
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
          {p.is_repost && <span className="inline-flex items-center" style={{ color: "#e2b96b" }}><Icon name="repeat" size={12} /></span>}
          {p.pinned_at && (
            <span className="text-[9px] font-bold rounded" style={{
              background: "rgba(74,158,255,0.12)", border: "0.5px solid rgba(74,158,255,0.35)",
              color: "#4a9eff", padding: "1px 5px", letterSpacing: "0.04em",
            }}>
              <Icon name="pin" size={10} /> PINNED
            </span>
          )}
          {p.tag_name && <TagChip name={p.tag_name} color={p.tag_color} small />}
        </p>
        <p className="m-0 mt-0.5 text-[14px] font-medium" style={{ color: "#eeeef5" }}>
          <RichText text={p.title} inline />
        </p>
        {p.body && (
          <div className="mt-1 text-[12px] leading-relaxed" style={{
            color: "rgba(238,238,245,0.55)",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            <RichText text={p.body} />
          </div>
        )}
        {p.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt="" className="mt-1.5 rounded-lg"
            style={{ maxHeight: compact ? 160 : 220, maxWidth: "100%", objectFit: "cover" }} />
        )}
        {embed !== undefined ? embed : <RepostEmbed post={p} />}
        <div className="m-0 text-[11px]" style={{ color: "rgba(238,238,245,0.32)", marginTop: compact ? 10 : 16 }}>
          {actions ?? (
            <span className="text-[12px] inline-flex items-center gap-1" style={{ color: "rgba(238,238,245,0.55)" }}>
              <Icon name="message-circle" size={14} /> {p.comment_count} comment{p.comment_count === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
