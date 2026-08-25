/* Pure subject/copy builders for the notification batch + weekly digest
   emails. No I/O so they're unit-tested; email.ts wraps them in HTML. */

export type BatchItem = { text: string; detail?: string | null; url: string | null };

/** "New on AgoraSphere: @x replied to you" for one item, "N new things on
    AgoraSphere" for several. The single-item subject is the notification
    sentence, trimmed so long motions don't blow up the subject line. */
export function notificationBatchSubject(items: BatchItem[]): string {
  if (items.length === 1) {
    const t = items[0].text.trim();
    return `New on AgoraSphere: ${t.length > 80 ? t.slice(0, 77).trimEnd() + "…" : t}`;
  }
  return `${items.length} new things on AgoraSphere`;
}

export type DigestUpcoming = { motion: string; host: string; startsAt: string; url: string };
export type DigestPost = { title: string; community: string; score: number; comments: number; url: string };

export type DigestData = {
  unreadCount: number;
  unread: BatchItem[];
  upcoming: DigestUpcoming[];
  topPosts: DigestPost[];
  newFollowers: number;
  replaysMissed: number;
};

export const DIGEST_SUBJECT = "Your week on AgoraSphere";

/** True when at least one section has content worth sending. */
export function digestHasContent(d: DigestData): boolean {
  return d.unreadCount > 0 || d.upcoming.length > 0 || d.topPosts.length > 0
    || d.newFollowers > 0 || d.replaysMissed > 0;
}

export function digestIntro(d: DigestData): string {
  const bits: string[] = [];
  if (d.unreadCount > 0) bits.push(`${d.unreadCount} unread notification${d.unreadCount === 1 ? "" : "s"}`);
  if (d.upcoming.length > 0) bits.push(`${d.upcoming.length} upcoming discussion${d.upcoming.length === 1 ? "" : "s"}`);
  if (d.newFollowers > 0) bits.push(`${d.newFollowers} new follower${d.newFollowers === 1 ? "" : "s"}`);
  if (!bits.length) return "Here's what happened in your corner of AgoraSphere this week.";
  return `This week: ${bits.join(", ")}.`;
}

export function replaysLine(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? "1 discussion from someone you follow was recorded this week — the replay is waiting."
    : `${n} discussions from people you follow were recorded this week — the replays are waiting.`;
}
