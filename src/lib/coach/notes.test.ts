import { describe, it, expect } from "vitest";
import { parseCoachNotes } from "./notes";

describe("parseCoachNotes", () => {
  it("parses well-formed coach notes", () => {
    const json = JSON.stringify({
      notes: [
        { scope: "skill", scope_ref: "rebuttal", note: "You cite evidence well but rarely rebut directly.", suggestion: "Next debate, name your opponent's strongest point and answer it head-on." },
      ],
    });
    const out = parseCoachNotes(json);
    expect(out).toHaveLength(1);
    expect(out[0].scope).toBe("skill");
    expect(out[0].scopeRef).toBe("rebuttal");
    expect(out[0].suggestion).toMatch(/head-on/);
  });

  it("defaults an unknown scope to general and keeps the note", () => {
    const out = parseCoachNotes(JSON.stringify({ notes: [{ scope: "vibes", note: "Strong close." }] }));
    expect(out[0].scope).toBe("general");
    expect(out[0].suggestion).toBeNull();
  });

  it("drops a note with no body", () => {
    expect(parseCoachNotes(JSON.stringify({ notes: [{ scope: "general", note: "  " }] }))).toEqual([]);
  });

  it("strips code fences and caps at four notes", () => {
    const json = "```json\n" + JSON.stringify({ notes: Array.from({ length: 9 }, (_, i) => ({ scope: "general", note: `n${i}` })) }) + "\n```";
    expect(parseCoachNotes(json).length).toBeLessThanOrEqual(4);
  });

  it("returns [] on unparseable output", () => {
    expect(parseCoachNotes("Here are some tips: be concise.")).toEqual([]);
  });
});
