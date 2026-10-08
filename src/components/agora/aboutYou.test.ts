import { describe, expect, it } from "vitest";
import { ABOUT_COPY, aboutYou, ageOn, birthHint, checkBirth } from "./aboutYou";
import { LEGAL } from "./legal";

/* A date of birth as typed, and what it comes to. "Today" is fixed:
   Wednesday 7 October 2026, in the afternoon. */
const TODAY = new Date(2026, 9, 7, 15, 30);
const born = (month: string, day: string, year: string) => checkBirth({ month, day, year }, TODAY);

describe("how old a date of birth makes someone", () => {
  it("counts whole years, turning over on the birthday", () => {
    expect(ageOn(2008, 10, 7, TODAY)).toBe(18); // eighteen today
    expect(ageOn(2008, 10, 8, TODAY)).toBe(17); // eighteen tomorrow
    expect(ageOn(2008, 11, 1, TODAY)).toBe(17);
    expect(ageOn(1998, 3, 4, TODAY)).toBe(28);
    expect(ageOn(2026, 10, 7, TODAY)).toBe(0);
  });
});

describe("a date of birth as typed", () => {
  it("is nothing yet until all three boxes are filled", () => {
    expect(born("", "", "")).toEqual({ state: "empty" });
    expect(born("3", "4", "")).toEqual({ state: "empty" });
    expect(born("3", "4", "199")).toEqual({ state: "empty" }); // the year is still being typed
    expect(born("", "4", "1998")).toEqual({ state: "empty" });
  });

  it("is read as month, day, year, with or without leading zeros", () => {
    expect(born("3", "4", "1998")).toEqual({ state: "ok", iso: "1998-03-04", age: 28 });
    expect(born("03", "04", "1998")).toEqual({ state: "ok", iso: "1998-03-04", age: 28 });
    expect(born(" 12 ", "31", "2000")).toEqual({ state: "ok", iso: "2000-12-31", age: 25 });
  });

  it("says how old an under-age date makes them rather than hiding it", () => {
    expect(born("10", "8", "2008")).toEqual({ state: "ok", iso: "2008-10-08", age: 17 });
    expect(born("1", "1", "2015")).toMatchObject({ state: "ok", age: 11 });
  });

  it("refuses days that never happened", () => {
    expect(born("2", "30", "1998")).toEqual({ state: "bad" });
    expect(born("2", "29", "1999")).toEqual({ state: "bad" }); // not a leap year
    expect(born("2", "29", "2000")).toMatchObject({ state: "ok", iso: "2000-02-29" });
    expect(born("13", "1", "1998")).toEqual({ state: "bad" });
    expect(born("0", "10", "1998")).toEqual({ state: "bad" });
    expect(born("4", "31", "1998")).toEqual({ state: "bad" });
    expect(born("ab", "1", "1998")).toEqual({ state: "bad" });
    expect(born("1", "1", "19985")).toEqual({ state: "bad" });
  });

  it("refuses a day that hasn't come, and one too long ago to be anyone's", () => {
    expect(born("10", "8", "2026")).toEqual({ state: "bad" }); // tomorrow
    expect(born("10", "7", "2026")).toMatchObject({ state: "ok", age: 0 }); // today is a date, if not a likely one
    expect(born("1", "1", "1890")).toEqual({ state: "bad" });
    expect(born("10", "7", "1906")).toMatchObject({ state: "ok", age: 120 });
  });
});

describe("the whole answer", () => {
  const date = { month: "3", day: "4", year: "1998" };

  it("is ready once there is a date and a country", () => {
    expect(aboutYou(date, "CA", "", TODAY)).toEqual({ birth: "1998-03-04", country: "CA", region: null });
  });

  it("needs a state in the United States, and only there", () => {
    expect(aboutYou(date, "US", "", TODAY)).toBeNull();
    expect(aboutYou(date, "US", "US-CA", TODAY)).toEqual({ birth: "1998-03-04", country: "US", region: "US-CA" });
    // a state chosen before the country changed isn't sent
    expect(aboutYou(date, "FR", "US-CA", TODAY)).toEqual({ birth: "1998-03-04", country: "FR", region: null });
  });

  it("isn't ready without a real date or a country we know", () => {
    expect(aboutYou({ month: "2", day: "30", year: "1998" }, "CA", "", TODAY)).toBeNull();
    expect(aboutYou({ month: "3", day: "4", year: "" }, "CA", "", TODAY)).toBeNull();
    expect(aboutYou(date, "", "", TODAY)).toBeNull();
    expect(aboutYou(date, "ZZ", "", TODAY)).toBeNull();
    expect(aboutYou(date, "US", "US-ZZ", TODAY)).toBeNull();
  });

  it("is sent even when the date is under age: the server decides, and remembers", () => {
    expect(aboutYou({ month: "10", day: "8", year: "2008" }, "CA", "", TODAY)).toEqual({ birth: "2008-10-08", country: "CA", region: null });
  });
});

describe("the line under the date", () => {
  it("says what the date is for, then what it came to", () => {
    expect(birthHint(born("", "", ""))).toEqual({ text: `We check that you are ${LEGAL.minAge} or older, then keep only the year.`, bad: false });
    expect(birthHint(born("3", "4", "1998"))).toEqual({ text: "That makes you 28. We keep only the year.", bad: false });
    expect(birthHint(born("2", "30", "1998")).bad).toBe(true);
  });

  it("names the age and a way to put a mistake right on a held account", () => {
    const words = ABOUT_COPY.held("help@example.com");
    expect(words).toContain(`${LEGAL.minAge} and over`);
    expect(words).toContain("help@example.com");
  });
});
