import { describe, expect, it } from "vitest";
import { LEGAL } from "@/components/agora/legal";
import { MEASURES, type Dimension, type Measure } from "./kinds";
import {
  CSV_HEAD,
  ROUND_TO,
  TOTALS_FLOOR,
  buildTable,
  csvField,
  lineWords,
  methodNote,
  monthsBefore,
  periodDates,
  periodWords,
  readCells,
  readPeriod,
  toCsv,
  type RawCell,
  type TotalLine,
} from "./table";

/* The table that may be shown, shared or sold. These are the checks that
   the promise in the terms holds whatever the counts are: nothing drawn
   from fewer than 25 people, and nothing that lets a smaller group be
   worked back out. */

type Person = { age: string; country: string; state?: string; parts: string[] };

/** The counts the database would return for these people (totals_cells): every group, small ones too. */
function count(people: Person[], measure: Measure, subject = "subject"): RawCell[] {
  const n = new Map<string, number>();
  const bump = (category: string, dimension: Dimension, value: string) => {
    const k = `${category}|${dimension}|${value}`;
    n.set(k, (n.get(k) ?? 0) + 1);
  };
  for (const p of people) {
    if (p.parts.length === 0) continue;
    for (const category of new Set([...p.parts, "any"])) {
      bump(category, "all", "all");
      bump(category, "age", p.age);
      bump(category, "country", p.country);
      if (p.state) bump(category, "state", p.state);
    }
  }
  return [...n].map(([k, people]) => {
    const [category, dimension, value] = k.split("|");
    return { measure, subject_kind: MEASURES[measure].about, subject, label: subject, category, dimension: dimension as Dimension, value, people, rooms: null, minutes: null };
  });
}

const crowd = (n: number, p: Person): Person[] => Array.from({ length: n }, () => ({ ...p }));
const find = (lines: TotalLine[], part: string, split: Dimension, group: string) =>
  lines.find((l) => l.part === part && l.split === split && l.group === group);

describe("the floor", () => {
  it("is the number the terms promise", () => {
    expect(TOTALS_FLOOR).toBe(LEGAL.totalsFloor);
    expect(TOTALS_FLOOR).toBe(25);
    // a rounded count can never dip under the floor
    expect(TOTALS_FLOOR % ROUND_TO).toBe(0);
  });

  it("shows a group of 25 and leaves out one of 24", () => {
    const at25 = buildTable(count(crowd(25, { age: "25-34", country: "CA", parts: ["money"] }), "kinds"));
    expect(find(at25.lines, "any", "all", "all")?.people).toBe(25);
    const at24 = buildTable(count(crowd(24, { age: "25-34", country: "CA", parts: ["money"] }), "kinds"));
    expect(at24.lines).toEqual([]);
    expect(at24.blanked).toBeGreaterThan(0);
  });

  it("leaves a motion out altogether when too few people argued it", () => {
    const t = buildTable([
      ...count(crowd(40, { age: "25-34", country: "CA", parts: ["for"] }), "argued", "a busy motion"),
      ...count(crowd(12, { age: "25-34", country: "CA", parts: ["for"] }), "argued", "a quiet motion"),
    ]);
    expect(t.lines.some((l) => l.subject === "a quiet motion")).toBe(false);
    expect(t.lines.some((l) => l.subject === "a busy motion")).toBe(true);
  });

  it("rounds what it shows to the nearest five", () => {
    const t = buildTable(count(crowd(33, { age: "25-34", country: "CA", parts: ["money"] }), "kinds"));
    expect(find(t.lines, "any", "all", "all")?.people).toBe(35);
    for (const l of t.lines) expect(l.people % ROUND_TO).toBe(0);
  });
});

