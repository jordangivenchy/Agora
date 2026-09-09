import { describe, expect, it } from "vitest";
import { clusterStories, debateScore, hardNewsScore, noiseScore, rankStories, similarity, titleTokens, toUtcIso } from "./newsRank";

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
  it("penalizes rolling live blogs out of the majors", () => {
    const ranked = rankStories(
      [
        art("blog", "Democrats rally behind candidate in special election – US politics live", "guardian", 1),
        art("story", "Parliament passes sanctions bill", "bbc", 2),
      ],
      { majorCount: 1, now: NOW }
    );
    expect(ranked[0].id).toBe("story");
  });
  it("hard-news vocabulary counts", () => {
    expect(hardNewsScore("Earthquake kills dozens; troops evacuate region")).toBeGreaterThanOrEqual(3);
    expect(hardNewsScore("Gandhi notes sold at auction")).toBe(0);
  });
});

describe("debate tuning", () => {
  it("prefers contested ground over an accident at equal coverage", () => {
    const ranked = rankStories(
      [
        art("crash", "Flight recorders recovered from devastating cargo plane crash", "bbc", 1),
        art("policy", "Should social media ban under-16s? Senate weighs a national age law", "npr", 1),
      ],
      { majorCount: 1, now: NOW }
    );
    expect(ranked[0].id).toBe("policy");
    expect(debateScore("Should social media ban under-16s?")).toBeGreaterThanOrEqual(4);
    expect(noiseScore("Flight recorders recovered from cargo plane crash")).toBeGreaterThan(0);
  });
  it("keeps commerce out of the hero", () => {
    const ranked = rankStories(
      [
        art("shop", "First Look: Sony's new headphones, an old favorite is back", "cnn", 0.5),
        art("news", "Parliament passes sanctions bill", "bbc", 3),
      ],
      { majorCount: 1, now: NOW }
    );
    expect(ranked[0].id).toBe("news");
  });
  it("caps one outlet's share of the list", () => {
    const heads = [
      "Council approves new tram line through the city centre",
      "Farmers warn of harvest losses after the dry summer",
      "Hospital trust apologises over waiting times",
      "Museum reopens after a three-year refurbishment",
      "Fishing quota talks stall in the North Sea",
      "Village school saved from closure by parents' campaign",
      "Rail operator fined for cancelled services",
    ];
    const many = heads.map((h, i) => art(`g${i}`, h, "guardian", i));
    const ranked = rankStories([...many, art("bbc", "BBC story on a different subject entirely", "bbc", 1)], { now: NOW, perOutletCap: 4 });
    expect(ranked.filter((s) => s.sources[0].name === "guardian")).toHaveLength(4);
    expect(ranked.some((s) => s.id === "bbc")).toBe(true);
  });
  it("makes newsdata's zone-less timestamps unambiguous UTC", () => {
    expect(toUtcIso("2026-09-08 08:31:01")).toBe("2026-09-08T08:31:01Z");
    expect(toUtcIso("2026-09-08T08:31:01Z")).toBe("2026-09-08T08:31:01Z");
    expect(toUtcIso(null)).toBeNull();
  });
});
