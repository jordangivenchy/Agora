import { describe, it, expect } from "vitest";
import { motionProblem, motionOk, parseMotions, storyKey, motionRequest, MOTION_SHAPES } from "./motions";

/* The four motions that have ever come from a headline on AgoraSphere,
   stored verbatim as the question. None of them has a side to take. */
const REAL_HEADLINES = [
  "Energy secretary says US might not reach nuclear agreement with Iran",
  "First Thing: Duane Keith Davis found guilty of 1996 murder of Tupac Shakur",
];

describe("motionProblem", () => {
  it("turns away the headlines that got stored as questions", () => {
    for (const h of REAL_HEADLINES) expect(motionProblem(h)).not.toBeNull();
  });
  it("passes the curated topics already in the database", () => {
    for (const q of [
      "Should college be tuition-free?",
      "Should the U.S. have open borders?",
      "Is renting better than owning a home?",
      "Will AI destroy more jobs than it creates by 2030?",
    ]) {
      expect(motionProblem(q)).toBeNull();
    }
  });
  it("names the newsletter prefix rather than the question mark", () => {
    expect(motionProblem("First Thing: Should the US leave NATO?")).toMatch(/First Thing/);
  });
  it("asks for a question when given a statement", () => {
    expect(motionProblem("The EU should fine carriers")).toMatch(/question/i);
  });
  it("asks for an opener when the question can't be answered yes or no", () => {
    expect(motionProblem("What should happen to the tariffs?")).toMatch(/Should, Is, Will or Does/);
  });
  it("holds the database's own limits", () => {
    expect(motionProblem("Hi?")).not.toBeNull();
    expect(motionProblem(`Should ${"x".repeat(220)}?`)).toMatch(/200/);
  });
  it("ignores stray whitespace", () => {
    expect(motionOk("  Should   jury duty be optional?  ")).toBe(true);
  });
});

describe("parseMotions", () => {
  const good = JSON.stringify([
    { shape: "policy", text: "Should frontier AI labs need a licence to train new models?" },
    { shape: "judgment", text: "Is the alarm about AI doing more damage than AI is?" },
    { shape: "prediction", text: "Will AI destroy more jobs than it creates by 2030?" },
    { shape: "priority", text: "Does AI's effect on wages matter more than extinction risk?" },
  ]);

  it("reads four shapes", () => {
    const got = parseMotions(good);
    expect(got.map((m) => m.shape)).toEqual(MOTION_SHAPES.map((s) => s.key));
  });
  it("survives a code fence and a sentence around it", () => {
    expect(parseMotions("Here you go:\n```json\n" + good + "\n```\nHope that helps.")).toHaveLength(4);
  });
  it("drops anything that wouldn't pass as a typed question", () => {
    const mixed = JSON.stringify([
      { shape: "policy", text: "Should the EU fine carriers that overbook?" },
      { shape: "judgment", text: "Duane Davis was found guilty." },
      { shape: "prediction", text: "" },
    ]);
    expect(parseMotions(mixed)).toEqual([
      { shape: "policy", text: "Should the EU fine carriers that overbook?" },
    ]);
  });
  it("keeps one of each shape and no repeats", () => {
    const dupes = JSON.stringify([
      { shape: "policy", text: "Should the EU fine carriers that overbook?" },
      { shape: "policy", text: "Should the EU ban overbooking outright?" },
      { shape: "judgment", text: "should the eu fine carriers that overbook?" },
    ]);
    expect(parseMotions(dupes)).toHaveLength(1);
  });
  it("takes an empty list for a story with no argument in it", () => {
    expect(parseMotions("[]")).toEqual([]);
  });
  it("is unbothered by nonsense", () => {
    for (const junk of ["", "no.", "{}", "[1,2,3]", '[{"shape":"nope","text":"Should it?"}]']) {
      expect(parseMotions(junk)).toEqual([]);
    }
  });
});

describe("storyKey", () => {
  it("is the same for the same story told twice", () => {
    expect(storyKey("Senate passes the tariff bill")).toBe(storyKey("The Senate passes a tariff bill"));
  });
  it("ignores wording that carries no meaning", () => {
    expect(storyKey("Tariff bill passes Senate")).toBe(storyKey("Senate: tariff bill passes"));
  });
  it("separates different stories", () => {
    expect(storyKey("Senate passes the tariff bill")).not.toBe(storyKey("Senate rejects the climate bill"));
  });
  it("answers for a headline with nothing but stop words", () => {
    expect(storyKey("It is what it is")).toHaveLength(32);
  });
});

describe("motionRequest", () => {
  it("carries the summary and section when there are any", () => {
    const q = motionRequest({ headline: "Tariffs rise", summary: "Ten per cent on imports.", category: "business" });
    expect(q).toContain("Headline: Tariffs rise");
    expect(q).toContain("Summary: Ten per cent on imports.");
    expect(q).toContain("Section: business");
  });
  it("leaves out what the story doesn't have", () => {
    expect(motionRequest({ headline: "Tariffs rise", summary: null })).toBe("Headline: Tariffs rise");
  });
});
