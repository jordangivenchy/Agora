import { describe, it, expect } from "vitest";
import { BLOCKED, BODY_MIN, NAME_MIN, blockedMessage, cleanTextError, findBlocked, findBlockedTerm, foldObfuscation } from "./cleanText";
import cases from "./cleanText.cases.json";

describe("the list", () => {
  it("is lowercase, deduped, and only letters and single spaces", () => {
    const terms = BLOCKED.map(([t]) => t);
    expect(new Set(terms).size).toBe(terms.length);
    for (const t of terms) expect(t).toMatch(/^[a-z]+( [a-z]+)*$/);
    expect(terms.length).toBeGreaterThan(500);
  });
});

describe("folding", () => {
  it("maps leetspeak, accents and lookalikes", () => {
    expect(foldObfuscation("N1GG3R")).toBe("nigger");
    expect(foldObfuscation("fück")).toBe("fuck");
    expect(foldObfuscation("f@gg0t")).toBe("faggot");
    expect(foldObfuscation("ѕhіt")).toBe("shit");
  });
  it("joins spaced single letters but leaves words alone", () => {
    expect(foldObfuscation("f u c k")).toBe("fuck");
    expect(foldObfuscation("f.u.c.k you")).toBe("fuck you");
    expect(foldObfuscation("class hole")).toBe("class hole");
  });
  it("drops punctuation glued to a word instead of reading it as a letter", () => {
    expect(foldObfuscation("fuck!")).toBe("fuck ");
    expect(foldObfuscation("sh!t")).toBe("shit");
  });
});

describe("the cases, on both surfaces", () => {
  for (const c of cases) {
    it(`${JSON.stringify(c.text)} → name ${c.name} · body ${c.body}`, () => {
      expect(findBlockedTerm(c.text, NAME_MIN)).toBe(c.name);
      expect(findBlockedTerm(c.text, BODY_MIN)).toBe(c.body);
    });
  }
  it("never lets a slur through on the body surface at any setting", () => {
    expect(findBlockedTerm("some n1gga said", 3)).toBe("nigga");
    expect(findBlockedTerm("fuck", 3)).toBeNull();
  });
});

describe("messages", () => {
  it("names the word unless it is a slur", () => {
    expect(blockedMessage(findBlocked("bullshit")!)).toBe('That includes a word we don\'t allow ("bullshit").');
    expect(blockedMessage(findBlocked("n1gger")!)).toBe("That includes a word we don't allow.");
    expect(cleanTextError("a fine title", NAME_MIN)).toBeNull();
    expect(cleanTextError("piss", BODY_MIN)).toBeNull();
    expect(cleanTextError("piss", NAME_MIN)).toContain("piss");
  });
});
