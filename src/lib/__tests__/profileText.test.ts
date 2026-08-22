import { describe, it, expect } from "vitest";
import {
  BLOCKED_TERMS,
  BIO_MAX,
  DISPLAY_NAME_MAX,
  findBlockedTerm,
  foldObfuscation,
  friendlyProfileError,
  normalizeBio,
  normalizeDisplayName,
  normalizeUsername,
  validateProfileText,
} from "@/lib/profileText";

describe("normalizeDisplayName", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeDisplayName("  Jordan \t\n  J.  ")).toBe("Jordan J.");
  });
  it("strips zero-width, bidi and control characters", () => {
    expect(normalizeDisplayName("Jo\u200Brd\u200Dan \u202E\uFEFF\u0007")).toBe("Jordan");
    expect(normalizeDisplayName("a\u2060b\u206Fc\u0085d")).toBe("abcd");
  });
  it("applies NFC", () => {
    expect(normalizeDisplayName("é")).toBe("é");
  });
  it("caps at 40", () => {
    expect(normalizeDisplayName("x".repeat(80))).toHaveLength(DISPLAY_NAME_MAX);
  });
  it("keeps plain unicode names intact", () => {
    expect(normalizeDisplayName("Zoë Çelik 李")).toBe("Zoë Çelik 李");
  });
});

describe("normalizeBio", () => {
  it("collapses 3+ newlines to 2 and trims line ends", () => {
    expect(normalizeBio("a  b \t\n\n\n\nc   \n")).toBe("a b\n\nc");
  });
  it("normalizes CRLF and keeps single/double newlines", () => {
    expect(normalizeBio("a\r\nb\r\n\r\n\r\nc")).toBe("a\nb\n\nc");
  });
  it("strips invisible chars and caps at 300", () => {
    expect(normalizeBio("hi\u200B there")).toBe("hi there");
    expect(normalizeBio("y".repeat(500))).toHaveLength(BIO_MAX);
  });
});

describe("normalizeUsername", () => {
  it("lowercases and strips disallowed chars", () => {
    expect(normalizeUsername("  Jor-dan_J! ")).toBe("jordan_j");
    expect(normalizeUsername("a".repeat(30))).toHaveLength(20);
  });
});

describe("foldObfuscation", () => {
  it("maps leetspeak and strips diacritics", () => {
    expect(foldObfuscation("N1GG3R")).toBe("nigger");
    expect(foldObfuscation("fück")).toBe("fuck");
    expect(foldObfuscation("f@gg0t")).toBe("faggot");
  });
  it("joins spaced / dotted single letters but not real words", () => {
    expect(foldObfuscation("f u c k")).toBe("fuck");
    expect(foldObfuscation("f.u.c.k you")).toBe("fuck you");
    expect(foldObfuscation("class hole")).toBe("class hole");
  });
});

describe("findBlockedTerm", () => {
  it("hits plain slurs and profanity", () => {
    expect(findBlockedTerm("what a retard")).toBe("retard");
    expect(findBlockedTerm("FUCK")).toBe("fuck");
  });
  it("hits obfuscated forms", () => {
    expect(findBlockedTerm("n.i.g.g.e.r")).toBe("nigger");
    expect(findBlockedTerm("f4gg0t")).toBe("faggot");
    expect(findBlockedTerm("c-u-n-t")).toBe("cunt");
    expect(findBlockedTerm("f_u_c_k")).toBe("fuck"); // username-style separators
  });
  it("does not flag Scunthorpe-style substrings", () => {
    for (const s of [
      "assistant", "class", "Scunthorpe", "classic", "raccoon", "Dick Whittington",
      "cockatoo", "hello world", "Agent 47", "Jordan J.", "shitake", "bass player",
      "Niger delta", "Diksha", "spicy food", "Chinkara", "retarding potential",
      "Negro league history", "Coon Rapids",
    ]) {
      expect(findBlockedTerm(s), s).toBeNull();
    }
  });
  it("returns null for empty", () => {
    expect(findBlockedTerm("")).toBeNull();
  });
  it("has a non-trivial, lowercase, deduped list", () => {
    expect(BLOCKED_TERMS.length).toBeGreaterThan(20);
    expect(new Set(BLOCKED_TERMS).size).toBe(BLOCKED_TERMS.length);
    for (const t of BLOCKED_TERMS) expect(t).toBe(t.toLowerCase());
  });
});

describe("validateProfileText", () => {
  it("returns normalized values when clean", () => {
    const r = validateProfileText({ displayName: "  Jo  ", bio: "hi\n\n\n\nthere", username: "JoJo" });
    expect(r).toEqual({ ok: true, values: { displayName: "Jo", bio: "hi\n\nthere", username: "jojo" } });
  });
  it("reports the offending field", () => {
    expect(validateProfileText({ displayName: "f u c k", bio: "" })).toMatchObject({ ok: false, field: "displayName" });
    expect(validateProfileText({ displayName: "ok", bio: "you cunt" })).toMatchObject({ ok: false, field: "bio" });
    expect(validateProfileText({ username: "n1gg3r_x" })).toMatchObject({ ok: false, field: "username" });
    expect(validateProfileText({ username: "ab" })).toMatchObject({ ok: false, field: "username" });
  });
});

describe("friendlyProfileError", () => {
  it("maps server codes", () => {
    expect(friendlyProfileError("blocked_term")).toMatch(/blocked term/);
    expect(friendlyProfileError("bio_too_long")).toMatch(/300/);
    expect(friendlyProfileError("display_name_too_long")).toMatch(/40/);
    expect(friendlyProfileError("whatever")).toBeNull();
  });
});