describe("a small group can't be worked back out", () => {
  it("hides a second age group when one hidden group could be had by subtraction", () => {
    const people = [
      ...crowd(10, { age: "18-24", country: "CA", parts: ["money"] }),
      ...crowd(30, { age: "25-34", country: "CA", parts: ["money"] }),
      ...crowd(60, { age: "35-44", country: "CA", parts: ["money"] }),
    ];
    const t = buildTable(count(people, "kinds"));
    expect(find(t.lines, "any", "all", "all")?.people).toBe(100);
    expect(find(t.lines, "any", "age", "18-24")).toBeUndefined();
    // 100 − 60 − 30 would have given the ten away
    expect(find(t.lines, "any", "age", "25-34")).toBeUndefined();
    expect(find(t.lines, "any", "age", "35-44")?.people).toBe(60);
  });

  it("leaves the rest alone when what is hidden already adds up to the floor", () => {
    const people = [
      ...crowd(12, { age: "18-24", country: "CA", parts: ["money"] }),
      ...crowd(14, { age: "65+", country: "CA", parts: ["money"] }),
      ...crowd(30, { age: "25-34", country: "CA", parts: ["money"] }),
      ...crowd(44, { age: "35-44", country: "CA", parts: ["money"] }),
    ];
    const t = buildTable(count(people, "kinds"));
    expect(find(t.lines, "any", "age", "18-24")).toBeUndefined();
    expect(find(t.lines, "any", "age", "65+")).toBeUndefined();
    expect(find(t.lines, "any", "age", "25-34")?.people).toBe(30);
    expect(find(t.lines, "any", "age", "35-44")?.people).toBe(45);
  });

  it("keeps hiding while what is hidden still adds up to fewer than the floor", () => {
    const people = [
      ...crowd(5, { age: "18-24", country: "CA", parts: ["money"] }),
      ...crowd(6, { age: "65+", country: "CA", parts: ["money"] }),
      ...crowd(30, { age: "25-34", country: "CA", parts: ["money"] }),
      ...crowd(59, { age: "35-44", country: "CA", parts: ["money"] }),
    ];
    const t = buildTable(count(people, "kinds"));
    expect(find(t.lines, "any", "age", "25-34")).toBeUndefined();
    expect(find(t.lines, "any", "age", "35-44")?.people).toBe(60);
  });

  it("shows neither side when one side is small: for and against add up to everyone", () => {
    const people = [
      ...crowd(90, { age: "25-34", country: "CA", parts: ["for"] }),
      ...crowd(10, { age: "25-34", country: "CA", parts: ["against"] }),
    ];
    const t = buildTable(count(people, "argued"));
    expect(find(t.lines, "any", "all", "all")?.people).toBe(100);
    expect(find(t.lines, "against", "all", "all")).toBeUndefined();
    expect(find(t.lines, "for", "all", "all")).toBeUndefined();
    // and with the whole of "for" hidden, none of its splits is shown either
    expect(t.lines.filter((l) => l.part === "for")).toEqual([]);
  });

  it("shows both sides when both are big enough", () => {
    const people = [
      ...crowd(70, { age: "25-34", country: "CA", parts: ["for"] }),
      ...crowd(30, { age: "25-34", country: "CA", parts: ["against"] }),
    ];
    const t = buildTable(count(people, "voted"));
    expect(find(t.lines, "for", "all", "all")?.people).toBe(70);
    expect(find(t.lines, "against", "all", "all")?.people).toBe(30);
    expect(find(t.lines, "for", "all", "all")?.share).toBe(70);
    expect(find(t.lines, "any", "all", "all")?.share).toBeNull();
  });

  it("leaves a big kind of argument in when a small one is hidden: kinds overlap, so nothing subtracts", () => {
    const people = [
      ...crowd(60, { age: "25-34", country: "CA", parts: ["money", "evidence"] }),
      ...crowd(10, { age: "25-34", country: "CA", parts: ["law"] }),
      ...crowd(30, { age: "25-34", country: "CA", parts: ["evidence"] }),
    ];
    const t = buildTable(count(people, "kinds"));
    expect(find(t.lines, "law", "all", "all")).toBeUndefined();
    expect(find(t.lines, "money", "all", "all")?.people).toBe(60);
    expect(find(t.lines, "evidence", "all", "all")?.people).toBe(90);
  });

  it("splits the United States by state only where every hidden state is safe", () => {
    const people = [
      ...crowd(30, { age: "25-34", country: "US", state: "US-CA", parts: ["money"] }),
      ...crowd(10, { age: "25-34", country: "US", state: "US-NY", parts: ["money"] }),
      ...crowd(40, { age: "25-34", country: "CA", parts: ["money"] }),
    ];
    const t = buildTable(count(people, "kinds"));
    expect(find(t.lines, "any", "country", "US")?.people).toBe(40);
    // New York's ten would be 40 − 30
    expect(t.lines.filter((l) => l.split === "state")).toEqual([]);
  });

  it("shows no state when the United States itself is hidden", () => {
    const people = [
      ...crowd(26, { age: "25-34", country: "US", state: "US-CA", parts: ["money"] }),
      ...crowd(10, { age: "25-34", country: "CA", parts: ["money"] }),
      ...crowd(30, { age: "25-34", country: "MX", parts: ["money"] }),
    ];
    const t = buildTable(count(people, "kinds"));
    // Canada's ten would be 66 − 30 − 26, so the United States (the smallest shown) goes too…
    expect(find(t.lines, "any", "country", "CA")).toBeUndefined();
    expect(find(t.lines, "any", "country", "US")).toBeUndefined();
    // …and California with it, or the states would add the United States back up
    expect(t.lines.filter((l) => l.split === "state")).toEqual([]);
    expect(find(t.lines, "any", "country", "MX")?.people).toBe(30);
  });

  it("shows no part of a group that is itself hidden", () => {
    const people = [
      ...crowd(10, { age: "18-24", country: "CA", parts: ["for"] }),
      ...crowd(26, { age: "65+", country: "CA", parts: ["for"] }),
      ...crowd(4, { age: "65+", country: "CA", parts: ["against"] }),
      ...crowd(40, { age: "25-34", country: "CA", parts: ["for"] }),
      ...crowd(40, { age: "25-34", country: "CA", parts: ["against"] }),
    ];
    const t = buildTable(count(people, "argued"));
    // everyone aged 65+ (30) is hidden to protect the ten aged 18-24
    expect(find(t.lines, "any", "age", "65+")).toBeUndefined();
    // so the 26 of them who argued for can't be shown either
    expect(find(t.lines, "for", "age", "65+")).toBeUndefined();
  });
});

