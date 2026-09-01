import { describe, it, expect } from "vitest";
import { parseHomeRoute, pathFor, canonicalPath } from "@/lib/routes";

describe("parseHomeRoute", () => {
  it("reads the new paths", () => {
    expect(parseHomeRoute("/", "", "")).toEqual({ route: { kind: "section", id: "home" }, legacy: false });
    expect(parseHomeRoute("/trending", "", "").route).toEqual({ kind: "section", id: "trending" });
    expect(parseHomeRoute("/communities", "", "").route).toEqual({ kind: "section", id: "communities" });
    expect(parseHomeRoute("/communities/politics-law", "", "").route).toEqual({ kind: "community", slug: "politics-law" });
    expect(parseHomeRoute("/posts/p1", "", "#comment-c1").route).toEqual({ kind: "post", id: "p1", commentId: "c1" });
    expect(parseHomeRoute("/posts/p1", "?comment=c2", "").route).toEqual({ kind: "post", id: "p1", commentId: "c2" });
    /* /messages is a REAL route (src/app/messages) since the dedicated
       page — the home shell no longer claims it. */
    expect(parseHomeRoute("/messages", "", "").route).toEqual({ kind: "section", id: "home" });
    expect(parseHomeRoute("/search", "?q=free%20speech", "").route).toEqual({ kind: "search", q: "free speech" });
    expect(parseHomeRoute("/search", "", "").route).toEqual({ kind: "search", q: "" });
  });
  it("accepts the legacy query forms and flags them", () => {
    expect(parseHomeRoute("/", "?nav=news", "")).toEqual({ route: { kind: "section", id: "news" }, legacy: true });
    expect(parseHomeRoute("/", "?post=p1&comment=c1", "")).toEqual({ route: { kind: "post", id: "p1", commentId: "c1" }, legacy: true });
    expect(parseHomeRoute("/", "?dm=u1", "")).toEqual({ route: { kind: "dm-user", userId: "u1" }, legacy: true });
  });
  it("ignores unknown paths", () => {
    expect(parseHomeRoute("/whatever", "", "").route).toEqual({ kind: "section", id: "home" });
  });
});

describe("pathFor / canonicalPath", () => {
  it("builds and round-trips", () => {
    expect(pathFor.section("home")).toBe("/");
    expect(pathFor.community(null)).toBe("/communities");
    expect(pathFor.post("p1", "c1")).toBe("/posts/p1#comment-c1");
    expect(pathFor.search("free speech")).toBe("/search?q=free%20speech");
    expect(pathFor.search("")).toBe("/search");
    expect(canonicalPath({ kind: "search", q: "a b" })).toBe("/search?q=a%20b");
    expect(canonicalPath({ kind: "post", id: "p1", commentId: null })).toBe("/posts/p1");
    expect(canonicalPath({ kind: "dm-user", userId: "u" })).toBeNull();
    const p = pathFor.community("a-b");
    const r = parseHomeRoute(p, "", "").route;
    expect(r).toEqual({ kind: "community", slug: "a-b" });
  });
});
