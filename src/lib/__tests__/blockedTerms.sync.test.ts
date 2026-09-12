import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BLOCKED } from "@/lib/cleanText";
import terms from "@/lib/blockedTerms.json";

/* The database's list is generated from the same JSON the app reads
   (scripts/blocked-terms-sql.mjs). If this fails, regenerate the
   migration into a new file and apply it. */

const MIGRATION = path.resolve(__dirname, "../../../supabase/migrations/20260914_clean_text.sql");

describe("blocked terms, app and database", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  it("carry the same terms and severities", () => {
    const rows = [...sql.matchAll(/insert into clean_terms_in \(term, severity\) select t, ([123]) from string_to_table\('([a-z ,]+)', ','\)/g)]
      .flatMap((m) => m[2].split(",").map((t) => [t, Number(m[1])] as const));
    expect(rows.length).toBe(BLOCKED.length);
    expect(new Map(rows)).toEqual(new Map(BLOCKED));
  });
  it("fold the same lookalike letters", () => {
    const from = terms.confusables.map(([a]) => a).join("");
    const to = terms.confusables.map(([, b]) => b).join("");
    expect(sql).toContain(`translate(v, '${from}', '${to}')`);
  });
  it("know the same codes", () => {
    expect(sql).toContain("1488");
    expect(sql).toContain("14[ /-]88");
    expect(sql).toContain("🖕");
  });
});
