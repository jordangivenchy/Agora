import { describe, it, expect } from "vitest";
import { parsePositions } from "./extract";

const IDS = ["u0", "u1", "u2", "u3"];
const CTX = { topicKey: "economics", motion: "This House would introduce a UBI", roomId: "r1" };

describe("parsePositions", () => {
  it("parses an expressed position with evidence mapped to utterance ids", () => {
    const json = JSON.stringify({
      positions: [
        { stance: "PRO", summary: "Argued a UBI reduces poverty without cutting work hours much.", confidence: 0.8, evidence_indexes: [0, 2] },
      ],
    });
    const out = parsePositions(json, IDS, CTX);
    expect(out).toHaveLength(1);
    expect(out[0].stance).toBe("PRO");
    expect(out[0].evidenceUtteranceIds).toEqual(["u0", "u2"]);
    expect(out[0].topicKey).toBe("economics");
  });

  it("returns [] when no clear position was expressed", () => {
    expect(parsePositions('{"positions": []}', IDS, CTX)).toEqual([]);
  });

  it("drops a position with no summary paraphrase", () => {
    const json = JSON.stringify({ positions: [{ stance: "CON", summary: "   ", confidence: 0.9 }] });
    expect(parsePositions(json, IDS, CTX)).toEqual([]);
  });

  it("rejects invalid stances by nulling them but keeps a real summary", () => {
    const json = JSON.stringify({ positions: [{ stance: "STRONGLY_PRO", summary: "Argued for it.", confidence: 0.5 }] });
    const out = parsePositions(json, IDS, CTX);
    expect(out[0].stance).toBeNull();
    expect(out[0].summary).toBe("Argued for it.");
  });

  it("drops out-of-range evidence indexes", () => {
    const json = JSON.stringify({ positions: [{ stance: "PRO", summary: "x", confidence: 0.5, evidence_indexes: [0, 99] }] });
    const out = parsePositions(json, IDS, CTX);
    expect(out[0].evidenceUtteranceIds).toEqual(["u0"]);
  });

  it("clamps confidence and strips code fences", () => {
    const json = "```json\n" + JSON.stringify({ positions: [{ stance: "CON", summary: "Opposed on cost.", confidence: 5 }] }) + "\n```";
    const out = parsePositions(json, IDS, CTX);
    expect(out[0].confidence).toBe(1);
  });

  it("returns [] on unparseable model output", () => {
    expect(parsePositions("I think they support it", IDS, CTX)).toEqual([]);
  });

  it("caps the number of positions", () => {
    const json = JSON.stringify({ positions: Array.from({ length: 9 }, () => ({ stance: "PRO", summary: "s", confidence: 0.5 })) });
    expect(parsePositions(json, IDS, CTX).length).toBeLessThanOrEqual(4);
  });
});
