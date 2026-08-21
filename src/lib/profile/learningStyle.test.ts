import { describe, it, expect } from "vitest";
import { deriveLearningStyle } from "./learningStyle";

describe("deriveLearningStyle", () => {
  it("returns all five dimensions with neutral defaults for no input", () => {
    const ls = deriveLearningStyle(null);
    expect(Object.keys(ls).sort()).toEqual([
      "concrete_vs_abstract",
      "evidence_grounding",
      "inquiry_seeking",
      "revises_under_challenge",
      "structured_reasoning",
    ]);
    // neutral 0.5 → leans "high" branch, but score stays 0.5
    expect(ls.evidence_grounding.score).toBe(0.5);
  });

  it("reflects a strongly evidence-driven debater", () => {
    const ls = deriveLearningStyle({ styles: { evidence_driven: 0.95 } });
    expect(ls.evidence_grounding.score).toBe(0.95);
    expect(ls.evidence_grounding.explanation).toMatch(/evidence/i);
    expect(ls.evidence_grounding.growth).toBeTruthy();
  });

  it("maps anecdotal vs structured onto the concrete/abstract axis", () => {
    const concrete = deriveLearningStyle({ styles: { anecdotal: 0.9, logical_structure: 0.1 } });
    const abstract = deriveLearningStyle({ styles: { anecdotal: 0.1, logical_structure: 0.9 } });
    expect(concrete.concrete_vs_abstract.score).toBeGreaterThan(abstract.concrete_vs_abstract.score);
  });

  it("every dimension carries a strengths-first explanation and a growth step", () => {
    const ls = deriveLearningStyle({ styles: { questioning: 0.8, logical_structure: 0.6 } });
    for (const d of Object.values(ls)) {
      expect(d.explanation.length).toBeGreaterThan(10);
      expect(d.growth.length).toBeGreaterThan(10);
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(1);
    }
  });

  it("clamps out-of-range style inputs", () => {
    const ls = deriveLearningStyle({ styles: { evidence_driven: 5, questioning: -3 } });
    expect(ls.evidence_grounding.score).toBe(1);
    expect(ls.inquiry_seeking.score).toBe(0);
  });
});
