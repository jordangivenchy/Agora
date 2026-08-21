import { describe, expect, it } from "vitest";
import { clusterStories, hardNewsScore, rankStories, similarity, titleTokens } from "./newsRank";

const NOW = Date.parse("2026-08-21T12:00:00Z");
const art = (id: string, headline: string, source: string, hoursAgo = 1) => ({
  id,
  headline,
  url: `https://${source}.example/${id}`,
  publishedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  sources: [{ name: source, domain: `${source}.example` }],
});

describe("titleTokens / similarity", () => {
  it("drops stop words and short tokens", () => {
    expect([...titleTokens("The UN says a ceasefire is near")]).toEqual(["ceasefire", "near"]);
  });
  it("scores the same story from two outlets as similar", () => {
    const a = titleTokens("Eight killed in plane crash at remote Alaskan military site");
    const b = titleTokens("Plane crash at Alaskan military site kills eight, air force says");
    expect(similarity(a, b)).toBeGreaterThanOrEqual(0.5);
  });
  it("scores unrelated stories as dissimilar", () => {
    const a = titleTokens("Japan executes man who killed five in arcade fire");
    const b = titleTokens("Central bank signals rate pause as inflation cools");
    expect(similarity(a, b)).toBeLessThan(0.5);
  });
});

describe("clusterStories", () => {
  it("merges near-duplicates and unions outlets", () => {
    const out = clusterStories([
      art("1", "Eight killed in plane crash at remote Alaskan military site", "bbc"),
      art("2", "Plane crash at Alaskan military site kills eight, air force says", "guardian"),
      art("3", "Central bank signals rate pause as inflation cools", "reuters"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].sources.map((s) => s.name)).toEqual(["bbc", "guardian"]);
  });
  it("does not double-count the same outlet", () => {
    const out = clusterStories([
      art("1", "Eight killed in plane crash at Alaskan site", "bbc"),
      art("2", "Eight killed in plane crash at Alaskan site - update", "bbc"),
    ]);
    expect(out[0].sources).toHaveLength(1);
  });
});

describe("rankStories", () => {
  it("ranks multi-outlet hard news above single-outlet soft news and flags majors", () => {
    const ranked = rankStories(
      [
        art("soft", "Tips for living well: the best way to spend a Sunday", "guardian", 0.5),
        art("a", "Eight killed in plane crash at remote Alaskan military site", "bbc", 2),
        art("b", "Plane crash at Alaskan military site kills eight", "aljazeera", 2),
        art("c", "Parliament votes on sanctions after missile strike", "reuters", 3),
      ],
      { majorCount: 2, now: NOW }
    );
    expect(ranked[0].id).toBe("a");
    expect(ranked[0].sources).toHaveLength(2);
    expect(ranked[1].id).toBe("c");
    expect(ranked.filter((s) => s.major).map((s) => s.id)).toEqual(["a", "c"]);
    expect(ranked.find((s) => s.id === "soft")?.major).toBe(false);
  });
  it("uses recency as a tie-breaker", () => {
    const ranked = rankStories(
      [art("old", "Court verdict expected in tariff case", "bbc", 40), art("fresh", "Sanctions vote passes parliament", "reuters", 1)],
      { majorCount: 1, now: NOW }
    );
    // equal coverage and keyword weight → the fresher story wins
    expect(ranked[0].id).toBe("fresh");
  });
  it("hard-news vocabulary counts", () => {
    expect(hardNewsScore("Earthquake kills dozens; troops evacuate region")).toBeGreaterThanOrEqual(3);
    expect(hardNewsScore("Gandhi notes sold at auction")).toBe(0);
  });
});