/* A table is safe when nobody holding it can subtract their way to a
   number about fewer than `floor` people. Checked against the true
   counts, for every whole a buyer could take the shown groups away from. */
function leaks(raw: RawCell[], lines: TotalLine[], floor: number): string[] {
  const shown = new Set(lines.map((l) => `${l.measure}|${l.subject}|${l.part}|${l.split}|${l.group}`));
  const isShown = (c: RawCell | undefined) => !!c && shown.has(`${c.measure}|${c.subject}|${c.category}|${c.dimension}|${c.value}`);
  const found: string[] = [];
  const subjects = new Map<string, RawCell[]>();
  for (const c of raw) subjects.set(`${c.measure}|${c.subject}`, [...(subjects.get(`${c.measure}|${c.subject}`) ?? []), c]);
  for (const [name, cells] of subjects) {
    const get = (category: string, dimension: string, value: string) => cells.find((c) => c.category === category && c.dimension === dimension && c.value === value);
    for (const c of cells) {
      if (!isShown(c)) continue;
      if (c.people < floor) found.push(`${name}: shows ${c.people} people`);
      if (!isShown(get(c.category, "all", "all"))) found.push(`${name}: shows a split of a hidden whole (${c.category})`);
      if (c.dimension === "state" && !isShown(get(c.category, "country", "US"))) found.push(`${name}: shows a state of a hidden United States`);
      if (c.category !== "any" && !isShown(get("any", c.dimension, c.value))) found.push(`${name}: shows a part of a hidden group`);
    }
    const subtract = (whole: RawCell | undefined, parts: RawCell[], what: string) => {
      if (!isShown(whole)) return;
      const left = parts.filter((c) => !isShown(c)).reduce((n, c) => n + c.people, 0);
      if (left > 0 && left < floor) found.push(`${name}: ${what} leaves ${left} people`);
    };
    for (const category of new Set(cells.map((c) => c.category))) {
      for (const dimension of ["age", "country"] as const) {
        subtract(get(category, "all", "all"), cells.filter((c) => c.category === category && c.dimension === dimension), `${category} by ${dimension}`);
      }
      subtract(get(category, "country", "US"), cells.filter((c) => c.category === category && c.dimension === "state"), `${category} by state`);
    }
    if (MEASURES[cells[0].measure].exclusive) {
      for (const column of new Set(cells.map((c) => `${c.dimension}|${c.value}`))) {
        const [dimension, value] = column.split("|");
        subtract(get("any", dimension, value), cells.filter((c) => c.category !== "any" && c.dimension === dimension && c.value === value), `the parts of ${column}`);
      }
    }
  }
  return found;
}

