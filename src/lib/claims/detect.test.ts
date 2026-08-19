import { describe, it, expect } from "vitest";
import { findClaimCandidates, scoreClaim, splitSentences, CLAIM_THRESHOLD } from "./detect";

describe("splitSentences", () => {
  it("splits spoken run-ons into sentences", () => {
    expect(
      splitSentences("The wall fell in 1989. Everyone knows that! Why do you disagree?")
    ).toHaveLength(3);
  });

  it("handles a single unpunctuated utterance", () => {
    expect(splitSentences("the minimum wage doubled since 2010")).toHaveLength(1);
  });
});

describe("scoreClaim", () => {
  it("flags statistical claims", () => {
    const c = scoreClaim("Unemployment fell to 3.5 percent in 2019");
    expect(c.score).toBeGreaterThanOrEqual(CLAIM_THRESHOLD);
    expect(c.signals).toContain("number");
    expect(c.signals).toContain("year");
  });

  it("flags study citations", () => {
    const c = scoreClaim("A Stanford study found that remote workers are 13 percent more productive");
    expect(c.score).toBeGreaterThanOrEqual(CLAIM_THRESHOLD);
    expect(c.signals).toContain("citation");
  });

  it("ignores questions", () => {
    expect(scoreClaim("What do you think happened to wages in 2008?").score).toBe(0);
  });

  it("discounts hedged opinions", () => {
    const opinion = scoreClaim("I think taxes are probably the biggest issue for most families");
    expect(opinion.score).toBeLessThan(CLAIM_THRESHOLD);
    expect(opinion.signals).toContain("opinion-hedge");
  });

  it("discounts personal anecdotes", () => {
    const c = scoreClaim("I went to Finland in 2018 and saw the pilot program");
    expect(c.signals).toContain("anecdote");
  });

  it("ignores short interjections", () => {
    expect(scoreClaim("That is false!").score).toBe(0);
  });
});

describe("findClaimCandidates", () => {
  it("extracts only the checkable sentence from mixed speech", () => {
    const found = findClaimCandidates(
      "Look, I hear you. But the Berlin Wall fell in 1985, that's just history. And I feel strongly we should learn from it."
    );
    expect(found).toHaveLength(1);
    expect(found[0].text).toContain("Berlin Wall");
  });

  it("returns strongest candidates first", () => {
    const found = findClaimCandidates(
      "Crime rose 40 percent since 2020 according to FBI data. Sweden has always banned nuclear power."
    );
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found[0].score).toBeGreaterThanOrEqual(found[1].score);
  });

  it("finds nothing in pure rhetoric", () => {
    expect(
      findClaimCandidates("My opponent keeps dodging. Answer the question honestly, please.")
    ).toHaveLength(0);
  });
});
