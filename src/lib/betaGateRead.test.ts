/* The read-only gate: what a stranger may open, and what still asks for
   the pass. Mirrors the lists in src/proxy.ts. */
import { describe, expect, it } from "vitest";

const PUBLIC_READ = ["/", "/agora", "/rooms", "/replays", "/clips", "/posts", "/communities", "/users", "/news", "/explore", "/trending", "/api/news", "/api/recordings"];

function reading(method: string, pathname: string): boolean {
  return (
    method === "GET" &&
    (PUBLIC_READ.includes(pathname) ||
      PUBLIC_READ.some((p) => p !== "/" && pathname.startsWith(p + "/")) ||
      pathname.startsWith("/@"))
  );
}

describe("a stranger following a link", () => {
  it("opens what people share", () => {
    for (const p of ["/", "/agora/abc", "/posts/xyz", "/communities/politics", "/users/jordan", "/@jordan", "/clips/1", "/replays", "/news"]) {
      expect(reading("GET", p), p).toBe(true);
    }
  });
  it("still needs the pass to take part or hold an account", () => {
    for (const p of ["/login", "/welcome", "/settings", "/messages", "/notifications", "/feed", "/mod", "/search"]) {
      expect(reading("GET", p), p).toBe(false);
    }
  });
  it("never opens a write", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(reading(m, "/agora/abc"), m).toBe(false);
      expect(reading(m, "/api/news"), m).toBe(false);
    }
  });
  it("doesn't let a prefix match a different word", () => {
    expect(reading("GET", "/newsletter-admin")).toBe(false);
    expect(reading("GET", "/postsomething")).toBe(false);
  });
});