describe("whatever the counts are", () => {
  // a small, repeatable random-number maker
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const AGES = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
  const COUNTRIES = ["US", "US", "US", "CA", "MX", "AU", "JP"];
  const STATES = ["US-CA", "US-CA", "US-NY", "US-TX", "US-WY"];

  for (const measure of ["argued", "voted", "took_part", "kinds"] as const) {
    it(`no subtraction reaches a small group (${measure}, 300 made-up crowds)`, () => {
      const parts = Object.keys(MEASURES[measure].parts);
      let tested = 0; // crowds where something was shown and something had to be hidden
      for (let seed = 1; seed <= 300; seed++) {
        const r = rng(seed * 7919 + measure.length);
        const pick = <T>(list: T[], skew: number) => list[Math.min(list.length - 1, Math.floor(Math.pow(r(), skew) * list.length))];
        const size = 20 + Math.floor(r() * 400);
        const skew = 0.6 + r() * 2.4;
        const people: Person[] = Array.from({ length: size }, () => {
          const country = pick(COUNTRIES, skew);
          const mine = MEASURES[measure].exclusive
            ? [pick(parts, skew)]
            : parts.filter(() => r() < 0.25).slice(0, 3);
          return { age: pick(AGES, skew), country, state: country === "US" ? pick(STATES, skew) : undefined, parts: mine };
        });
        const raw = count(people, measure);
        const t = buildTable(raw);
        expect(leaks(raw, t.lines, TOTALS_FLOOR), `crowd ${seed} of ${size}`).toEqual([]);
        expect(t.blanked).toBe(raw.length - t.lines.length);
        if (t.lines.length > 1 && t.blanked > 0) tested++;
      }
      // most of the crowds must put the guard to work, or this proves little
      expect(tested).toBeGreaterThan(200);
    });
  }

  it("finds the leak in a table nobody guarded", () => {
    // the check above would be worthless if it passed everything
    const people = [
      ...crowd(10, { age: "18-24", country: "CA", parts: ["money"] }),
      ...crowd(30, { age: "25-34", country: "CA", parts: ["money"] }),
      ...crowd(60, { age: "35-44", country: "CA", parts: ["money"] }),
    ];
    const raw = count(people, "kinds");
    const naive = raw.filter((c) => c.people >= TOTALS_FLOOR).map((c): TotalLine => ({
      measure: c.measure, about: c.subject_kind, subject: c.subject, label: c.label, part: c.category, split: c.dimension, group: c.value, people: c.people, share: null, rooms: null, minutes: null,
    }));
    expect(leaks(raw, naive, TOTALS_FLOOR)).toContain("kinds|subject: any by age leaves 10 people");
  });
});

