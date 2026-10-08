import { describe, expect, it } from "vitest";
import { joinSpans, lineEnd, pickSpeakers, speakerDuring, type SpeechSpan } from "./replayAttribution";

/* Who said a line. Times are epoch ms on the recorder's clock; T is a
   recording that started on the hour. */
const T = Date.UTC(2026, 9, 7, 18, 0, 0);
const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const span = (user_id: string, fromS: number, toS: number): SpeechSpan => ({ user_id, from: T + fromS * 1000, to: T + toS * 1000 });
const line = (fromS: number, toS: number) => ({ wallFrom: T + fromS * 1000, wallTo: T + toS * 1000, frame: fromS });
const nothing = { spans: [] as SpeechSpan[], solo: null, utterances: [] as Array<{ offset: number; user_id: string | null }> };

describe("the recorder's speaking notes, put back together", () => {
  it("joins the pieces a long turn was reported in, per person", () => {
    const joined = joinSpans([span(ANA, 10, 20), span(BEN, 12, 14), span(ANA, 20, 30), span(ANA, 30.2, 33), span(ANA, 40, 41)]);
    expect(joined).toEqual([span(ANA, 10, 33), span(BEN, 12, 14), span(ANA, 40, 41)]);
  });

  it("drops a span that ends before it starts", () => {
    expect(joinSpans([{ user_id: ANA, from: T + 5000, to: T + 4000 }])).toEqual([]);
  });
});

describe("who was speaking through a line", () => {
  const spans = joinSpans([span(ANA, 10, 18), span(BEN, 18.5, 26), span(ANA, 26.4, 30)]);

  it("is the person whose speaking covers it", () => {
    expect(speakerDuring(spans, T + 11_000, T + 16_000)).toBe(ANA);
    expect(speakerDuring(spans, T + 19_000, T + 25_000)).toBe(BEN);
  });

  it("is the one who spoke through more of it when two overlap", () => {
    // Ben talks over the end of Ana's sentence
    const over = joinSpans([span(ANA, 10, 18), span(BEN, 16.5, 19)]);
    expect(speakerDuring(over, T + 11_000, T + 17_500)).toBe(ANA);
    expect(speakerDuring(over, T + 17_000, T + 19_000)).toBe(BEN);
  });

  it("allows for the call noticing speech a beat late", () => {
    // the line is timed 14.0–15.0; the call's note of it runs 14.6–15.9
    expect(speakerDuring([span(BEN, 14.6, 15.9)], T + 14_000, T + 15_000)).toBe(BEN);
  });

  it("is nobody when no one was, or only brushed it", () => {
    expect(speakerDuring(spans, T + 40_000, T + 44_000)).toBeNull();
    expect(speakerDuring([span(ANA, 8.4, 9.6)], T + 10_000, T + 12_000)).toBeNull(); // 100 ms inside the half second before
  });
});

describe("a speaker for every line", () => {
  it("uses the recorder's notes first", () => {
    const who = pickSpeakers([line(11, 15), line(19, 24), line(27, 29)], {
      ...nothing,
      spans: [span(ANA, 10, 18), span(BEN, 18.5, 26), span(ANA, 26.4, 30)],
    });
    expect(who).toEqual([ANA, BEN, ANA]);
  });

  it("gives a line between two of the same person's to that person", () => {
    // the middle line fell in a gap in the notes
    const who = pickSpeakers([line(10, 12), line(14, 15), line(17, 19)], {
      ...nothing,
      spans: [span(ANA, 9.5, 12), span(ANA, 17, 19.5)],
    });
    expect(who).toEqual([ANA, ANA, ANA]);
  });

  it("leaves a line unnamed between two different people", () => {
    const who = pickSpeakers([line(10, 12), line(20, 21), line(30, 32)], {
      ...nothing,
      spans: [span(ANA, 10, 12), span(BEN, 30, 32)],
    });
    expect(who).toEqual([ANA, null, BEN]);
  });

  it("names every line after the one person on the stage, notes or not", () => {
    expect(pickSpeakers([line(5, 8), line(60, 64)], { ...nothing, solo: ANA })).toEqual([ANA, ANA]);
    // a sound the call never marked as speech is still that person's microphone
    expect(pickSpeakers([line(5, 8), line(60, 64)], { ...nothing, solo: ANA, spans: [span(ANA, 5, 8)] })).toEqual([ANA, ANA]);
  });

  it("falls back to the nearest live caption within eight seconds", () => {
    const utterances = [
      { offset: 12, user_id: ANA },
      { offset: 31, user_id: BEN },
    ];
    expect(pickSpeakers([line(10, 12), line(25, 27), line(50, 52)], { ...nothing, utterances })).toEqual([ANA, BEN, null]);
  });

  it("works from recording time alone when the recording carries no clock", () => {
    const unstamped = [{ wallFrom: null, wallTo: null, frame: 10 }];
    expect(pickSpeakers(unstamped, { ...nothing, spans: [span(ANA, 9, 12)] })).toEqual([null]);
    expect(pickSpeakers(unstamped, { ...nothing, spans: [span(ANA, 9, 12)], solo: BEN })).toEqual([BEN]);
  });
});

describe("where a line ends", () => {
  it("is where the model said, when it said", () => {
    expect(lineEnd(10, 13.5, "a few words here", 20)).toBe(13.5);
  });

  it("is never past the next line's start", () => {
    expect(lineEnd(10, 25, "a few words here", 14)).toBe(14);
  });

  it("is about the time the words take when the model gave none", () => {
    // twelve words at a talking pace: five seconds
    expect(lineEnd(10, undefined, "one two three four five six seven eight nine ten eleven twelve", undefined)).toBeCloseTo(15, 1);
    expect(lineEnd(10, undefined, "Yes.", undefined)).toBeCloseTo(11.2, 1);
  });

  it("doesn't believe an end far later than the words could take", () => {
    // five words, and the model said they lasted thirty seconds
    const end = lineEnd(2462.8, 2492.8, "Is that a hiking bag?", 2504.3);
    expect(end - 2462.8).toBeGreaterThan(3);
    expect(end - 2462.8).toBeLessThan(7);
    // a long sentence may still take its time
    const long = "word ".repeat(30).trim();
    expect(lineEnd(100, 118, long, undefined)).toBe(118);
  });

  it("is always after the start", () => {
    expect(lineEnd(10, 10, "Yes.", 10.1)).toBeGreaterThan(10);
    expect(lineEnd(10, 9, "Yes.", undefined)).toBeGreaterThan(10);
  });
});
