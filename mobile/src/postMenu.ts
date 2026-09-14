/* The post and comment menus are drawn once, by PostActionsProvider at
   the root; cards and threads open them through here, so the card
   doesn't import the provider (and its sheets) back. */
import type { CommentRow, PostRow } from "./communities";

export interface PostHandlers {
  /** A field changed here: pinned, featured, edited. */
  onChanged?: (patch: Partial<PostRow>) => void;
  /** The post is gone. */
  onRemoved?: () => void;
}

export interface CommentHandlers {
  onReply?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onChanged?: (patch: Partial<CommentRow>) => void;
  onRemoved?: () => void;
}

export type MenuPost = Pick<PostRow, "id" | "community_id" | "author_id" | "title" | "body" | "pinned_at"> & Partial<Pick<PostRow, "featured_at" | "edited_at" | "community_name">>;

interface Opener {
  openPost(post: MenuPost, h?: PostHandlers): void;
  openComment(comment: CommentRow, post: MenuPost | null, h?: CommentHandlers): void;
  repost(post: MenuPost, h?: PostHandlers): void;
}

let opener: Opener | null = null;

export function registerPostMenus(o: Opener | null) {
  opener = o;
}

export function openPostMenu(post: MenuPost, h?: PostHandlers) {
  opener?.openPost(post, h);
}

export function openCommentMenu(comment: CommentRow, post: MenuPost | null, h?: CommentHandlers) {
  opener?.openComment(comment, post, h);
}

export function startRepost(post: MenuPost, h?: PostHandlers) {
  opener?.repost(post, h);
}

/** The site's link to a thread, or to one comment in it. */
export function postUrl(site: string, postId: string, commentId?: string | null): string {
  return `${site}/posts/${encodeURIComponent(postId)}${commentId ? `#comment-${encodeURIComponent(commentId)}` : ""}`;
}