/* What the database itself counted for a made-up crowd, on a practice run
   of the real counting (totals_cells, 2026-10-08): 30 people in
   California aged 25-34 and 26 in Canada aged 18-24, in one room about
   sports and one about culture. 52 of them spoke; four of the
   Californians only listened, and voted for the motion in one room and
   against it in the other. One speaker took no side. */
const PRACTICE: Array<[measure: Measure, subject: string, category: string, dimension: Dimension, value: string, people: number]> = [
  ["took_part", "sports", "any", "all", "all", 56], ["took_part", "sports", "spoke", "all", "all", 52], ["took_part", "sports", "listened", "all", "all", 4],
  ["took_part", "sports", "any", "age", "18-24", 26], ["took_part", "sports", "any", "age", "25-34", 30],
  ["took_part", "sports", "spoke", "age", "18-24", 26], ["took_part", "sports", "spoke", "age", "25-34", 26], ["took_part", "sports", "listened", "age", "25-34", 4],
  ["took_part", "sports", "any", "country", "CA", 26], ["took_part", "sports", "any", "country", "US", 30],
  ["took_part", "sports", "spoke", "country", "CA", 26], ["took_part", "sports", "spoke", "country", "US", 26], ["took_part", "sports", "listened", "country", "US", 4],
  ["took_part", "sports", "any", "state", "US-CA", 30], ["took_part", "sports", "spoke", "state", "US-CA", 26], ["took_part", "sports", "listened", "state", "US-CA", 4],
  ["took_part", "culture", "any", "all", "all", 4], ["took_part", "culture", "listened", "all", "all", 4],
  ["took_part", "culture", "any", "age", "25-34", 4], ["took_part", "culture", "listened", "age", "25-34", 4],
  ["took_part", "culture", "any", "country", "US", 4], ["took_part", "culture", "listened", "country", "US", 4],
  ["took_part", "culture", "any", "state", "US-CA", 4], ["took_part", "culture", "listened", "state", "US-CA", 4],
  ["argued", "made-up motion one", "any", "all", "all", 52], ["argued", "made-up motion one", "for", "all", "all", 26], ["argued", "made-up motion one", "against", "all", "all", 26],
  ["argued", "made-up motion one", "any", "age", "18-24", 26], ["argued", "made-up motion one", "any", "age", "25-34", 26],
  ["argued", "made-up motion one", "for", "age", "25-34", 26], ["argued", "made-up motion one", "against", "age", "18-24", 26],
  ["argued", "made-up motion one", "any", "country", "CA", 26], ["argued", "made-up motion one", "any", "country", "US", 26],
  ["argued", "made-up motion one", "for", "country", "US", 26], ["argued", "made-up motion one", "against", "country", "CA", 26],
  ["argued", "made-up motion one", "any", "state", "US-CA", 26], ["argued", "made-up motion one", "for", "state", "US-CA", 26],
  ["kinds", "sports", "any", "all", "all", 53], ["kinds", "sports", "money", "all", "all", 26], ["kinds", "sports", "evidence", "all", "all", 26],
  ["kinds", "sports", "freedom", "all", "all", 26], ["kinds", "sports", "trust", "all", "all", 1],
  ["kinds", "sports", "any", "age", "18-24", 26], ["kinds", "sports", "any", "age", "25-34", 27],
  ["kinds", "sports", "money", "age", "25-34", 26], ["kinds", "sports", "evidence", "age", "25-34", 26], ["kinds", "sports", "freedom", "age", "18-24", 26], ["kinds", "sports", "trust", "age", "25-34", 1],
  ["kinds", "sports", "any", "country", "CA", 26], ["kinds", "sports", "any", "country", "US", 27],
  ["kinds", "sports", "money", "country", "US", 26], ["kinds", "sports", "evidence", "country", "US", 26], ["kinds", "sports", "freedom", "country", "CA", 26], ["kinds", "sports", "trust", "country", "US", 1],
  ["kinds", "sports", "any", "state", "US-CA", 27], ["kinds", "sports", "money", "state", "US-CA", 26], ["kinds", "sports", "evidence", "state", "US-CA", 26], ["kinds", "sports", "trust", "state", "US-CA", 1],
  ["voted", "made-up motion one", "any", "all", "all", 56], ["voted", "made-up motion one", "for", "all", "all", 30], ["voted", "made-up motion one", "against", "all", "all", 30],
  ["voted", "made-up motion one", "any", "age", "18-24", 26], ["voted", "made-up motion one", "any", "age", "25-34", 30],
  ["voted", "made-up motion one", "for", "age", "25-34", 30], ["voted", "made-up motion one", "against", "age", "18-24", 26], ["voted", "made-up motion one", "against", "age", "25-34", 4],
  ["voted", "made-up motion one", "any", "country", "CA", 26], ["voted", "made-up motion one", "any", "country", "US", 30],
  ["voted", "made-up motion one", "for", "country", "US", 30], ["voted", "made-up motion one", "against", "country", "CA", 26], ["voted", "made-up motion one", "against", "country", "US", 4],
  ["voted", "made-up motion one", "any", "state", "US-CA", 30], ["voted", "made-up motion one", "for", "state", "US-CA", 30], ["voted", "made-up motion one", "against", "state", "US-CA", 4],
];
const practiceCells = (): RawCell[] =>
  PRACTICE.map(([measure, subject, category, dimension, value, people]) => ({
    measure,
    subject_kind: MEASURES[measure].about,
    subject,
    label: subject === "made-up motion one" ? "Made-up motion one" : subject,
    category,
    dimension,
    value,
    people,
    rooms: measure === "took_part" && category === "any" && dimension === "all" ? 1 : null,
    minutes: measure === "took_part" && category === "any" && dimension === "all" ? (subject === "sports" ? 50 : 60) : null,
  }));

