/* What a person is asked about themselves when they agree to the terms:
   a date of birth, the country they live in and, in the United States,
   their state. Shared by the website and the phone app, so both ask in
   the same words and judge a date the same way.

   The date is used once, to check the person is old enough; the year
   alone is kept (user_details.birth_year). The check that counts is the
   server's (accept_terms): what is here only decides what the screen
   says before anything is sent. */

import { LEGAL } from "./legal";
import { needsState, stateName, countryName } from "./places";

/** What is sent with the agreement. `birth` is YYYY-MM-DD. */
export interface AboutYou {
  birth: string;
  country: string;
  region: string | null;
}

/** A date of birth as typed, a part to a box. */
export interface BirthParts {
  month: string;
  day: string;
  year: string;
}

export type BirthCheck =
  /** Not all typed yet. */
  | { state: "empty" }
  /** Not a day that has happened, or too long ago to be anyone's. */
  | { state: "bad" }
  | { state: "ok"; iso: string; age: number };

const OLDEST = 120;

/** Whole years lived by `today`, for someone born on year-month-day. */
export function ageOn(year: number, month: number, day: number, today: Date): number {
  const before = today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  return today.getFullYear() - year - (before ? 1 : 0);
}

/** Is what was typed a date of birth, and how old does it make them? */
export function checkBirth(parts: BirthParts, today: Date = new Date()): BirthCheck {
  const [m, d, y] = [parts.month, parts.day, parts.year].map((p) => p.trim());
  if (!m || !d || y.length < 4) return { state: "empty" };
  if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d) || !/^\d{4}$/.test(y)) return { state: "bad" };
  const [month, day, year] = [Number(m), Number(d), Number(y)];
  /* A real day of a real month: the 30th of February is not one. */
  const made = new Date(Date.UTC(year, month - 1, day));
  if (made.getUTCFullYear() !== year || made.getUTCMonth() !== month - 1 || made.getUTCDate() !== day) return { state: "bad" };
  const age = ageOn(year, month, day, today);
  if (age < 0 || age > OLDEST) return { state: "bad" };
  const two = (n: number) => String(n).padStart(2, "0");
  return { state: "ok", iso: `${year}-${two(month)}-${two(day)}`, age };
}

/** The complete answer, ready to send, or null while something is missing. */
export function aboutYou(parts: BirthParts, country: string, region: string, today: Date = new Date()): AboutYou | null {
  const birth = checkBirth(parts, today);
  if (birth.state !== "ok" || !countryName(country)) return null;
  if (needsState(country) && !stateName(region)) return null;
  return { birth: birth.iso, country, region: needsState(country) ? region : null };
}

/** The line under the date of birth: what it is for, or what it came to. */
export function birthHint(check: BirthCheck): { text: string; bad: boolean } {
  if (check.state === "bad") return { text: "That isn't a date of birth. Check the month, day and year.", bad: true };
  if (check.state === "ok") return { text: `That makes you ${check.age}. We keep only the year.`, bad: false };
  return { text: `We check that you are ${LEGAL.minAge} or older, then keep only the year.`, bad: false };
}

/** The words of the step, the same on the website and in the app. */
export const ABOUT_COPY = {
  title: "First, about you",
  sub: `AgoraSphere is for people ${LEGAL.minAge} and over, and the rules that protect you depend on where you live.`,
  birth: "Date of birth",
  country: "Country",
  state: "State",
  pickCountry: "Choose a country",
  pickState: "Choose a state",
  go: "Continue",
  fine: "Nothing is saved until you agree on the next step.",
  heldTitle: "This account is on hold",
  held: (contact: string) =>
    `AgoraSphere is for people ${LEGAL.minAge} and over, and the date of birth given for this account makes you younger than that. If it was a mistake, write to ${contact} and we'll put it right.`,
};
