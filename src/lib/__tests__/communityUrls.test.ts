import { describe, it, expect } from "vitest";
import { slugify, communitySlug, findCommunityBySlug } from "@/lib/communityUrls";

const A = { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "Politics & Law" };
const B = { id: "bbbbbbbb-2222-4222-8222-222222222222", name: "politics   law!" };
const C = { id: "cccccccc-3333-4333-8333-333333333333", name: "Science" };
const all = [A, B, C];

describe("slugify", () => {
  it("lowercases and collapses non-alphanumerics", () => {
    expect(slugify("Politics & Law")).toBe("politics-law");
    expect(slugify("  --Hello__World--  ")).toBe("hello-world");
  });
  it("caps at 60 chars without a trailing dash", () => {
    const s = slugify("a".repeat(59) + " bcdef");
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("communitySlug", () => {
  it("uses the plain slug for the first of a collision and suffixes later ones", () => {
    expect(communitySlug(A, all)).toBe("politics-law");
    expect(communitySlug(B, all)).toBe("politics-law-bbbbbb");
    expect(communitySlug(C, all)).toBe("science");
  });
  it("falls back to an id prefix for names with no alphanumerics", () => {
    const x = { id: "dddddddd-4444-4444-8444-444444444444", name: "???" };
    expect(communitySlug(x, [x])).toBe("dddddd");
  });
});

describe("findCommunityBySlug", () => {
  it("round-trips every community", () => {
    for (const c of all) expect(findCommunityBySlug(communitySlug(c, all), all)).toBe(c);
  });
  it("accepts a raw uuid", () => {
    expect(findCommunityBySlug(C.id, all)).toBe(C);
    expect(findCommunityBySlug(C.id.toUpperCase(), all)).toBe(C);
  });
  it("returns null for unknown slugs", () => {
    expect(findCommunityBySlug("nope", all)).toBeNull();
    expect(findCommunityBySlug("", all)).toBeNull();
  });
});
