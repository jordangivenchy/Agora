/* From counts of people to a table that may be shown, shared or sold.

   The database counts every group, small ones too (totals_cells). This
   is where the promise in the terms is kept: "nothing drawn from fewer
   than 25 people". A group under the floor is left out, and so is
   enough of what is around it that it can't be worked back out:

   - the groups of a split (the age groups, the countries, the states of
     the United States) add up to the whole they split, so if what is
     hidden in a split adds up to fewer than the floor, the smallest
     shown group is hidden too, until it doesn't;
   - the same across the parts of a measure where a person is in one
     part only (for / against);
   - a part whose whole is hidden is hidden with it.

   What is left is rounded to the nearest five, so two tables for
   overlapping months can't be subtracted down to a handful of people,
   and shares are worked out from the rounded numbers.

   Pure: no database, no clock. table.test.ts is the proof. */

import { LEGAL } from "@/components/agora/legal";
import { countryName, stateName } from "@/components/agora/places";
import { TOPICS } from "@/types/database";
import { AGE_GROUPS, DIMENSIONS, MEASURES, MEASURE_ORDER, type Dimension, type Measure } from "./kinds";

/** Nothing drawn from fewer people than this leaves the building. */
export const TOTALS_FLOOR = LEGAL.totalsFloor;
/** Shown counts are rounded to the nearest this many people. */
export const ROUND_TO = 5;

/** One group of people as the database counted it. May be small. */
export interface RawCell {
  measure: Measure;
  subject_kind: "topic" | "motion";
  /** A topic's key, or a motion with its capitals and spacing evened out. */
  subject: string;
  /** How the subject reads. */
  label: string;
  /** "any": everyone the measure covers. Otherwise one part of it. */
  category: string;
  dimension: Dimension;
  value: string;
  people: number;
  rooms: number | null;
  minutes: number | null;
}

/** A line that may leave. */
export interface TotalLine {
  measure: Measure;
  about: "topic" | "motion";
  subject: string;
  label: string;
  part: string;
  split: Dimension;
  group: string;
  /** Different people, to the nearest five. */
  people: number;
  /** Of everyone the measure covers in the same group, in percent. Null on the "any" line. */
  share: number | null;
  rooms: number | null;
  minutes: number | null;
}

export interface TotalsTable {
  lines: TotalLine[];
  /** Groups the database counted that are not in `lines`. */
  blanked: number;
  floor: number;
}

const isMeasure = (v: unknown): v is Measure => typeof v === "string" && v in MEASURES;
const isDimension = (v: unknown): v is Dimension => typeof v === "string" && (DIMENSIONS as readonly string[]).includes(v);

/** Rows from totals_cells, with anything malformed dropped. */
export function readCells(rows: unknown): RawCell[] {
  if (!Array.isArray(rows)) return [];
  const out: RawCell[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    if (!r || !isMeasure(r.measure) || !isDimension(r.dimension)) continue;
    if (r.subject_kind !== "topic" && r.subject_kind !== "motion") continue;
    if (typeof r.subject !== "string" || typeof r.category !== "string" || typeof r.value !== "string") continue;
    const people = Number(r.people);
    if (!Number.isInteger(people) || people <= 0) continue;
    out.push({
      measure: r.measure,
      subject_kind: r.subject_kind,
      subject: r.subject,
      label: typeof r.label === "string" && r.label ? r.label : r.subject,
      category: r.category,
      dimension: r.dimension,
      value: r.value,
      people,
      rooms: Number.isInteger(r.rooms) ? (r.rooms as number) : null,
      minutes: Number.isInteger(r.minutes) ? (r.minutes as number) : null,
    });
  }
  return out;
}

const at = (category: string, dimension: string, value: string) => `${category}\u0001${dimension}\u0001${value}`;

/* Hide from `slice` until what is hidden adds up to nobody or to the
   floor: anything in between could be had by taking the shown groups
   away from the whole. */
function hideUntilSafe(slice: RawCell[], shown: Set<RawCell>, floor: number): boolean {
  let changed = false;
  for (;;) {
    const hidden = slice.filter((c) => !shown.has(c)).reduce((n, c) => n + c.people, 0);
    if (hidden === 0 || hidden >= floor) return changed;
    const smallest = slice
      .filter((c) => shown.has(c))
      .sort((a, b) => a.people - b.people || a.value.localeCompare(b.value) || a.category.localeCompare(b.category))[0];
    if (!smallest) return changed;
    shown.delete(smallest);
    changed = true;
  }
}

/* One subject (a topic or a motion, for one measure): which of its
   groups may be shown. */
