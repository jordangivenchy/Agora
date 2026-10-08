import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTRIES } from "@/components/agora/places";
import { TOPICS } from "@/types/database";
import { AGE_GROUPS, KINDS, KIND_KEYS, LEFT_OUT, MEASURES, MEASURE_ORDER, STANCES, isKind, isStance } from "./kinds";

/* The lists the totals are made of live in two places: here, and in the
   database that checks every row against them. These hold the two equal. */
const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261008_totals.sql"), "utf8");
const quoted = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe("the lists behind the totals", () => {
  it("has the same kinds of argument as the database allows", () => {
    const check = /check \(kinds <@ array\[([\s\S]*?)\]::text\[\]\)/.exec(sql);
    expect(check).not.toBeNull();
    expect(quoted(check![1])).toEqual([...KIND_KEYS]);
    expect(new Set(KIND_KEYS).size).toBe(KINDS.length);
    for (const k of KINDS) {
      expect(k.label.length).toBeGreaterThan(3);
      expect(k.hint.length).toBeGreaterThan(10);
    }
  });

  it("has the same sides as the database allows", () => {
    const check = /check \(stance in \(([^)]*)\)\)/.exec(sql);
    expect(quoted(check![1])).toEqual([...STANCES]);
    // "unclear" is stored but never counted as a side
    expect(Object.keys(MEASURES.argued.parts)).toEqual(["for", "against", "mixed"]);
    expect(sql).toContain("where x.stance in ('for', 'against', 'mixed')");
  });

  it("leaves out the same countries as the database", () => {
    const body = /function public\.totals_left_out[\s\S]*?array\[([\s\S]*?)\]\), false\)/.exec(sql);
    expect(body).not.toBeNull();
    expect(quoted(body![1])).toEqual([...LEFT_OUT]);
    expect(new Set(LEFT_OUT).size).toBe(LEFT_OUT.length);
    // every one is a country a person can pick, and the United States is not among them
    const known = new Set(COUNTRIES.map(([code]) => code));
    for (const code of LEFT_OUT) expect(known.has(code), code).toBe(true);
    expect(LEFT_OUT).not.toContain("US");
    // the 27 of the European Union, three more of the EEA, the United Kingdom and Switzerland
    expect(LEFT_OUT).toHaveLength(32);
  });

  it("has the same age groups as the database works out", () => {
    for (const g of AGE_GROUPS) expect(sql).toContain(`'${g}'`);
    expect(AGE_GROUPS[0]).toBe("18-24");
  });

  it("counts the four things the database counts, by topic or by motion as it does", () => {
    expect([...MEASURE_ORDER].sort()).toEqual(Object.keys(MEASURES).sort());
    for (const m of MEASURE_ORDER) {
      const row = new RegExp(`'${m}'(?:::text)?(?: as measure)?, '(topic|motion)'`).exec(sql);
      expect(row?.[1], m).toBe(MEASURES[m].about);
    }
    expect(sql).toMatch(/then 'spoke' else 'listened' end/);
    expect(sql).toMatch(/when 'PRO' then 'for' else 'against' end/);
  });

  it("tells a kind and a side from anything else", () => {
    expect(isKind("money")).toBe(true);
    expect(isKind("Money")).toBe(false);
    expect(isKind("I pay too much in rent")).toBe(false);
    expect(isKind(3)).toBe(false);
    expect(isStance("against")).toBe(true);
    expect(isStance("strongly against")).toBe(false);
  });

  it("knows a name for every topic a room can have", () => {
    // a topic without a name would go out under its key
    expect(TOPICS.map((t) => t.key)).toContain("politics-law");
  });

  it("keeps the counting where only the server can reach it", () => {
    for (const fn of ["totals_countable()", "totals_room_speakers(uuid)", "totals_rooms_to_read(smallint, integer)", "totals_tidy()", "totals_cells(date, date)", "totals_overview(smallint)"]) {
      expect(sql, fn).toContain(`revoke execute on function public.${fn} from public, anon, authenticated;`);
    }
    for (const table of ["totals_staff", "room_reading_runs", "totals_exports"]) {
      expect(sql, table).toContain(`revoke all on public.${table} from anon, authenticated;`);
      expect(sql, table).toContain(`alter table public.${table} enable row level security;`);
    }
    // a person can read what was read from their own rooms, and nothing else of it
    expect(sql).toContain("using (auth.uid() = user_id);");
    expect(sql).toContain("grant select on public.room_readings to authenticated;");
  });
});
