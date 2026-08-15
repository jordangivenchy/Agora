import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  formatUserContext,
  responseCacheKey,
  AGORA_PERSONA,
} from "./systemPrompt";

const evidenceItem = {
  id: "e1",
  title: "Minimum wage study 2025",
  body: "Findings...",
  source: "NBER",
  url: null,
  published_at: "2025-11-02T00:00:00Z",
};

describe("buildSystemPrompt", () => {
  it("is just the persona when there is no context", () => {
    expect(buildSystemPrompt({ evidence: [], userContext: null })).toBe(AGORA_PERSONA);
  });

  it("keeps the persona first so provider prompt caching gets a stable prefix", () => {
    const prompt = buildSystemPrompt({
      evidence: [evidenceItem],
      userContext: { traits: { debate_experience: "novice" }, overrides: {} },
    });
    expect(prompt.startsWith(AGORA_PERSONA)).toBe(true);
    expect(prompt).toContain("EVIDENCE");
    expect(prompt).toContain("NBER");
    expect(prompt).toContain("USER CONTEXT");
  });
});

describe("formatUserContext", () => {
  it("drops traits outside the allowlist (no PII forwarded to the model)", () => {
    const out = formatUserContext({
      traits: {
        debate_experience: "expert",
        $ip: "1.2.3.4",
        email: "user@example.com",
        $browser: "Chrome",
      },
      overrides: {},
    });
    expect(out).toContain("debate experience");
    expect(out).not.toContain("1.2.3.4");
    expect(out).not.toContain("user@example.com");
    expect(out).not.toContain("Chrome");
  });

  it("lets explicit overrides beat inferred traits", () => {
    const out = formatUserContext({
      traits: { preferred_answer_style: "technical" },
      overrides: { preferred_answer_style: "simple" },
    });
    expect(out).toContain('"simple"');
    expect(out).not.toContain('"technical"');
  });

  it("is empty when nothing allowlisted survives", () => {
    expect(formatUserContext({ traits: { $device_id: "abc" }, overrides: {} })).toBe("");
  });
});

describe("responseCacheKey", () => {
  it("normalizes whitespace and case so retyped questions share a key", () => {
    const a = responseCacheKey({ question: "Is that TRUE?", motion: "M", evidenceIds: ["1"] });
    const b = responseCacheKey({ question: "  is that true?  ", motion: "m", evidenceIds: ["1"] });
    expect(a).toBe(b);
  });

  it("is order-insensitive over evidence ids", () => {
    const a = responseCacheKey({ question: "q", motion: "m", evidenceIds: ["a", "b"] });
    const b = responseCacheKey({ question: "q", motion: "m", evidenceIds: ["b", "a"] });
    expect(a).toBe(b);
  });

  it("changes when the evidence set changes (stale answers never served)", () => {
    const a = responseCacheKey({ question: "q", motion: "m", evidenceIds: ["a"] });
    const b = responseCacheKey({ question: "q", motion: "m", evidenceIds: ["a", "c"] });
    expect(a).not.toBe(b);
  });

  it("changes across motions", () => {
    const a = responseCacheKey({ question: "q", motion: "motion one", evidenceIds: [] });
    const b = responseCacheKey({ question: "q", motion: "motion two", evidenceIds: [] });
    expect(a).not.toBe(b);
  });
});
