import { describe, it, expect } from "vitest";
import { extractWake } from "./wakeWord";

describe("extractWake — hey agora", () => {
  it("captures the question after 'hey agora' anywhere", () => {
    expect(extractWake("so anyway hey Agora what year did the wall fall")).toEqual({
      kind: "question",
      question: "what year did the wall fall",
    });
  });

  it("tolerates comma and punctuation variants", () => {
    expect(extractWake("Hey, Agora! Is nuclear cheaper than solar?")).toEqual({
      kind: "question",
      question: "Is nuclear cheaper than solar?",
    });
  });

  it("bare 'hey agora' with nothing after opens the panel", () => {
    expect(extractWake("hey agora")).toEqual({ kind: "open" });
  });
});

describe("extractWake — bare agora", () => {
  it("triggers when utterance-initial and ask-shaped", () => {
    expect(extractWake("Agora, what's the GDP of France?")).toEqual({
      kind: "question",
      question: "what's the GDP of France?",
    });
    expect(extractWake("agora check that claim")).toEqual({
      kind: "question",
      question: "check that claim",
    });
    expect(extractWake("Agora fact check him")).toEqual({
      kind: "question",
      question: "fact check him",
    });
  });

  it("wake word alone opens the panel", () => {
    expect(extractWake("Agora?")).toEqual({ kind: "open" });
  });

  it("ignores mid-sentence platform mentions", () => {
    expect(extractWake("we're live here on Agora tonight")).toBeNull();
    expect(extractWake("I joined Agora what a week ago")).toBeNull();
  });

  it("ignores sentences ABOUT Agora", () => {
    expect(extractWake("Agora is a great place to debate")).toBeNull();
    expect(extractWake("Agora has thousands of users")).toBeNull();
    expect(extractWake("Agora launched last year")).toBeNull();
  });

  it("ignores plain speech without the wake word", () => {
    expect(extractWake("the minimum wage doubled since 2010")).toBeNull();
  });
});
