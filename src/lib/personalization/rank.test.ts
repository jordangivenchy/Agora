import { describe, it, expect } from "vitest";
import { rankRecommendations, type Candidate } from "./rank";
import type { UserDataProfile } from "@/lib/dataPlatform/contract";

const profile = (topTopics: { topic: string; weight: number }[]): UserDataProfile => ({
  behavior: { top_topics: topTopics },
  argument_style: {},
  learning_style: {},
  positions_summary: {},
  highlights: [],
  signals_count: 10,
});

const cands: Candidate[] = [
  { id: "r1", type: "room", topicKey: "sports", baseScore: 0.5 },
  { id: "r2", type: "room", topicKey: "ethics", baseScore: 0.2 },
  { id: "r3", type: "room", topicKey: "economics", baseScore: 0.9 },
];

describe("rankRecommendations", () => {
  it("promotes topics the user engages with above raw popularity", () => {
    const rec = rankRecommendations(profile([{ topic: "ethics", weight: 100 }]), cands);
    expect((rec.ranked.room as string[])[0]).toBe("r2"); // ethics wins despite lowest baseScore
    expect(rec.rationale.r2).toMatch(/ethics/);
  });

  it("cold start (no profile) falls back to base score order", () => {
    const rec = rankRecommendations(null, cands);
    expect((rec.ranked.room as string[])[0]).toBe("r3"); // highest baseScore
    expect(rec.rationale.r3).toMatch(/popular|new/i);
  });

  it("empty-profile behaves like cold start", () => {
    const rec = rankRecommendations(profile([]), cands);
    expect((rec.ranked.room as string[])[0]).toBe("r3");
  });

  it("attaches a rationale to every candidate", () => {
    const rec = rankRecommendations(profile([{ topic: "economics", weight: 50 }]), cands);
    for (const c of cands) expect(rec.rationale[c.id]).toBeTruthy();
  });

  it("groups ranked ids by type", () => {
    const mixed: Candidate[] = [
      { id: "u1", type: "user", topicKey: null, baseScore: 0.3 },
      { id: "r1", type: "room", topicKey: "ethics", baseScore: 0.4 },
    ];
    const rec = rankRecommendations(profile([{ topic: "ethics", weight: 10 }]), mixed);
    expect(rec.ranked).toHaveProperty("user");
    expect(rec.ranked).toHaveProperty("room");
  });

  it("is deterministic on ties (stable id tie-break)", () => {
    const tie: Candidate[] = [
      { id: "b", type: "room", topicKey: null, baseScore: 0.5 },
      { id: "a", type: "room", topicKey: null, baseScore: 0.5 },
    ];
    expect(rankRecommendations(null, tie).ranked.room).toEqual(["a", "b"]);
  });
});
