import { describe, it, expect } from "vitest";
import { pathFor, isHomeSection } from "@/lib/routes";

describe("pathFor", () => {
  it("builds the app's paths", () => {
    expect(pathFor.section("home")).toBe("/");
    expect(pathFor.section("trending")).toBe("/trending");
    expect(pathFor.community(null)).toBe("/communities");
    expect(pathFor.community("politics-law")).toBe("/communities/politics-law");
    expect(pathFor.post("p1", "c1")).toBe("/posts/p1#comment-c1");
    expect(pathFor.post("p1")).toBe("/posts/p1");
    expect(pathFor.search("free speech")).toBe("/search?q=free%20speech");
    expect(pathFor.search("")).toBe("/search");
    expect(pathFor.messages("sam")).toBe("/messages/sam");
    expect(pathFor.messages()).toBe("/messages");
  });
});

describe("isHomeSection", () => {
  it("knows the sections", () => {
    expect(isHomeSection("feed")).toBe(true);
    expect(isHomeSection("messages")).toBe(false);
  });
});
