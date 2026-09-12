import { describe, it, expect } from "vitest";
import { FRAME_MAX_LINES, frameIsEmpty, frameLength, frameLines, frameNewsKey, framePeople } from "./frameModel";
import type { StageParticipant } from "./stage";

const person = (id: string, username: string, extra: Partial<StageParticipant> = {}): StageParticipant =>
  ({
    id: `row-${id}`,
    room_id: "r1",
    user_id: id,
    role: "spectator",
    stance: null,
    left_at: null,
    user: { username, display_name: username.toUpperCase(), avatar_url: null },
    ...extra,
  }) as unknown as StageParticipant;

const ROOM = {
  host_id: "h",
  framing: {
    about: "Should voting be mandatory?",
    about_at: "2026-09-12T02:00:00.000Z",
    stances: {
      h: { text: "Yes, with a none-of-the-above box.", at: "2026-09-12T02:01:00.000Z" },
      d1: { text: "No. Compulsion cheapens the vote.", at: "2026-09-12T02:02:00.000Z" },
      gone: { text: "I left", at: "2026-09-12T02:03:00.000Z" },
    },
  },
};

describe("framePeople", () => {
  it("lists the stage, host first, with each person's line, and drops the audience and the departed", () => {
    const people = framePeople(
      [
        person("d1", "dana", { role: "debater", stance: "CON" }),
        person("a1", "aud"),
        person("h", "host"),
        person("c1", "co", { stage_role: "cohost" }),
      ],
      ROOM,
      { id: "a1", role: "audience" }
    );
    expect(people.map((p) => `${p.role}:${p.name}`)).toEqual(["host:HOST", "cohost:CO", "speaker:DANA"]);
    expect(people[0].stance?.text).toBe("Yes, with a none-of-the-above box.");
    expect(people[1].stance).toBeNull();
    expect(people[2].stance?.text).toBe("No. Compulsion cheapens the vote.");
    expect(people.some((p) => p.id === "gone")).toBe(false);
  });

  it("adds me when I hold a stage role without a seat yet", () => {
    const people = framePeople([person("d1", "dana", { role: "debater" })], ROOM, { id: "h", role: "host" });
    expect(people.map((p) => `${p.role}:${p.name}`)).toEqual(["host:You", "speaker:DANA"]);
    expect(people[0].stance?.text).toContain("none-of-the-above");
  });
});

describe("frameNewsKey and frameIsEmpty", () => {
  it("changes when the frame or a stance changes, and knows an empty frame", () => {
    const k1 = frameNewsKey(ROOM.framing);
    const k2 = frameNewsKey({ ...ROOM.framing, about_at: "2026-09-12T03:00:00.000Z" });
    const k3 = frameNewsKey({ ...ROOM.framing, stances: { ...ROOM.framing.stances, d1: { text: "changed", at: "2026-09-12T04:00:00.000Z" } } });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
    expect(frameNewsKey(null)).toBe("|");
    expect(frameIsEmpty(null)).toBe(true);
    expect(frameIsEmpty({ about: "  " })).toBe(true);
    expect(frameIsEmpty({ about: "x" })).toBe(false);
    expect(frameIsEmpty({ stances: { h: { text: "y", at: "t" } } })).toBe(false);
  });
});

describe("frameLength", () => {
  it("counts a move down a line once, whether the editor wrote one newline or two", () => {
    expect(frameLength("abc")).toBe(3);
    expect(frameLength("ab\ncd")).toBe(5);
    expect(frameLength("ab\n\ncd")).toBe(5);
    expect(frameLength("ab\n\n\n\ncd")).toBe(5);
    expect(frameLength("- one\n- two")).toBe(11);
    expect(frameLength("")).toBe(0);
  });
});

describe("frameLines", () => {
  it("counts the lines on screen, blank ones and bullets included", () => {
    expect(frameLines("")).toBe(0);
    expect(frameLines("one line")).toBe(1);
    expect(frameLines("a\nb")).toBe(2);
    expect(frameLines("a\n\nb")).toBe(3);
    expect(frameLines("- one\n- two\n- three")).toBe(3);
    expect(frameLines(Array.from({ length: FRAME_MAX_LINES + 1 }, (_, i) => `l${i}`).join("\n"))).toBe(FRAME_MAX_LINES + 1);
  });
});