function guard(cells: RawCell[], floor: number, exclusive: boolean): Set<RawCell> {
  const shown = new Set(cells.filter((c) => c.people >= floor));
  const find = new Map(cells.map((c) => [at(c.category, c.dimension, c.value), c]));
  const categories = [...new Set(cells.map((c) => c.category))];
  const columns = [...new Set(cells.map((c) => at("", c.dimension, c.value)))];
  const isShown = (c: RawCell | undefined) => !!c && shown.has(c);

  for (let changed = true; changed; ) {
    changed = false;
    const hide = (c: RawCell) => {
      if (shown.delete(c)) changed = true;
    };

    for (const category of categories) {
      const mine = cells.filter((c) => c.category === category);
      // a part whose whole is hidden goes with it
      if (!isShown(find.get(at(category, "all", "all")))) mine.forEach(hide);
      if (!isShown(find.get(at(category, "country", "US")))) mine.filter((c) => c.dimension === "state").forEach(hide);
      // the groups of a split add up to what they split
      for (const dimension of ["age", "country", "state"] as const) {
        const whole = dimension === "state" ? find.get(at(category, "country", "US")) : find.get(at(category, "all", "all"));
        if (!isShown(whole)) continue;
        if (hideUntilSafe(mine.filter((c) => c.dimension === dimension), shown, floor)) changed = true;
      }
    }

    for (const column of columns) {
      const inColumn = cells.filter((c) => at("", c.dimension, c.value) === column);
      const everyone = inColumn.find((c) => c.category === "any");
      const parts = inColumn.filter((c) => c.category !== "any");
      // no part of a group is shown when the group itself isn't
      if (!isShown(everyone)) parts.forEach(hide);
      // where a person is in one part only, the parts add up to everyone
      else if (exclusive && hideUntilSafe(parts, shown, floor)) changed = true;
    }
  }
  return shown;
}

const roundTo = (n: number) => Math.round(n / ROUND_TO) * ROUND_TO;

const AGE_ORDER = new Map<string, number>(AGE_GROUPS.map((g, i) => [g, i]));
const order = <T>(list: readonly T[], v: T) => {
  const i = list.indexOf(v);
  return i < 0 ? list.length : i;
};

/** The table for a set of counts: small groups out, the rest rounded. */
export function buildTable(raw: RawCell[], floor: number = TOTALS_FLOOR): TotalsTable {
  const cells = raw.filter((c) => c.people > 0);
  const subjects = new Map<string, RawCell[]>();
  for (const c of cells) {
    const k = at(c.measure, c.subject_kind, c.subject);
    const list = subjects.get(k);
    if (list) list.push(c);
    else subjects.set(k, [c]);
  }

  const lines: TotalLine[] = [];
  const size = new Map<string, number>(); // a subject's whole, for the order of the lines
  for (const [k, group] of subjects) {
    const measure = group[0].measure;
    const shown = guard(group, floor, MEASURES[measure].exclusive);
    const rounded = new Map<RawCell, number>([...shown].map((c) => [c, roundTo(c.people)]));
    const everyone = new Map<string, number>();
    for (const c of shown) if (c.category === "any") everyone.set(at("", c.dimension, c.value), rounded.get(c)!);
    size.set(k, everyone.get(at("", "all", "all")) ?? 0);
    for (const c of shown) {
      const people = rounded.get(c)!;
      const whole = everyone.get(at("", c.dimension, c.value));
      const top = c.measure === "took_part" && c.category === "any" && c.dimension === "all";
      lines.push({
        measure: c.measure,
        about: c.subject_kind,
        subject: c.subject,
        label: c.label,
        part: c.category,
        split: c.dimension,
        group: c.value,
        people,
        share: c.category === "any" || !whole ? null : Math.min(100, Math.round((100 * people) / whole)),
        rooms: top ? c.rooms : null,
        minutes: top ? c.minutes : null,
      });
    }
  }

  const partOrder = (l: TotalLine) => (l.part === "any" ? -1 : order(Object.keys(MEASURES[l.measure].parts), l.part));
  const groupOrder = (l: TotalLine) => (l.split === "age" ? AGE_ORDER.get(l.group) ?? 99 : 0);
  lines.sort(
    (a, b) =>
      order(MEASURE_ORDER, a.measure) - order(MEASURE_ORDER, b.measure) ||
      (size.get(at(b.measure, b.about, b.subject)) ?? 0) - (size.get(at(a.measure, a.about, a.subject)) ?? 0) ||
      a.subject.localeCompare(b.subject) ||
      order(DIMENSIONS, a.split) - order(DIMENSIONS, b.split) ||
      groupOrder(a) - groupOrder(b) ||
      a.group.localeCompare(b.group) ||
      partOrder(a) - partOrder(b)
  );
  return { lines, blanked: cells.length - lines.length, floor };
}

/* ── how a line reads ────────────────────────────────────────────── */

const TOPIC_LABELS = new Map<string, string>(TOPICS.map((t) => [t.key, t.label]));
const SPLITS: Record<Dimension, string> = { all: "Everyone", age: "Age group", country: "Country", state: "US state" };

