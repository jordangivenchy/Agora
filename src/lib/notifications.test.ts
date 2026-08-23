import { describe, expect, it } from "vitest";
import {
  actorPhrase, formatScheduledStart, matchesFilter, notifHref, notifIcon, notifText, timeAgo,
  type NotifRow,
} from "./notifications";

function row(over: Partial<NotifRow>): NotifRow {
  return {
    id: "n1", type: "post_comment",
    actor_id: "a1", actor_username: "ada", actor_display_name: null, actor_avatar_url: null,
    room_id: null, room_motion: null, room_status: null, room_scheduled_start: null,
    post_id: null, post_title: null, community_name: null,
    comment_id: null, comment_excerpt: null,
    meta: {}, read_at: null, created_at: "2026-08-22T10:00:00Z",
    ...over,
  };
}

describe("actorPhrase", () => {
  it("prefers display name, falls back to username", () => {
    expect(actorPhrase(row({ actor_display_name: "Ada L." }))).toBe("Ada L.");
    expect(actorPhrase(row({}))).toBe("ada");
    expect(actorPhrase(row({ actor_username: null }))).toBe("Someone");
  });
  it("folds the coalesced count into 'and N others'", () => {
    expect(actorPhrase(row({ meta: { count: 2 } }))).toBe("ada and 1 other");
    expect(actorPhrase(row({ meta: { count: 4 } }))).toBe("ada and 3 others");
    expect(actorPhrase(row({ meta: { count: 1 } }))).toBe("ada");
  });
});

describe("notifText", () => {
  it("comments / replies / reposts", () => {
    expect(notifText(row({ type: "post_comment", post_title: "Tax the robots", meta: { count: 3 } })))
      .toBe("ada and 2 others commented on “Tax the robots”");
    expect(notifText(row({ type: "post_reply", post_title: "Tax the robots" })))
      .toBe("ada replied to your comment on “Tax the robots”");
    expect(notifText(row({ type: "repost", post_title: "Tax the robots" })))
      .toBe("ada reposted “Tax the robots”");
  });
  it("milestones read the meta", () => {
    expect(notifText(row({ type: "post_upvotes", post_title: "T", meta: { milestone: 25 } })))
      .toBe("Your post “T” hit 25 upvotes");
    expect(notifText(row({ type: "comment_upvotes", post_title: "T", meta: { milestone: "5" } })))
      .toBe("Your comment on “T” hit 5 upvotes");
  });
  it("debate events", () => {
    expect(notifText(row({ type: "followed_live", room_motion: "M" }))).toBe("ada went live: “M”");
    expect(notifText(row({ type: "debate_replay_ready", room_motion: "M" }))).toBe("Replay of “M” is ready");
    expect(notifText(row({ type: "discussion_opened", room_motion: "M" })))
      .toBe("ada started the discussion on “M”");
  });
  it("scheduled includes a relative time", () => {
    const now = new Date("2026-08-22T10:00:00Z");
    const at = new Date(now.getTime() + 2 * 86_400_000);
    at.setHours(19, 0, 0, 0);
    const text = notifText(row({ type: "followed_scheduled", room_motion: "M", room_scheduled_start: at.toISOString() }), now);
    expect(text.startsWith("ada scheduled “M” for ")).toBe(true);
    expect(text).toContain(at.toLocaleDateString([], { weekday: "short" }));
  });
});

describe("formatScheduledStart", () => {
  const now = new Date("2026-08-22T10:00:00");
  it("today / tomorrow / weekday / date", () => {
    expect(formatScheduledStart("2026-08-22T19:00:00", now)).toMatch(/^today /);
    expect(formatScheduledStart("2026-08-23T19:00:00", now)).toMatch(/^tomorrow /);
    expect(formatScheduledStart("2026-08-25T19:00:00", now)).toMatch(/^Tue /);
    expect(formatScheduledStart("2026-09-25T19:00:00", now)).toMatch(/^Sep 25 /);
    expect(formatScheduledStart(null, now)).toBe("");
    expect(formatScheduledStart("garbage", now)).toBe("");
  });
});

describe("notifHref", () => {
  it("posts deep-link to the comment only when it's a single event", () => {
    expect(notifHref(row({ type: "post_reply", post_id: "p", comment_id: "c", meta: { reply_id: "r" } })))
      .toBe("/posts/p#comment-r");
    expect(notifHref(row({ type: "post_comment", post_id: "p", comment_id: "c", meta: { count: 3, reply_id: "r" } })))
      .toBe("/posts/p");
    expect(notifHref(row({ type: "comment_upvotes", post_id: "p", comment_id: "c" }))).toBe("/posts/p#comment-c");
    expect(notifHref(row({ type: "post_upvotes", post_id: "p" }))).toBe("/posts/p");
  });
  it("rooms use the pretty room path, live or ended", () => {
    const id = "6c0ba6be-0000-4000-8000-000000000000";
    expect(notifHref(row({ type: "followed_live", room_id: id, room_motion: "Voting should be mandatory" })))
      .toBe("/agora/voting-should-be-mandatory-6c0ba6be");
    expect(notifHref(row({ type: "debate_replay_ready", room_id: id, room_motion: "Voting should be mandatory", room_status: "ended" })))
      .toBe("/agora/voting-should-be-mandatory-6c0ba6be");
  });
  it("discussion_opened prefers the post", () => {
    expect(notifHref(row({ type: "discussion_opened", post_id: "p", room_id: "r" }))).toBe("/posts/p");
  });
  it("returns null without a target", () => {
    expect(notifHref(row({ type: "post_comment" }))).toBeNull();
  });
});

describe("icons + filters", () => {
  it("maps every new type to a Lucide icon", () => {
    expect(notifIcon("post_reply")).toBe("message-circle");
    expect(notifIcon("post_upvotes")).toBe("arrow-up");
    expect(notifIcon("repost")).toBe("repeat");
    expect(notifIcon("followed_scheduled")).toBe("calendar");
    expect(notifIcon("followed_live")).toBe("zap");
    expect(notifIcon("debate_replay_ready")).toBe("play");
    expect(notifIcon("discussion_opened")).toBe("message-square");
  });
  it("filter chips partition the types", () => {
    expect(matchesFilter("mention", "mentions")).toBe(true);
    expect(matchesFilter("followed_live", "debates")).toBe(true);
    expect(matchesFilter("post_reply", "posts")).toBe(true);
    expect(matchesFilter("post_reply", "debates")).toBe(false);
    expect(matchesFilter("anything", "all")).toBe(true);
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-08-22T10:00:00Z");
  it("compact buckets", () => {
    expect(timeAgo("2026-08-22T09:59:50Z", now)).toBe("now");
    expect(timeAgo("2026-08-22T09:30:00Z", now)).toBe("30m");
    expect(timeAgo("2026-08-22T04:00:00Z", now)).toBe("6h");
    expect(timeAgo("2026-08-19T10:00:00Z", now)).toBe("3d");
  });
});
