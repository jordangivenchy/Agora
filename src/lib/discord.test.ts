import { describe, it, expect, afterEach } from "vitest";
import {
  betaKeyEmbed,
  clip,
  deployMessage,
  digestMessage,
  discordConfigured,
  discordWebhook,
  escapeMd,
  featuredPostMessage,
  plainText,
  recordingReadyMessage,
  roomCardMessage,
  roomLiveMessage,
  roomPhase,
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
const TILE = { url: "https://agorasphere.net/mark-512.png" };

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

describe("roomPhase", () => {
  it("reads the room's state", () => {
    expect(roomPhase(ROOM)).toBe("live");
    expect(roomPhase({ ...ROOM, status: "ended" })).toBe("ended");
    expect(roomPhase({ ...ROOM, status: "ended", recording_url: "https://r/x.m3u8", recording_ended_at: "2026-09-11T16:31:05.000Z" })).toBe("recorded");
    expect(roomPhase({ ...ROOM, status: "ended", recording_url: "https://r/x.m3u8", recording_ended_at: null })).toBe("ended");
    expect(roomPhase({ ...ROOM, status: "scheduled", scheduled_start: "2026-09-12T18:00:00.000Z" })).toBe("scheduled");
    expect(roomPhase({ ...ROOM, status: "created", scheduled_start: "2026-09-12T18:00:00.000Z" })).toBe("scheduled");
    expect(roomPhase({ ...ROOM, status: "cancelled" })).toBe("cancelled");
    expect(roomPhase({ ...ROOM, status: "created" })).toBeNull();
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
    expect(e.thumbnail).toEqual(TILE);
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

describe("roomCardMessage", () => {
  const url = "https://agorasphere.net/agora/voting-should-be-mandatory-6c0ba6be";

  it("is the live card for a live room and nothing for a bare lobby", () => {
    expect(roomCardMessage(ROOM, HOST, null, ORIGIN)).toEqual(roomLiveMessage(ROOM, HOST, null, ORIGIN));
    expect(roomCardMessage({ ...ROOM, status: "created" }, HOST, null, ORIGIN)).toBeNull();
  });

  it("announces a scheduled room in grey with when", () => {
    const when = "2026-09-12T18:00:00.000Z";
    const e = roomCardMessage({ ...ROOM, status: "scheduled", scheduled_start: when }, HOST, { name: "Politics club" }, ORIGIN)!.embeds![0];
    expect(e.color).toBe(0x4e5058);
    expect(e.url).toBe(url);
    expect(e.description).toBe(
      [
        `Tap the title or **[Open the room](${url})** to be there when it starts.`,
        "",
        `**Scheduled** for <t:${unix(when)}:f> (<t:${unix(when)}:R>)`,
        " └ · Host: **[Jordan Jaca](https://agorasphere.net/@jordan)**",
        " └ · Community: **Politics club**",
        "",
        "*This card changes when the room goes live.*",
      ].join("\n")
    );
    expect(e.footer?.text).toBe("Public rooms only • AgoraSphere beta");
  });

  it("closes the card when the room ends, saying whether a recording is coming", () => {
    const ended = "2026-09-11T16:31:00.000Z";
    const withRec = roomCardMessage({ ...ROOM, status: "ended", ended_at: ended, recording_url: "https://r/x.m3u8" }, HOST, null, ORIGIN)!.embeds![0];
    expect(withRec.description).toContain(`**Ended** <t:${unix(ended)}:R> · \`1 h 19 min\``);
    expect(withRec.description).toContain("*The recording lands here when it's ready.*");
    const none = roomCardMessage({ ...ROOM, status: "ended", ended_at: ended }, HOST, null, ORIGIN)!.embeds![0];
    expect(none.description).toContain("*No recording for this one.*");
    expect(none.color).toBe(0x4e5058);
  });

  it("becomes the recording card once the recording is in", () => {
    const room = { ...ROOM, status: "ended", ended_at: "2026-09-11T16:31:00.000Z", recording_url: "https://r/x.m3u8", recording_ended_at: "2026-09-11T16:31:05.000Z" };
    expect(roomCardMessage(room, HOST, null, ORIGIN)).toEqual(recordingReadyMessage(room, HOST, null, ORIGIN));
  });

  it("says so when a room is cancelled", () => {
    const e = roomCardMessage({ ...ROOM, status: "cancelled" }, HOST, null, ORIGIN)!.embeds![0];
    expect(e.description).toBe(
      "**Cancelled** before it started.\n └ · Host: **[Jordan Jaca](https://agorasphere.net/@jordan)**\n\n*Keep an eye on this channel for the next one.*"
    );
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
    expect(e.thumbnail).toEqual(TILE);
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
    expect(e.thumbnail).toEqual(TILE);
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

describe("deployMessage", () => {
  it("names the build by its first commit line and short sha", () => {
    const at = "2026-09-12T01:00:00.000Z";
    const e = deployMessage({ sha: "f8d2e6f0123456789", message: "Discord: cards in the shape of a status card\n\nLong body here", author: "Jordan Jaca", at }, ORIGIN).embeds![0];
    expect(e.title).toBe("A new build is live");
    expect(e.url).toBe(ORIGIN);
    expect(e.description).toBe(
      [
        "Tap the title to open the site. A hard refresh gets you the new build.",
        "",
        `**Deployed** <t:${unix(at)}:R>`,
        " └ · Discord: cards in the shape of a status card",
        " └ · `f8d2e6f` · Jordan Jaca",
        "",
        "*If something you reported is in there, try it again and say so on the post.*",
      ].join("\n")
    );
    expect(e.footer?.text).toBe("Every production deploy • AgoraSphere beta");
  });

  it("copes with a deploy that carries no commit", () => {
    const e = deployMessage({ sha: null, message: null }, ORIGIN).embeds![0];
    expect(e.description).toContain("**Deployed**\n └ · A new build\n\n");
  });
});

describe("digestMessage", () => {
  const item = (kind: "bug" | "feedback", title: string, tags: string[] = []) => ({
    kind,
    title,
    url: `https://discord.com/channels/1/${title.length}`,
    author: "red",
    createdAt: "2026-09-12T01:00:00.000Z",
    tags,
  });

  it("is nothing when nothing happened", () => {
    expect(digestMessage([], ORIGIN)).toBeNull();
  });

  it("counts and lists bugs then feedback, with authors and tags", () => {
    const e = digestMessage([item("bug", "Mic stays muted", ["Calls", "Phone"]), item("feedback", "Queue copy is confusing"), item("bug", "Second bug")], ORIGIN)!.embeds![0];
    expect(e.title).toBe("Since yesterday in bugs and feedback");
    expect(e.description).toBe(
      [
        "**2 new bugs** · **1 new feedback post**",
        "",
        "**Bugs**",
        " └ · [Mic stays muted](https://discord.com/channels/1/15) · red · Calls, Phone",
        " └ · [Second bug](https://discord.com/channels/1/10) · red",
        "",
        "**Feedback**",
        " └ · [Queue copy is confusing](https://discord.com/channels/1/23) · red",
        "",
        "*Tag each bug as you go: Confirmed, In progress, Fixed, Can't reproduce or By design.*",
      ].join("\n")
    );
    expect(e.footer?.text).toBe("Every morning, for the team • AgoraSphere beta");
  });

  it("caps a busy day at ten per group", () => {
    const many = Array.from({ length: 13 }, (_, i) => item("bug", `Bug ${i}`));
    const e = digestMessage(many, ORIGIN)!.embeds![0];
    expect(e.description).toContain(" └ · and 3 more");
    expect(e.description).not.toContain("Feedback");
  });
});

describe("betaKeyEmbed", () => {
  it("hands over a one-time key in a code block, with how many are left", () => {
    const e = betaKeyEmbed({ kind: "key", key: "AGORA-7K2M-Q9XD", used: 0, total: 3 }, ORIGIN);
    expect(e.title).toBe("Your beta key");
    expect(e.url).toBe("https://agorasphere.net/beta");
    expect(e.description).toBe(
      [
        "Go to **[agorasphere.net/beta](https://agorasphere.net/beta)** and enter:",
        "```",
        "AGORA-7K2M-Q9XD",
        "```",
        " └ · One use, on one device. It stops working after that, and after 48 hours unused.",
        " └ · Another device later? Press the button again. **2 more** after this one.",
        "",
        "*Only you can see this message.*",
      ].join("\n")
    );
    expect(e.thumbnail).toEqual(TILE);
    expect(e.footer?.text).toBe("Yours alone, from this server • AgoraSphere beta");
  });

  it("says when this is the last one, and when there are none", () => {
    expect(betaKeyEmbed({ kind: "key", key: "AGORA-7K2M-Q9XD", used: 2, total: 3 }, ORIGIN).description).toContain(" └ · This is your last one. Ask in #general if you need more.");
    const none = betaKeyEmbed({ kind: "none-left", total: 3 }, ORIGIN);
    expect(none.title).toBe("No keys left");
    expect(none.description).toContain("You have used all **3** of yours, one per device.");
  });

  it("has words for a revoked tester, a closed desk, and an open door", () => {
    expect(betaKeyEmbed({ kind: "revoked" }, ORIGIN).title).toBe("No key for you right now");
    expect(betaKeyEmbed({ kind: "unavailable" }, ORIGIN).title).toBe("The key desk is closed");
    const open = betaKeyEmbed({ kind: "open" }, ORIGIN);
    expect(open.title).toBe("The door is open");
    expect(open.description).toContain("No key is needed right now");
  });
});

describe("digestMessage with keys", () => {
  it("adds the key line, and posts for keys alone", () => {
    const e = digestMessage([], ORIGIN, { minted: 4, redeemed: 3, testers: 12 })!.embeds![0];
    expect(e.description).toContain("**0 new bugs** · **0 new feedback posts**\n**3 keys used** · **4 handed out** · **12** testers in so far");
    expect(digestMessage([], ORIGIN, { minted: 0, redeemed: 0, testers: 12 })).toBeNull();
  });
});
