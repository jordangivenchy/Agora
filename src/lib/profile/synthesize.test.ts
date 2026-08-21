import { describe, it, expect } from "vitest";
import { synthesizeBehavior, synthesizeProfile } from "./synthesize";
import type { UserSignal, DebatePosition } from "@/lib/dataPlatform/contract";

const sig = (kind: string, topic: string, subjectType = "room", value?: number): UserSignal => ({
  kind, topicKey: topic, subjectType, subjectId: "x", value,
});

describe("synthesizeBehavior", () => {
  it("ranks topics by weighted engagement, not raw counts", () => {
    const b = synthesizeBehavior([
      sig("view", "sports"),
      sig("view", "sports"),
      sig("like", "ethics"), // like weighs 4 → ethics outranks two sports views
    ]);
    expect(b.top_topics[0].topic).toBe("ethics");
  });

  it("computes content-type preference shares", () => {
    const b = synthesizeBehavior([sig("view", "a", "room"), sig("view", "b", "clip"), sig("view", "c", "clip")]);
    expect(b.content_preferences.clip).toBeCloseTo(0.67, 1);
  });

  it("handles an empty log", () => {
    const b = synthesizeBehavior([]);
    expect(b.top_topics).toEqual([]);
    expect(b.engagement_events).toBe(0);
  });
});

describe("synthesizeProfile", () => {
  const positions: DebatePosition[] = [
    { topicKey: "economics", motion: "m", stance: "PRO", summary: "argued for X", evidenceUtteranceIds: [], confidence: 0.8 },
  ];

  it("produces a complete, user-facing profile", () => {
    const p = synthesizeProfile({
      signals: [sig("watch", "economics", "room", 60), sig("like", "economics")],
      argumentStyle: { styles: { evidence_driven: 0.8, logical_structure: 0.7, questioning: 0.2, anecdotal: 0.1 } },
      positions,
    });
    expect(p.signals_count).toBe(2);
    expect(Object.keys(p.learning_style)).toContain("evidence_grounding");
    expect(p.highlights.length).toBeGreaterThan(0);
    expect(p.positions_summary).toHaveProperty("economics");
  });

  it("degrades gracefully with no data", () => {
    const p = synthesizeProfile({ signals: [], argumentStyle: null, positions: [] });
    expect(p.signals_count).toBe(0);
    // learning style still present (neutral), profile never empty
    expect(Object.keys(p.learning_style).length).toBeGreaterThan(0);
  });
});
