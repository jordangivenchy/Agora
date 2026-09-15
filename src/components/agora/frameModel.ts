/* The About panel's pure parts: a key that changes whenever what the
   room is about does (for the unread dot), and its measures. */

import type { RoomFraming } from "@/types/database";

/** Changes whenever the host rewrites it. */
export function frameNewsKey(f: RoomFraming | null | undefined): string {
  return f?.about_at ?? "";
}

/** Has the host written anything yet? */
export function frameIsEmpty(f: RoomFraming | null | undefined): boolean {
  return !f?.about?.trim();
}

/** What the counter shows: its length with each move down a line
    counting once, however the editor writes it (a paragraph break is two
    newlines in markdown). The database applies the same measure. */
export function frameLength(md: string): number {
  return md.replace(/\r/g, "").replace(/\n{2,}/g, "\n").length;
}

/** The most lines it may run to: a few paragraphs, not a scroll. Blank
    lines and bullets count, since they take the same room on screen. */
export const FRAME_MAX_LINES = 16;

/** Lines it takes on screen, blank ones included. */
export function frameLines(md: string): number {
  const t = md.replace(/\r/g, "").trim();
  return t ? t.split("\n").length : 0;
}