export function lineWords(l: TotalLine) {
  const m = MEASURES[l.measure];
  return {
    measure: m.label,
    about: l.about === "topic" ? "Topic" : "Motion",
    subject: l.about === "topic" ? TOPIC_LABELS.get(l.subject) ?? l.label : l.label,
    part: l.part === "any" ? m.any : m.parts[l.part] ?? l.part,
    split: SPLITS[l.split],
    group:
      l.split === "all" ? "Everyone"
      : l.split === "age" ? l.group.replace("-", "–")
      : l.split === "country" ? countryName(l.group) || l.group
      : stateName(l.group) || l.group,
  };
}

/* ── months ──────────────────────────────────────────────────────── */

export interface Period {
  /** First and last month, "2026-10". */
  from: string;
  to: string;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthIndex = (ym: string) => {
  const m = MONTH.exec(ym)!;
  return Number(m[1]) * 12 + Number(m[2]) - 1;
};

export const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** A stretch of whole months that has begun and is not absurdly long, or null. */
export function readPeriod(from: unknown, to: unknown, now: Date): Period | null {
  if (typeof from !== "string" || typeof to !== "string" || !MONTH.test(from) || !MONTH.test(to)) return null;
  const a = monthIndex(from);
  const b = monthIndex(to);
  if (a > b || b > monthIndex(monthOf(now)) || b - a > 35 || a < 2024 * 12) return null;
  return { from, to };
}

export const periodDates = (p: Period) => ({ from: `${p.from}-01`, to: `${p.to}-01` });

/** `latest` and the months before it, newest first: what the desk offers to choose from. */
export function monthsBefore(latest: string, count: number): string[] {
  if (!MONTH.test(latest)) return [];
  const end = monthIndex(latest);
  return Array.from({ length: count }, (_, i) => {
    const m = end - i;
    return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  });
}

export function periodWords(p: Period): string {
  const name = (ym: string, year: boolean) => `${MONTH_NAMES[Number(ym.slice(5)) - 1]}${year ? ` ${ym.slice(0, 4)}` : ""}`;
  if (p.from === p.to) return name(p.from, true);
  return `${name(p.from, p.from.slice(0, 4) !== p.to.slice(0, 4))} to ${name(p.to, true)}`;
}

/* ── the file ────────────────────────────────────────────────────── */

/* A field for a spreadsheet: quoted when it has to be, and never able
   to start a formula (a motion is written by whoever hosted the room). */
export function csvField(v: string | number | null): string {
  if (v === null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEAD = ["Months", "Measure", "About", "Subject", "Part", "Split by", "Group", "People", "Share of group (%)", "Rooms", "Minutes"];

export function toCsv(table: TotalsTable, period: Period): string {
  const months = periodWords(period);
  const rows = table.lines.map((l) => {
    const w = lineWords(l);
    return [months, w.measure, w.about, w.subject, w.part, w.split, w.group, l.people, l.share, l.rooms, l.minutes].map(csvField).join(",");
  });
  return [CSV_HEAD.join(","), ...rows].join("\r\n") + "\r\n";
}

/** What goes with a file, for whoever receives it: how the numbers were made and what they can't say. */
export function methodNote(period: Period, floor: number = TOTALS_FLOOR): string {
  return [
    `AgoraSphere totals, ${periodWords(period)}`,
    "",
    "What this is",
    "Counts of people, drawn from public discussion rooms on AgoraSphere that began in these months (UTC). There is no line about any one person, and no name, username, voice, picture or quote.",
    "",
    "Who is counted",
    `Adults (18 or older) who agreed to AgoraSphere's terms, which describe these totals, and who have not switched them off. Only rooms that began after a person agreed are counted for them. People who live in the European Economic Area, the United Kingdom or Switzerland are not counted. Rooms that are not public, and messages, are never used.`,
    "",
    "What is counted",
    "Took part: people who spoke on a room's stage or listened, by topic, with the rooms counted and how long they ran.",
    "Side argued: for each motion, how many speakers argued for it, against it, or both ways. A speaker's side is read from the transcript of what they said by an AI model and sorted into one of those; it is a reading, and can be wrong.",
    "Kinds of argument: by topic, how many speakers leaned on each kind of argument, from a fixed list. A speaker can use several.",
    "Votes in the room: for each motion, how people in the room voted.",
    "",
    "The limits",
    `Nothing is drawn from fewer than ${floor} people. A group smaller than that is left out, and so are enough of the groups beside it that it cannot be worked out by subtraction. A motion or topic with too few people does not appear at all.`,
    `Counts are rounded to the nearest ${ROUND_TO}. Shares are worked out from the rounded counts, so they are approximate and may not add up to 100.`,
    "Age groups come from a year of birth, so an age is right to within a year. Country and US state are what a person told us.",
    "People are counted once per line however many rooms they were in, so lines do not add up across topics, motions or months.",
    "",
    "Using it",
    "These totals may not be used to identify, single out or contact any person, alone or together with other information.",
    "",
  ].join("\n");
}
