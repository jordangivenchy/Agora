import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LEGAL, legalBlanks, legalReady, privacySections, termsSections, termsSummary, type LegalSection } from "./legal";

/* The terms and the privacy policy as data: the checks that keep the two
   documents whole, whoever edits the words. */
const blank = { operator: LEGAL.operator, law: LEGAL.law, contact: LEGAL.contact };
afterEach(() => Object.assign(LEGAL, blank));

const everyWord = (sections: LegalSection[]) =>
  sections.flatMap((s) => [s.title, ...s.body.flatMap((b) => (typeof b === "string" ? [b] : b.list))]).join("\n");

describe("the terms and the privacy policy", () => {
  it("are a draft until someone says who runs AgoraSphere, under whose law, and how to reach them", () => {
    Object.assign(LEGAL, { operator: "", law: "", contact: "" });
    expect(legalReady()).toBe(false);
    expect(legalBlanks()).toHaveLength(3);
    Object.assign(LEGAL, { operator: "Sample Operator LLC", law: "the State of Sample, United States" });
    expect(legalReady()).toBe(false);
    expect(legalBlanks()).toEqual(["a contact address"]);
    Object.assign(LEGAL, { contact: "legal@example.com" });
    expect(legalReady()).toBe(true);
    expect(legalBlanks()).toEqual([]);
  });

  it("leave no gap in the text once those are filled in", () => {
    Object.assign(LEGAL, { operator: "Sample Operator LLC", law: "the State of Sample, United States", contact: "legal@example.com" });
    const text = everyWord(termsSections()) + everyWord(privacySections());
    expect(text).not.toContain("[to be confirmed]");
    expect(text).toContain("Sample Operator LLC");
    expect(text).toContain("the State of Sample, United States");
    expect(text).toContain("legal@example.com");
  });

  it("carry a version that is a date, the one a person's agreement is recorded against", () => {
    expect(LEGAL.version).toMatch(/^\d{4}-\d{2}-\d{2}[a-z]?$/); // the same shape the database accepts
  });

  for (const [name, sections] of [["terms", termsSections()], ["privacy policy", privacySections()]] as const) {
    it(`number the ${name}'s sections in order, each with its own anchor and something to say`, () => {
      expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
      sections.forEach((s, i) => {
        expect(s.title.startsWith(`${i + 1}. `)).toBe(true);
        expect(s.id).toMatch(/^[a-z][a-z-]*$/);
        expect(s.body.length).toBeGreaterThan(0);
        for (const block of s.body) {
          if (typeof block === "string") expect(block.trim().length).toBeGreaterThan(20);
          else expect(block.list.length).toBeGreaterThan(0);
        }
      });
    });
  }

  it("say the same thing about the anonymous totals in both documents", () => {
    const terms = everyWord(termsSections());
    const privacy = everyWord(privacySections());
    for (const text of [terms, privacy]) {
      expect(text).toContain(`fewer than ${LEGAL.totalsFloor} people`);
      expect(text).toMatch(/never sell information about you personally|do not sell information about you personally/);
      expect(text).toContain("Data & Coach"); // where the switch is
    }
  });

  it("put the age, the recording and the totals in the points a person sees before agreeing", () => {
    const points = termsSummary();
    expect(points).toHaveLength(5);
    expect(points.join(" ")).toContain(`${LEGAL.minAge} or older`);
    expect(points.join(" ")).toMatch(/recorded and transcribed/);
    expect(points.join(" ")).toMatch(/never sell anything about you personally/);
    for (const p of points) expect(p.length).toBeLessThan(220);
  });

  it("say what is asked about a person, and that only the year of birth is kept", () => {
    const terms = everyWord(termsSections());
    const privacy = everyWord(privacySections());
    expect(terms).toMatch(/date of birth/);
    expect(terms).toMatch(/put on hold/);
    expect(terms).toMatch(/the country you live in and, in the United States, the state/);
    expect(privacy).toMatch(/the year you were born, the country you live in and, in the United States, the state/);
    expect(privacy).toMatch(/keep only the year/);
    expect(privacy).toMatch(/Change your country or state: Settings, then Terms & privacy/);
    // a total split by age or place is still a total: the same floor, said in both
    for (const text of [terms, privacy]) expect(text).toMatch(/split by age group, or by country or state/);
  });

  it("hold the database to the same minimum age", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261007_terms_agreement.sql"), "utf8");
    expect(sql).toContain(`v_min_age constant int := ${LEGAL.minAge};`);
  });

  it("include what Apple asks of an app's own agreement", () => {
    const app = termsSections().find((s) => s.id === "app")!;
    const text = everyWord([app]);
    for (const needed of ["not Apple", "third-party beneficiaries", "embargo", "maintain or support", "refund"]) {
      expect(text).toContain(needed);
    }
    expect(everyWord(termsSections())).toContain("no tolerance for objectionable content or abusive behaviour");
  });
});
