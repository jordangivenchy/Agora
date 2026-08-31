import { describe, it, expect } from "vitest";
import { notificationBatchSubject, digestHasContent, digestIntro, replaysLine, DIGEST_SUBJECT, type DigestData } from "@/lib/emailCopy";
import { notificationBatchEmail, weeklyDigestEmail } from "@/lib/email";
import { emailEnabledFor, unsubToken, unsubUrl } from "@/lib/emailNotif";

const empty: DigestData = { unreadCount: 0, unread: [], upcoming: [], topPosts: [], newFollowers: 0, replaysMissed: 0 };

describe("notificationBatchSubject", () => {
  it("uses the sentence for a single item", () => {
    expect(notificationBatchSubject([{ text: "@x replied to your comment on “Hi”", url: null }]))
      .toBe("New on AgoraSphere: @x replied to your comment on “Hi”");
  });
  it("truncates long single subjects", () => {
    const s = notificationBatchSubject([{ text: "a".repeat(120), url: null }]);
    expect(s.length).toBeLessThan(100);
    expect(s.endsWith("…")).toBe(true);
  });
  it("counts for batches", () => {
    expect(notificationBatchSubject([{ text: "a", url: null }, { text: "b", url: null }, { text: "c", url: null }]))
      .toBe("3 new things on AgoraSphere");
  });
});

describe("notificationBatchEmail", () => {
  it("renders links, escapes html, includes unsubscribe + settings", () => {
    const { subject, html, text } = notificationBatchEmail({
      items: [{ text: "<b>bold</b> replied", detail: "hi & bye", url: "https://x.test/posts/1" }],
      origin: "https://x.test", unsubUrl: "https://x.test/api/email/unsubscribe?u=1&t=2",
    });
    expect(subject).toContain("New on AgoraSphere");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("hi &amp; bye");
    expect(html).toContain('href="https://x.test/posts/1"');
    expect(html).toContain("https://x.test/api/email/unsubscribe?u=1&amp;t=2");
    expect(html).toContain("https://x.test/settings");
    expect(text).toContain("https://x.test/posts/1");
    expect(text).toContain("Unsubscribe from all email: https://x.test/api/email/unsubscribe?u=1&t=2");
  });
});

describe("digest copy", () => {
  it("detects empty digests", () => {
    expect(digestHasContent(empty)).toBe(false);
    expect(digestHasContent({ ...empty, newFollowers: 1 })).toBe(true);
    expect(digestHasContent({ ...empty, replaysMissed: 2 })).toBe(true);
  });
  it("builds the intro", () => {
    expect(digestIntro({ ...empty, unreadCount: 1, newFollowers: 2 })).toBe("This week: 1 unread notification, 2 new followers.");
    expect(digestIntro({ ...empty, topPosts: [{ title: "t", community: "c", score: 1, comments: 0, url: "u" }] }))
      .toBe("Here's what happened in your corner of AgoraSphere this week.");
  });
  it("pluralises replays", () => {
    expect(replaysLine(0)).toBeNull();
    expect(replaysLine(1)).toContain("1 discussion from someone you follow");
    expect(replaysLine(3)).toContain("3 discussions");
  });
  it("renders every section", () => {
    const { subject, html, text } = weeklyDigestEmail({
      data: {
        unreadCount: 4,
        unread: [{ text: "@a mentioned you", url: "https://x.test/posts/1" }],
        upcoming: [{ motion: "Cats > dogs", host: "Ann", startsAt: "Mon 5:00 PM UTC", url: "https://x.test/agora/cats" }],
        topPosts: [{ title: "Top", community: "Politics", score: 12, comments: 3, url: "https://x.test/posts/2" }],
        newFollowers: 1,
        replaysMissed: 1,
      },
      origin: "https://x.test", unsubUrl: "https://x.test/u",
    });
    expect(subject).toBe(DIGEST_SUBJECT);
    for (const needle of ["Unread (4)", "Upcoming from people you follow", "Top posts this week", "12 upvotes", "3 comments", "1 new follower this week", "Discussions you missed"]) {
      expect(html).toContain(needle);
      expect(text.toLowerCase()).toContain(needle.split(" (")[0].toLowerCase().replace("discussions you missed", "recording is waiting"));
    }
  });
});

describe("emailNotif helpers", () => {
  it("applies defaults and explicit prefs", () => {
    expect(emailEnabledFor(undefined, "post_reply")).toBe(true);
    expect(emailEnabledFor(undefined, "new_follower")).toBe(false);
    expect(emailEnabledFor({ email_prefs: { post_reply: false }, email_digest: null, email_unsubscribed_at: null, last_digest_at: null }, "post_reply")).toBe(false);
    expect(emailEnabledFor({ email_prefs: { new_follower: true }, email_digest: null, email_unsubscribed_at: null, last_digest_at: null }, "new_follower")).toBe(true);
  });
  it("mints a 64-hex hmac token and a link", () => {
    const t = unsubToken("00000000-0000-0000-0000-000000000001", "secret");
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(unsubUrl("https://x.test", "00000000-0000-0000-0000-000000000001", "secret"))
      .toBe(`https://x.test/api/email/unsubscribe?u=00000000-0000-0000-0000-000000000001&t=${t}`);
  });
});