describe("a practice run's counts, as the database made them", () => {
  const raw = practiceCells();
  const t = buildTable(raw);
  const of = (measure: Measure, subject: string) =>
    t.lines.filter((l) => l.measure === measure && l.subject === subject).map((l) => `${l.part} / ${l.split} / ${l.group}: ${l.people}`);

  it("leaks nothing", () => {
    expect(leaks(raw, t.lines, TOTALS_FLOOR)).toEqual([]);
  });

  it("drops the four who only listened, and with them the count of who spoke", () => {
    expect(of("took_part", "sports")).toEqual([
      "any / all / all: 55",
      "any / age / 18-24: 25", "any / age / 25-34: 30",
      "any / country / CA: 25", "any / country / US: 30",
      "any / state / US-CA: 30",
    ]);
    expect(of("took_part", "culture")).toEqual([]);
    expect(t.lines.find((l) => l.measure === "took_part")).toMatchObject({ rooms: 1, minutes: 50 });
  });

  it("shows both sides of the argument, each 26 strong", () => {
    expect(of("argued", "made-up motion one")).toEqual([
      "any / all / all: 50", "for / all / all: 25", "against / all / all: 25",
      "any / age / 18-24: 25", "against / age / 18-24: 25",
      "any / age / 25-34: 25", "for / age / 25-34: 25",
      "any / country / CA: 25", "against / country / CA: 25",
      "any / country / US: 25", "for / country / US: 25",
      "any / state / US-CA: 25", "for / state / US-CA: 25",
    ]);
  });

  it("shows the vote as a whole, and no split that would give the four away", () => {
    expect(of("voted", "made-up motion one")).toEqual([
      "any / all / all: 55", "for / all / all: 30", "against / all / all: 30",
      "any / age / 18-24: 25", "any / age / 25-34: 30",
      "any / country / CA: 25", "any / country / US: 30",
      "any / state / US-CA: 30",
    ]);
  });

  it("keeps the three big kinds of argument and not the one speaker's", () => {
    const kinds = of("kinds", "sports");
    expect(kinds).toContain("money / all / all: 25");
    expect(kinds).toContain("freedom / age / 18-24: 25");
    expect(kinds.some((k) => k.startsWith("trust"))).toBe(false);
    expect(t.blanked).toBe(raw.length - t.lines.length);
  });
});

