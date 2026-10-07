import { describe, expect, it } from "vitest";
import { SpeechSpans } from "./speechSpans";

/* The recorder's note of who is speaking, from the call's "speaking now"
   list. Times are ms. */
const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";

describe("who is speaking, as spans", () => {
  it("opens a span when someone starts and closes it when they stop", () => {
    const spans = new SpeechSpans();
    spans.update([ANA], 1000);
    spans.update([ANA, BEN], 2500);
    spans.update([BEN], 4000);
    spans.update([], 6000);
    expect(spans.take(7000)).toEqual([
      { id: ANA, s: 1000, e: 4000 },
      { id: BEN, s: 2500, e: 6000 },
    ]);
    expect(spans.take(8000)).toEqual([]);
  });

  it("hands over what it has of a long turn, and the turn carries on", () => {
    const spans = new SpeechSpans();
    spans.update([ANA], 1000);
    expect(spans.take(11_000)).toEqual([{ id: ANA, s: 1000, e: 11_000 }]);
    spans.update([], 14_000);
    expect(spans.take(21_000)).toEqual([{ id: ANA, s: 11_000, e: 14_000 }]);
  });

  it("ignores a click too short to be speech", () => {
    const spans = new SpeechSpans();
    spans.update([ANA], 1000);
    spans.update([], 1080);
    expect(spans.take(2000)).toEqual([]);
  });

  it("leaves out anyone who isn't an account", () => {
    const spans = new SpeechSpans();
    spans.update(["EG_abc123", "own-stream-1a2b3c4d", "guest-77", ANA], 1000);
    spans.update([], 3000);
    expect(spans.take(4000)).toEqual([{ id: ANA, s: 1000, e: 3000 }]);
  });

  it("keeps what a failed report couldn't deliver, ahead of what came after", () => {
    const spans = new SpeechSpans();
    spans.update([ANA], 1000);
    spans.update([], 2000);
    const first = spans.take(3000);
    spans.update([BEN], 4000);
    spans.update([], 5000);
    spans.restore(first);
    expect(spans.take(6000)).toEqual([
      { id: ANA, s: 1000, e: 2000 },
      { id: BEN, s: 4000, e: 5000 },
    ]);
  });

  it("lets go of the oldest when reports can't get out for a long time", () => {
    const spans = new SpeechSpans();
    for (let i = 0; i < 1600; i++) {
      spans.update([ANA], i * 1000);
      spans.update([], i * 1000 + 500);
    }
    const kept = spans.take(2_000_000);
    expect(kept).toHaveLength(1500);
    expect(kept[0].s).toBe(100_000);
  });
});
