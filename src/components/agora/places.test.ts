import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTRIES, COUNTRIES_FIRST, US_STATES, countryName, needsState, placeLabel, searchPlaces, stateName } from "./places";

/* The countries and states a person can say they live in. */
describe("the list of countries", () => {
  it("is every ISO country once, under a name, in A-to-Z order", () => {
    expect(COUNTRIES).toHaveLength(250); // ISO 3166-1's 249 and Kosovo
    expect(new Set(COUNTRIES.map(([code]) => code)).size).toBe(250);
    expect(new Set(COUNTRIES.map(([, name]) => name)).size).toBe(250);
    for (const [code, name] of COUNTRIES) {
      expect(code).toMatch(/^[A-Z]{2}$/); // the shape the database accepts
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(3);
    }
    const names = COUNTRIES.map(([, name]) => name);
    expect(names).toEqual([...names].sort(new Intl.Collator("en").compare));
  });

  it("knows the places people will look for", () => {
    expect(countryName("US")).toBe("United States");
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("CA")).toBe("Canada");
    expect(countryName("XK")).toBe("Kosovo");
    expect(countryName("ZZ")).toBeNull();
    expect(countryName(null)).toBeNull();
    for (const code of COUNTRIES_FIRST) expect(countryName(code)).not.toBeNull();
  });
});

describe("the states", () => {
  it("are the fifty and the District of Columbia, written the ISO way", () => {
    expect(US_STATES).toHaveLength(51);
    expect(new Set(US_STATES.map(([code]) => code)).size).toBe(51);
    for (const [code] of US_STATES) expect(code).toMatch(/^US-[A-Z]{2}$/);
    expect(stateName("US-CA")).toBe("California");
    expect(stateName("US-DC")).toBe("District of Columbia");
    expect(stateName("CA")).toBeNull(); // a bare "CA" is Canada, not California
  });

  it("are the same list the database accepts", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261007_terms_agreement.sql"), "utf8");
    const body = sql.slice(sql.indexOf("function public.is_us_state"), sql.indexOf("-- ── 3. agreeing"));
    const inSql = [...body.matchAll(/'(US-[A-Z]{2})'/g)].map((m) => m[1]);
    expect(inSql).toHaveLength(51);
    expect([...inSql].sort()).toEqual(US_STATES.map(([code]) => code).sort());
  });

  it("are asked for in the United States only", () => {
    expect(needsState("US")).toBe(true);
    expect(needsState("CA")).toBe(false);
    expect(needsState(null)).toBe(false);
  });
});

describe("a place in words", () => {
  it("names the state with the country, and other countries alone", () => {
    expect(placeLabel("US", "US-TX")).toBe("Texas, United States");
    expect(placeLabel("US", null)).toBe("United States");
    expect(placeLabel("FR", "US-TX")).toBe("France"); // a state left over from before a move
    expect(placeLabel(null, null)).toBeNull();
  });
});

describe("searching the list", () => {
  const names = (query: string, places = COUNTRIES) => searchPlaces(places, query).map(([, name]) => name);

  it("gives the whole list back for nothing typed", () => {
    expect(searchPlaces(COUNTRIES, "  ")).toHaveLength(250);
  });

  it("puts an exact code or another name first", () => {
    expect(names("uk")[0]).toBe("United Kingdom");
    expect(names("uk")).toContain("Ukraine");
    expect(names("usa")).toEqual(["United States"]);
    expect(names("ca", US_STATES)[0]).toBe("California");
  });

  it("finds a place by the name people still use for it", () => {
    expect(names("turkey")).toEqual(["Türkiye"]);
    expect(names("ivory")).toEqual(["Côte d’Ivoire"]);
    expect(names("burma")).toEqual(["Myanmar"]);
    expect(names("czech")).toEqual(["Czechia"]);
  });

  it("doesn't mind accents, capitals or an ampersand", () => {
    expect(names("COTE D'IVOIRE")).toEqual(["Côte d’Ivoire"]);
    expect(names("reunion")).toEqual(["Réunion"]);
    expect(names("trinidad and tobago")).toEqual(["Trinidad & Tobago"]);
  });

  it("lists names that start with what was typed before names that only contain it", () => {
    const found = names("ind");
    expect(found.slice(0, 2)).toEqual(["India", "Indonesia"]);
    expect(found).toContain("British Indian Ocean Territory");
    expect(names("new", US_STATES)).toEqual(["New Hampshire", "New Jersey", "New Mexico", "New York"]);
  });

  it("finds nothing for nonsense", () => {
    expect(names("qqqq")).toEqual([]);
  });
});