describe("what a line says", () => {
  it("works a share out from the rounded numbers, and never above 100", () => {
    const people = [
      ...crowd(27, { age: "25-34", country: "CA", parts: ["for"] }),
      ...crowd(26, { age: "25-34", country: "CA", parts: ["against"] }),
    ];
    const t = buildTable(count(people, "argued"));
    // 53 people round to 55, 27 and 26 round to 25: 25 of 55
    expect(find(t.lines, "any", "all", "all")?.people).toBe(55);
    expect(find(t.lines, "for", "all", "all")).toMatchObject({ people: 25, share: 45 });
    for (const l of t.lines) if (l.share !== null) expect(l.share).toBeLessThanOrEqual(100);
  });

  it("carries the rooms and minutes on a topic's first line only", () => {
    const raw = count(crowd(40, { age: "25-34", country: "CA", parts: ["listened"] }), "took_part", "sports");
    for (const c of raw) if (c.category === "any" && c.dimension === "all") Object.assign(c, { rooms: 3, minutes: 140 });
    const t = buildTable(raw);
    expect(find(t.lines, "any", "all", "all")).toMatchObject({ rooms: 3, minutes: 140 });
    expect(t.lines.filter((l) => l.rooms !== null)).toHaveLength(1);
  });

  it("reads in plain words", () => {
    const t = buildTable([
      ...count(crowd(40, { age: "18-24", country: "US", state: "US-CA", parts: ["listened"] }), "took_part", "politics-law"),
      ...count(crowd(40, { age: "18-24", country: "US", state: "US-CA", parts: ["money"] }), "kinds", "sports"),
    ]);
    const words = t.lines.map(lineWords);
    expect(words[0]).toEqual({ measure: "Took part", about: "Topic", subject: "Politics & Law", part: "Took part", split: "Everyone", group: "Everyone" });
    expect(words.find((w) => w.split === "Age group")?.group).toBe("18–24");
    expect(words.find((w) => w.split === "Country")?.group).toBe("United States");
    expect(words.find((w) => w.split === "US state")?.group).toBe("California");
    expect(words.find((w) => w.measure === "Kinds of argument" && w.part !== "Speakers read")?.part).toBe("Money and the economy");
  });

  it("puts the biggest subject first and the whole before its parts", () => {
    const t = buildTable([
      ...count(crowd(30, { age: "25-34", country: "CA", parts: ["for"] }), "voted", "small"),
      ...count([...crowd(60, { age: "25-34", country: "CA", parts: ["for"] }), ...crowd(40, { age: "25-34", country: "CA", parts: ["against"] })], "voted", "large"),
    ]);
    expect(t.lines[0]).toMatchObject({ subject: "large", part: "any", split: "all" });
    expect(t.lines.findIndex((l) => l.subject === "small")).toBeGreaterThan(t.lines.findIndex((l) => l.subject === "large"));
    expect(t.lines.slice(0, 3).map((l) => l.part)).toEqual(["any", "for", "against"]);
  });
});

