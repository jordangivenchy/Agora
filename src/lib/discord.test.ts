import { describe, it, expect, afterEach } from "vitest";
import {
  clip,
  discordConfigured,
  discordWebhook,
  escapeMd,
  featuredPostMessage,
  plainText,
  recordingReadyMessage,
  roomLiveMessage,
} from "./discord";

const ORIGIN = "https://agorasphere.net";
const ROOM = {
  id: "6c0ba6be-1111-4222-8333-444444444444",
  motion: "Voting should be *mandatory*",
  status: "live",
  started_at: "2026-09-11T15:12:00.000Z",
  ended_at: null,
  pro_size: 3,
  con_size: 3,
};
const HOST = { username: "jordan", display_name: "Jordan Jaca", avatar_url: "https://cdn.example/a.png" };

const HOOK = "https://discord.com/api/webhooks/123456789/abcDEF_ghi-JKL";

describe("discordWebhook", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (k.startsWith("DISCORD_")) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it("is unconfigured with nothing set", () => {
    expect(discordWebhook("live")).toBeNull();
    expect(discordConfigured()).toBe(false);
  });

  it("falls back to the shared webhook", () => {
    process.env.DISCORD_WEBHOOK_URL = HOOK;
    expect(discordWebhook("live")).toBe(HOOK);
    expect(discordWebhook("recordings")).toBe(HOOK);
    expect(discordConfigured()).toBe(true);
  });

  it("prefers the channel's own webhook", () => {
    process.env.DISCORD_WEBHOOK_URL = HOOK;
    process.env.DISCORD_WEBHOOK_LIVE = HOOK.replace("123456789", "987");
    expect(discordWebhook("live")).toContain("/987/");
    expect(discordWebhook("recordings")).toBe(HOOK);
  });

  it("refuses anything that is not a Discord webhook URL", () => {
    process.env.DISCORD_WEBHOOK_URL = "https://evil.example/collect";
    expect(discordWebhook("live")).toBeNull();
    process.env.DISCORD_WEBHOOK_URL = "http://discord.com/api/webhooks/1/x";
    expect(discordWebhook("live")).toBeNull();
  });
});

describe("text helpers", () => {
  it("strips markdown to plain text", () => {
    expect(plainText("# Hello\n\n**Bold** and [a link](https://x.y) ![img](https://p.q)\n- one\n- two")).toBe(
      "Hello\nBold and a link\none\ntwo"
    );
  });

  it("clips on a word with an ellipsis", () => {
    expect(clip("short", 10)).toBe("short");
    expect(clip("the quick brown fox jumps", 16)).toBe("the quick brown…");
  });

  it("escapes Discord markdown", () => {
    expect(escapeMd("a*b_c~d`e|f")).toBe("a\\*b\\_c\\~d\\`e\\|f");
  });
});

describe("roomLiveMessage", () => {
  it("headlines the motion, links the room and the host, pings nobody", () => {
    const m = roomLiveMessage(ROOM, HOST, { name: "Politics club" }, ORIGIN);
    expect(m.content).toBe("🔴 **Live now:** Voting should be mandatory");
    expect(m.username).toBe("AgoraSphere");
    expect(m.avatar_url).toBe(`${ORIGIN}/mark-512.png`);
    expect(m.allowed_mentions).toEqual({ parse: [] });
    const e = m.embeds![0];
    expect(e.description).toContain("[Jordan Jaca](https://agorasphere.net/@jordan)");
    expect(e.description).toContain("in **Politics club**");
    expect(e.description).toContain("[Join the room](https://agorasphere.net/agora/voting-should-be-mandatory-6c0ba6be)");
    expect(e.description).not.toContain("queue");
    expect(e.color).toBe(0xffb700);
    expect(e.timestamp).toBe(ROOM.started_at);
    expect(e.thumbnail).toEqual({ url: HOST.avatar_url });
    expect(e.footer?.text).toBe("AgoraSphere beta");
  });

  it("marks a queue match and survives a nameless host", () => {
    const m = roomLiveMessage({ ...ROOM, pro_size: 1, con_size: 1, motion: null }, null, null, ORIGIN);
    expect(m.content).toBe("🔴 **Live now:** Untitled room");
    expect(m.embeds![0].description).toContain("Hosted by someone · matched from the queue");
    expect(m.embeds![0].thumbnail).toBeUndefined();
  });

  it("never lets user text ping the server", () => {
    const m = roomLiveMessage({ ...ROOM, motion: "@everyone look at this **now**" }, HOST, null, ORIGIN);
    expect(m.content).toBe("🔴 **Live now:** @everyone look at this now");
    expect(m.allowed_mentions).toEqual({ parse: [] });
  });
});

describe("recordingReadyMessage", () => {
  it("links the past discussion with its run time", () => {
    const m = recordingReadyMessage(
      { ...ROOM, status: "ended", ended_at: "2026-09-11T16:31:00.000Z", recording_ended_at: "2026-09-11T16:31:05.000Z" },
      HOST,
      null,
      ORIGIN
    );
    expect(m.content).toBe("🎧 **Past discussion:** Voting should be mandatory");
    const e = m.embeds![0];
    expect(e.description).toContain("· 1 h 19 min");
    expect(e.description).toContain(
      "[Open the past discussion](https://agorasphere.net/replays/voting-should-be-mandatory-6c0ba6be)"
    );
    expect(e.color).toBe(0x2f7fe0);
    expect(e.timestamp).toBe("2026-09-11T16:31:05.000Z");
  });

  it("omits the run when an end is unknown", () => {
    const m = recordingReadyMessage({ ...ROOM, status: "ended" }, HOST, null, ORIGIN);
    expect(m.embeds![0].description).toBe(
      "Hosted by [Jordan Jaca](https://agorasphere.net/@jordan)\n**[Open the past discussion](https://agorasphere.net/replays/voting-should-be-mandatory-6c0ba6be)**"
    );
  });
});

describe("featuredPostMessage", () => {
  it("carries the title, an excerpt and the post link", () => {
    const m = featuredPostMessage(
      {
        id: "p1",
        title: "Welcome to the beta",
        body: "## Thanks for being here\n\nThree things to try this week:\n- open a room\n- post a thread",
        featured_at: "2026-09-11T10:00:00.000Z",
      },
      { username: "agorasphere", display_name: "AgoraSphere", avatar_url: null },
      ORIGIN
    );
    expect(m.content).toBe("📣 **From the AgoraSphere team:** Welcome to the beta");
    const e = m.embeds![0];
    expect(e.title).toBe("Welcome to the beta");
    expect(e.url).toBe("https://agorasphere.net/posts/p1");
    expect(e.description).toContain("Thanks for being here\nThree things to try this week:\nopen a room\npost a thread");
    expect(e.description).toContain(
      "Posted by [AgoraSphere](https://agorasphere.net/@agorasphere) · **[Read the post](https://agorasphere.net/posts/p1)**"
    );
    expect(e.timestamp).toBe("2026-09-11T10:00:00.000Z");
    expect(e.footer?.text).toBe("AgoraSphere beta · featured on the home page");
  });

  it("keeps a long body under Discord's limits", () => {
    const m = featuredPostMessage({ id: "p2", title: "Long", body: "word ".repeat(400) }, null, ORIGIN);
    expect(m.embeds![0].description!.length).toBeLessThan(700);
    expect(m.embeds![0].description).toContain("…");
  });
});
