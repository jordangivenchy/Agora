/* What would open the day reading is let through, and what would stay
   shut. The gate itself is closed (src/proxy.ts); this keeps the list
   honest in the meantime. */
import { describe, expect, it } from "vitest";
import { isReading } from "./readingGate";

describe("the door for readers, when it is hung", () => {
  it("opens what people share", () => {
    for (const p of ["/", "/agora/abc", "/posts/xyz", "/communities/politics", "/users/jordan", "/@jordan", "/clips/1", "/replays", "/news"]) {
      expect(isReading("GET", p), p).toBe(true);
    }
  });
  it("still needs the pass to take part or hold an account", () => {
    for (const p of ["/login", "/welcome", "/settings", "/messages", "/notifications", "/feed", "/mod", "/search"]) {
      expect(isReading("GET", p), p).toBe(false);
    }
  });
  it("never opens a write", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isReading(m, "/agora/abc"), m).toBe(false);
      expect(isReading(m, "/api/news"), m).toBe(false);
    }
  });
  it("lets a crawler read the files it asks for first", () => {
    expect(isReading("GET", "/robots.txt")).toBe(true);
    expect(isReading("GET", "/sitemap.xml")).toBe(true);
  });
  it("doesn't let a prefix match a different word", () => {
    expect(isReading("GET", "/newsletter-admin")).toBe(false);
    expect(isReading("GET", "/postsomething")).toBe(false);
  });
});
