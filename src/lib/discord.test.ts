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
  timeChip,
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
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

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

  it("makes Discord time chips, and none from nothing", () => {
    expect(timeChip("2026-09-11T15:12:00.000Z", "R")).toBe(`<t:${unix("2026-09-11T15:12:00.000Z")}:R>`);
    expect(timeChip(null, "t")).toBeNull();
    expect(timeChip("not a date", "f")).toBeNull();
  });
});

describe("roomLiveMessage", () => {
  it("is one embed shaped like a status card, pings nobody", () => {
    const m = roomLiveMessage(ROOM, HOST, { name: "Politics club" }, ORIGIN);
    expect(m.content).toBeUndefined();
    expect(m.embeds).toHaveLength(1);
    expect(m.username).toBe("AgoraSphere");
    expect(m.avatar_url).toBe(`${ORIGIN}/mark-512.png`);
    expect(m.allowed_mentions).toEqual({ parse: [] });
    const e = m.embeds![0];
    const t = unix(ROOM.started_at);
    expect(e.title).toBe("Voting should be mandatory");
    expect(e.url).toBe("https://agorasphere.net/agora/voting-should-be-mandatory-6c0ba6be");
    expect(e.color).toBe(0xffb700);
    expect(e.description).toBe(
      [
        "Tap the title or **[Join the room](https://agorasphere.net/agora/voting-should-be-mandatory-6c0ba6be)** to take a seat in the audience.",
        "",
        `**Live** since <t:${t}:t> (<t:${t}:R>)`,
        " └ · Host: **[Jordan Jaca](https://agorasphere.net/@jordan)**",
        " └ · Community: **Politics club**",
        "",
        "*Raise a hand in the room if you want the floor.*",
      ].join("\n")
    );
    expect(e.footer?.text).toBe("Public rooms only, the moment they open • AgoraSphere beta");
    expect(e.thumbnail).toEqual({ url: "https://agorasphere.net/mark-512.png" });
  });

  it("marks a queue match and survives a nameless host with no start time", () => {
    const m = roomLiveMessage({ ...ROOM, pro_size: 1, con_size: 1, motion: null, started_at: null }, null, null, ORIGIN);
    const e = m.embeds![0];
    expect(e.title).toBe("Untitled room");
    expect(e.description).toContain("**Live** now\n └ · Host: **someone**\n └ · **1 v 1**, matched from the queue");
    expect(e.description).not.toContain("Community");
  });

  it("never lets user text ping the server or break the markdown", () => {
    const m = roomLiveMessage({ ...ROOM, motion: "@everyone look at this **now**" }, HOST, { name: "a*b" }, ORIGIN);
    expect(m.content).toBeUndefined();
    expect(m.embeds![0].title).toBe("@everyone look at this now");
    expect(m.embeds![0].description).toContain("Community: **a\\*b**");
    expect(m.allowed_mentions).toEqual({ parse: [] });
  });
});

describe("recordingReadyMessage", () => {
  it("links the past discussion with its run time and when it was held", () => {
    const ended = "2026-09-11T16:31:00.000Z";
    const done = "2026-09-11T16:31:05.000Z";
    const m = recordingReadyMessage({ ...ROOM, status: "ended", ended_at: ended, recording_ended_at: done }, HOST, null, ORIGIN);
    const e = m.embeds![0];
    expect(m.content).toBeUndefined();
    expect(e.title).toBe("Voting should be mandatory");
    expect(e.url).toBe("https://agorasphere.net/replays/voting-should-be-mandatory-6c0ba6be");
    expect(e.color).toBe(0x2f7fe0);
    expect(e.description).toBe(
      [
        "Tap the title or **[Open the past discussion](https://agorasphere.net/replays/voting-should-be-mandatory-6c0ba6be)** to watch it back.",
        "",
        `**Recorded** <t:${unix(done)}:R> · \`1 h 19 min\``,
        " └ · Host: **[Jordan Jaca](https://agorasphere.net/@jordan)**",
        ` └ · Held <t:${unix(ROOM.started_at)}:f>`,
        "",
        "*Comments are open under the recording.*",
      ].join("\n")
    );
    expect(e.footer?.text).toBe("Recordings land here as they finish • AgoraSphere beta");
    expect(e.thumbnail).toEqual({ url: "https://agorasphere.net/mark-512.png" });
  });

  it("omits the run and the chips when the times are unknown", () => {
    const m = recordingReadyMessage({ ...ROOM, status: "ended", started_at: null }, HOST, null, ORIGIN);
    expect(m.embeds![0].description).toContain("**Recorded**\n └ · Host:");
    expect(m.embeds![0].description).not.toContain("Held");
    expect(m.embeds![0].description).not.toContain("`");
  });
});

describe("featuredPostMessage", () => {
  it("quotes an excerpt and links the post", () => {
    const featured = "2026-09-11T10:00:00.000Z";
    const m = featuredPostMessage(
      {
        id: "p1",
        title: "Welcome to the beta",
        body: "## Thanks for being here\n\nThree things to try this week:\n- open a room\n- post a thread",
        featured_at: featured,
      },
      { username: "agorasphere", display_name: "AgoraSphere", avatar_url: null },
      ORIGIN
    );
    const e = m.embeds![0];
    expect(m.content).toBeUndefined();
    expect(e.title).toBe("Welcome to the beta");
    expect(e.url).toBe("https://agorasphere.net/posts/p1");
    expect(e.description).toBe(
      [
        "Tap the title or **[Read the post](https://agorasphere.net/posts/p1)** for the whole thing.",
        "",
        "> Thanks for being here",
        "> Three things to try this week:",
        "> open a room",
        "> post a thread",
        "",
        `**Featured** <t:${unix(featured)}:R> · by **[AgoraSphere](https://agorasphere.net/@agorasphere)**`,
        "*On the home page for the next two weeks.*",
      ].join("\n")
    );
    expect(e.footer?.text).toBe("Featured on the home page by the team • AgoraSphere beta");
    expect(e.thumbnail).toEqual({ url: "https://agorasphere.net/mark-512.png" });
  });

  it("keeps a long body under Discord's limits and copes with no body", () => {
    const long = featuredPostMessage({ id: "p2", title: "Long", body: "word ".repeat(400) }, null, ORIGIN);
    expect(long.embeds![0].description!.length).toBeLessThan(800);
    expect(long.embeds![0].description).toContain("…");
    const bare = featuredPostMessage({ id: "p3", title: null, body: null }, null, ORIGIN);
    expect(bare.embeds![0].title).toBe("A post from the team");
    expect(bare.embeds![0].description).not.toContain(">");
    expect(bare.embeds![0].description).toContain("**Featured** · by **someone**");
  });
});