describe("the file", () => {
  it("quotes what a spreadsheet would trip on, and never starts a formula", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('He said "no", twice')).toBe('"He said ""no"", twice"');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvField("+1 for this")).toBe("'+1 for this");
    expect(csvField("@everyone")).toBe("'@everyone");
    expect(csvField(25)).toBe("25");
    expect(csvField(null)).toBe("");
  });

  it("is one line per group under a heading, with nothing about a person in it", () => {
    const period = { from: "2026-10", to: "2026-10" };
    const t = buildTable(count(crowd(40, { age: "25-34", country: "CA", parts: ["for"] }), "voted", "Should cities ban cars, downtown?"));
    const rows = toCsv(t, period).trimEnd().split("\r\n");
    expect(rows[0]).toBe(CSV_HEAD.join(","));
    expect(rows).toHaveLength(t.lines.length + 1);
    expect(rows[1]).toBe('October 2026,Votes in the room,Motion,"Should cities ban cars, downtown?",Voted,Everyone,Everyone,40,,,');
    for (const row of rows) expect(row).not.toMatch(/user_id|username|@[a-z]/i);
  });

  it("says in its note what the numbers are and what they must not be used for", () => {
    const note = methodNote({ from: "2026-07", to: "2026-10" });
    expect(note).toContain("July to October 2026");
    expect(note).toContain(`fewer than ${TOTALS_FLOOR} people`);
    expect(note).toContain(`nearest ${ROUND_TO}`);
    expect(note).toMatch(/European Economic Area, the United Kingdom or Switzerland/);
    expect(note).toMatch(/may not be used to identify/);
  });
});

describe("the months asked for", () => {
  const now = new Date("2026-10-08T21:00:00Z");
  it("are whole months that have begun", () => {
    expect(readPeriod("2026-10", "2026-10", now)).toEqual({ from: "2026-10", to: "2026-10" });
    expect(readPeriod("2026-07", "2026-10", now)).toEqual({ from: "2026-07", to: "2026-10" });
    expect(periodDates({ from: "2026-07", to: "2026-10" })).toEqual({ from: "2026-07-01", to: "2026-10-01" });
  });
  it("are refused when they make no sense", () => {
    expect(readPeriod("2026-11", "2026-11", now)).toBeNull(); // not begun
    expect(readPeriod("2026-10", "2026-09", now)).toBeNull(); // backwards
    expect(readPeriod("2026-10-01", "2026-10", now)).toBeNull();
    expect(readPeriod("2026-13", "2026-13", now)).toBeNull();
    expect(readPeriod("2022-01", "2026-10", now)).toBeNull(); // too long
    expect(readPeriod(undefined, "2026-10", now)).toBeNull();
    expect(readPeriod("2026-10'; drop table users;--", "2026-10", now)).toBeNull();
  });
  it("can be listed backwards from this month, across a new year", () => {
    expect(monthsBefore("2026-02", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
    expect(monthsBefore("nonsense", 4)).toEqual([]);
  });
  it("read as words", () => {
    expect(periodWords({ from: "2026-10", to: "2026-10" })).toBe("October 2026");
    expect(periodWords({ from: "2026-07", to: "2026-10" })).toBe("July to October 2026");
    expect(periodWords({ from: "2025-11", to: "2026-02" })).toBe("November 2025 to February 2026");
  });
});

describe("what comes back from the database", () => {
  it("is kept only when it is a count the table understands", () => {
    const good = { measure: "voted", subject_kind: "motion", subject: "m", label: "M", category: "for", dimension: "all", value: "all", people: 30, rooms: null, minutes: null };
    expect(readCells([good])).toHaveLength(1);
    expect(readCells([{ ...good, measure: "salaries" }])).toEqual([]);
    expect(readCells([{ ...good, dimension: "postcode" }])).toEqual([]);
    expect(readCells([{ ...good, people: 0 }])).toEqual([]);
    expect(readCells([{ ...good, people: "many" }])).toEqual([]);
    expect(readCells([{ ...good, subject_kind: "person" }])).toEqual([]);
    expect(readCells(null)).toEqual([]);
    expect(readCells([null, 3, "x"])).toEqual([]);
  });
});
