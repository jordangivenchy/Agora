import { describe, it, expect } from "vitest";
import { emptyProfile, mergePersona, normalizeProfile, parseDelta } from "./merge";

describe("normalizeProfile", () => {
  it("recovers from junk stored data", () => {
    expect(normalizeProfile(null)).toEqual(emptyProfile());
    expect(normalizeProfile("garbage")).toEqual(emptyProfile());
    expect(normalizeProfile({ styles: null, notes: "not-an-array" })).toEqual(emptyProfile());
  });
});

describe("mergePersona", () => {
  it("accumulates lifetime move counts", () => {
    const p1 = mergePersona(null, { moves: { cites_evidence: 2 }, utterances: 4 });
    const p2 = mergePersona(p1, { moves: { cites_evidence: 3 }, utterances: 5 });
    expect(p2.counts.cites_evidence).toBe(5);
  });

  it("seeds style ratios from the first batch", () => {
    const p = mergePersona(null, { moves: { cites_evidence: 2, anecdote: 4 }, utterances: 4 });
    expect(p.styles.evidence_driven).toBe(0.5);
    expect(p.styles.anecdotal).toBe(1); // capped at 1
  });

  it("decays style ratios toward new behavior", () => {
    // Heavy anecdote history, then an all-evidence batch.
    let p = mergePersona(null, { moves: { anecdote: 10 }, utterances: 10 });
    expect(p.styles.anecdotal).toBe(1);
    p = mergePersona(p, { moves: { cites_evidence: 10 }, utterances: 10 });
    expect(p.styles.anecdotal).toBeLessThan(1);
    expect(p.styles.anecdotal).toBeGreaterThan(0.7); // drifts, doesn't snap
    expect(p.styles.evidence_driven).toBeGreaterThan(0);
  });

  it("caps notes and keeps newest first", () => {
    let p = emptyProfile();
    for (let i = 1; i <= 15; i++) {
      p = mergePersona(p, { moves: {}, utterances: 1, note: `note ${i}` });
    }
    expect(p.notes).toHaveLength(12);
    expect(p.notes[0]).toBe("note 15");
  });

  it("tracks topic exposure", () => {
    const p = mergePersona(null, { moves: {}, utterances: 6, topicKey: "economics" });
    expect(p.topics.economics).toBe(6);
  });
});

describe("parseDelta", () => {
  it("parses a well-formed analyzer reply", () => {
    const d = parseDelta('{"moves":{"cites_evidence":2,"anecdote":1},"note":"Leans on statistics."}', 5, "economics");
    expect(d).not.toBeNull();
    expect(d!.moves.cites_evidence).toBe(2);
    expect(d!.note).toBe("Leans on statistics.");
    expect(d!.topicKey).toBe("economics");
  });

  it("rejects non-JSON and shapeless replies", () => {
    expect(parseDelta("I observed lots of evidence use!", 5, null)).toBeNull();
    expect(parseDelta('{"observations": []}', 5, null)).toBeNull();
  });

  it("caps hallucinated counts and drops junk keys", () => {
    const d = parseDelta('{"moves":{"cites_evidence":9000,"DROP TABLE": 3,"x":-5}}', 4, null);
    expect(d!.moves.cites_evidence).toBe(12); // utterances * 3
    expect(Object.keys(d!.moves)).toEqual(["cites_evidence"]);
  });
});
