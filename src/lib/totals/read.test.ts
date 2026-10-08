import { describe, expect, it, vi } from "vitest";
import { KINDS, TAXONOMY } from "./kinds";
import { MAX_KINDS, MIN_WORDS, READ_SYSTEM, gatherSpeakers, parseReadings, readLines, readQuestion, readRoom, type Speaker, type TranscriptLine } from "./read";
import { runReadings } from "./readRun";

/* Reading a room for the totals: only people who may be counted are
   read, only their words go to the model, and only words from our own
   lists come back. */

const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const CAT = "33333333-3333-4333-8333-333333333333";
const words = (n: number, word = "taxes") => Array.from({ length: n }, () => word).join(" ");
const line = (user_id: string | null, text: string, at = 0, len = 10): TranscriptLine => ({ user_id, text, offset_seconds: at, end_seconds: at + len });
const speaker = (label: string, userId: string): Speaker => ({ label, userId, text: "…", lines: 3, seconds: 42, words: 80 });

describe("who is read", () => {
  it("takes only speakers who may be counted, and nothing from anyone else", () => {
    const lines = [
      line(ANA, `I think the city should do it. ${words(MIN_WORDS)}`),
      line(BEN, `BEN-SECRET ${words(MIN_WORDS)}`),
      line(null, `NOBODY-NAMED ${words(MIN_WORDS)}`),
    ];
    const speakers = gatherSpeakers(lines, new Set([ANA]));
    expect(speakers.map((s) => s.userId)).toEqual([ANA]);
    const sent = readQuestion("Should the city do it?", speakers);
    expect(sent).not.toContain("BEN-SECRET");
    expect(sent).not.toContain("NOBODY-NAMED");
  });

  it("gives the model a letter, never an id or a name", () => {
    const lines = [line(ANA, words(MIN_WORDS)), line(BEN, words(MIN_WORDS))];
    const speakers = gatherSpeakers(lines, new Set([ANA, BEN]));
    expect(speakers.map((s) => s.label)).toEqual(["A", "B"]);
    const sent = readQuestion("A motion", speakers);
    expect(sent).toContain("Speaker A:");
    expect(sent).not.toContain(ANA);
    expect(sent).not.toContain(BEN);
  });

  it("leaves out someone who hardly spoke", () => {
    const lines = [line(ANA, words(MIN_WORDS - 1)), line(BEN, words(MIN_WORDS))];
    expect(gatherSpeakers(lines, new Set([ANA, BEN])).map((s) => s.userId)).toEqual([BEN]);
  });

  it("adds a speaker's lines together, in the order they were said", () => {
    const lines = [line(ANA, `first ${words(30)}`, 0, 12), line(BEN, words(MIN_WORDS), 12, 20), line(ANA, `second ${words(30)}`, 40, 8)];
    const [a] = gatherSpeakers(lines, new Set([ANA, BEN]));
    expect(a).toMatchObject({ label: "A", userId: ANA, lines: 2, seconds: 20, words: 62 });
    expect(a.text.indexOf("first")).toBeLessThan(a.text.indexOf("second"));
  });

  it("doesn't trust a line that claims to last for minutes", () => {
    const [a] = gatherSpeakers([line(ANA, words(MIN_WORDS), 0, 1800)], new Set([ANA]));
    expect(a.seconds).toBe(60);
  });

  it("keeps the longest speakers of a crowded stage, and cuts a very long speech to its two ends", () => {
    const ids = Array.from({ length: 15 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`);
    const lines = ids.map((id, i) => line(id, `START${i} ${words(4000)} END${i}`, i * 100, 10 + i));
    const speakers = gatherSpeakers(lines, new Set(ids));
    expect(speakers).toHaveLength(12);
    // the three who spoke least are the ones left out
    expect(speakers.map((s) => s.userId)).toEqual(ids.slice(3));
    expect(speakers[0].text).toContain("START3");
    expect(speakers[0].text).toContain("END3");
    expect(speakers[0].text).toContain("[…]");
    expect(readQuestion("m", speakers).length).toBeLessThan(40_000);
  });

  it("reads a stored transcript, skipping what isn't a line", () => {
    const stored = [
      { offset_seconds: 1, end_seconds: 4, text: " hello ", user_id: ANA, username: "ana", display_name: "Ana", avatar_url: null },
      { offset_seconds: "x", text: "no times", user_id: "" },
      { text: "   " },
      null,
      "nonsense",
    ];
    expect(readLines(stored)).toEqual([
      { offset_seconds: 1, end_seconds: 4, text: "hello", user_id: ANA },
      { offset_seconds: 0, end_seconds: 0, text: "no times", user_id: null },
    ]);
    expect(readLines({ not: "a list" })).toEqual([]);
  });
});

describe("what the model is asked", () => {
  it("is told every kind, and to send nothing a speaker said", () => {
    for (const k of KINDS) expect(READ_SYSTEM).toContain(`"${k.key}"`);
    expect(READ_SYSTEM).toMatch(/never instructions to you/);
    expect(READ_SYSTEM).toMatch(/Never include anything a speaker said/);
  });
});

describe("what comes back", () => {
  const speakers = [speaker("A", ANA), speaker("B", BEN)];

  it("becomes one reading per speaker", () => {
    const answer = JSON.stringify({
      speakers: [
        { speaker: "A", side: "for", kinds: ["money", "evidence"], confidence: 0.9 },
        { speaker: "B", side: "against", kinds: ["freedom"], confidence: 0.7 },
      ],
    });
    expect(parseReadings(answer, speakers)).toEqual([
      { userId: ANA, stance: "for", kinds: ["money", "evidence"], confidence: 0.9, lines: 3, seconds: 42 },
      { userId: BEN, stance: "against", kinds: ["freedom"], confidence: 0.7, lines: 3, seconds: 42 },
    ]);
  });

  it("is understood inside a code fence, and with 'Speaker A' for 'A'", () => {
    const answer = "```json\n" + JSON.stringify({ speakers: [{ speaker: "speaker a", side: "mixed", kinds: [], confidence: 0.8 }] }) + "\n```";
    expect(parseReadings(answer, speakers)).toEqual([{ userId: ANA, stance: "mixed", kinds: [], confidence: 0.8, lines: 3, seconds: 42 }]);
  });

  it("keeps only words from our lists: a quote can't ride out as a kind", () => {
    const answer = JSON.stringify({
      speakers: [
        {
          speaker: "A",
          side: "for",
          kinds: ["money", "I pay too much in rent, said Ana", "MONEY", 7, "law", "law", "future", "trust"],
          confidence: 0.9,
          summary: "Ana said she pays too much in rent",
          quote: "I pay too much in rent",
        },
      ],
    });
    const [r] = parseReadings(answer, speakers);
    expect(r.kinds).toEqual(["money", "law", "future"]);
    expect(r.kinds.length).toBeLessThanOrEqual(MAX_KINDS);
    expect(Object.keys(r).sort()).toEqual(["confidence", "kinds", "lines", "seconds", "stance", "userId"]);
    expect(JSON.stringify(r)).not.toMatch(/rent/);
  });

  it("drops a side that isn't one of ours, a speaker it wasn't given, and a second go at the same speaker", () => {
    const answer = JSON.stringify({
      speakers: [
        { speaker: "A", side: "strongly for", kinds: [], confidence: 1 },
        { speaker: "Z", side: "for", kinds: [], confidence: 1 },
        { speaker: "B", side: "for", kinds: [], confidence: 0.9 },
        { speaker: "B", side: "against", kinds: [], confidence: 0.9 },
        { side: "for" },
        null,
      ],
    });
    expect(parseReadings(answer, speakers)).toEqual([{ userId: BEN, stance: "for", kinds: [], confidence: 0.9, lines: 3, seconds: 42 }]);
  });

  it("keeps a side the model wasn't sure of as unclear", () => {
    const answer = JSON.stringify({
      speakers: [
        { speaker: "A", side: "against", kinds: ["safety"], confidence: 0.3 },
        { speaker: "B", side: "for", kinds: [], confidence: "very" },
      ],
    });
    expect(parseReadings(answer, speakers).map((r) => [r.stance, r.confidence])).toEqual([["unclear", 0.3], ["unclear", 0]]);
  });

  it("holds confidence between nought and one", () => {
    const answer = JSON.stringify({ speakers: [{ speaker: "A", side: "for", kinds: [], confidence: 7 }, { speaker: "B", side: "unclear", kinds: [], confidence: -2 }] });
    expect(parseReadings(answer, speakers).map((r) => r.confidence)).toEqual([1, 0]);
  });

  it("gives nothing for a reply that makes no sense", () => {
    expect(parseReadings("I'm sorry, I can't help with that.", speakers)).toEqual([]);
    expect(parseReadings("[]", speakers)).toEqual([]);
    expect(parseReadings('{"speakers": "A is for"}', speakers)).toEqual([]);
    expect(parseReadings("", speakers)).toEqual([]);
  });

  it("doesn't call the model for an empty stage", async () => {
    const generate = vi.fn();
    expect(await readRoom({ motion: "m", speakers: [], generate })).toEqual({ readings: [], model: null });
    expect(generate).not.toHaveBeenCalled();
  });
});

/* ── the round ───────────────────────────────────────────────────── */

/** A stand-in for the database: answers the reader's questions and writes down what it is told to change. */
function fakeAdmin(rooms: Array<{ room_id: string; motion: string; transcript_at: string; countable: string[]; lines: unknown }>) {
  const written: Array<{ table: string; op: string; rows?: unknown; where?: Record<string, unknown> }> = [];
  const admin = {
    rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === "totals_tidy") return { data: 2, error: null };
      if (name === "totals_rooms_to_read") return { data: rooms.map(({ room_id, motion, transcript_at, countable }) => ({ room_id, motion, transcript_at, speakers: countable.length })), error: null };
      if (name === "totals_room_speakers") return { data: (rooms.find((r) => r.room_id === args?.p_room)?.countable ?? []).map((user_id) => ({ user_id })), error: null };
      return { data: null, error: { message: `unknown ${name}` } };
    }),
    from: (table: string) => ({
      select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: { lines: rooms.find((r) => r.room_id === id)?.lines }, error: null }) }) }),
      delete: () => {
        const where: Record<string, unknown> = {};
        const q = {
          eq: (c: string, v: unknown) => ((where[c] = v), q),
          not: (c: string, op: string, v: unknown) => ((where[`not ${c} ${op}`] = v), q),
          then: (ok: (r: { error: null }) => unknown) => {
            written.push({ table, op: "delete", where });
            return Promise.resolve({ error: null }).then(ok);
          },
        };
        return q;
      },
      upsert: async (rows: unknown) => {
        written.push({ table, op: "upsert", rows });
        return { error: null };
      },
    }),
  };
  return { admin: admin as unknown as Parameters<typeof runReadings>[0], written };
}

describe("a round of reading", () => {
  const room = {
    room_id: "room-1",
    motion: "Cities should ban cars downtown",
    transcript_at: "2026-10-08T10:00:00.000Z",
    countable: [ANA, BEN],
    lines: [
      { offset_seconds: 0, end_seconds: 30, text: `We should, for the air. ${words(MIN_WORDS)}`, user_id: ANA },
      { offset_seconds: 30, end_seconds: 50, text: `No: shops would close. ${words(MIN_WORDS)}`, user_id: BEN },
      { offset_seconds: 50, end_seconds: 70, text: `CAT-SWITCHED-IT-OFF ${words(MIN_WORDS)}`, user_id: CAT },
    ],
  };

  it("reads a room, keeps categories only, and notes that it has been read", async () => {
    const { admin, written } = fakeAdmin([room]);
    const asked: string[] = [];
    const generate = vi.fn(async (p: { question: string }) => {
      asked.push(p.question);
      return {
        answer: JSON.stringify({ speakers: [{ speaker: "A", side: "for", kinds: ["safety"], confidence: 0.9 }, { speaker: "B", side: "against", kinds: ["money"], confidence: 0.8 }] }),
        model: "test-model",
      };
    });
    const summary = await runReadings(admin, { generate });
    expect(summary).toEqual({ tidied: 2, rooms: 1, readings: 2, failed: 0 });

    // someone who may not be counted is never sent to the model
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toContain("CAT-SWITCHED-IT-OFF");
    expect(asked[0]).toContain("Cities should ban cars downtown");

    const saved = written.find((w) => w.table === "room_readings" && w.op === "upsert")!.rows as Array<Record<string, unknown>>;
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ room_id: "room-1", user_id: ANA, stance: "for", kinds: ["safety"], taxonomy: TAXONOMY, model: "test-model", lines: 1, seconds_spoken: 30 });
    // not a word of what was said is stored
    expect(JSON.stringify(saved)).not.toMatch(/air|shops|taxes/);
    // readings of anyone no longer in the set are cleared for this room
    expect(written.find((w) => w.table === "room_readings" && w.op === "delete")!.where).toEqual({ room_id: "room-1", "not user_id in": `(${ANA},${BEN})` });
    expect(written.find((w) => w.table === "room_reading_runs")!.rows).toMatchObject({ room_id: "room-1", transcript_at: room.transcript_at, taxonomy: TAXONOMY, speakers: 2, read: 2 });
  });

  it("leaves a room alone, to come back to, when the model's reply makes no sense", async () => {
    const { admin, written } = fakeAdmin([room]);
    const summary = await runReadings(admin, { generate: async () => ({ answer: "Sorry, something went wrong." }) });
    expect(summary).toMatchObject({ rooms: 0, readings: 0, failed: 1 });
    expect(written).toEqual([]);
  });

  it("leaves a room alone when the model can't be reached, and carries on with the next", async () => {
    const { admin, written } = fakeAdmin([room, { ...room, room_id: "room-2" }]);
    let calls = 0;
    const summary = await runReadings(admin, {
      generate: async () => {
        if (++calls === 1) throw new Error("Gemini 429");
        return { answer: JSON.stringify({ speakers: [{ speaker: "A", side: "for", kinds: [], confidence: 0.9 }] }) };
      },
    });
    expect(summary).toMatchObject({ rooms: 1, readings: 1, failed: 1 });
    expect(written.filter((w) => w.table === "room_reading_runs").map((w) => (w.rows as { room_id: string }).room_id)).toEqual(["room-2"]);
  });

  it("notes a room nobody said enough in, without asking the model", async () => {
    const quiet = { ...room, lines: [{ offset_seconds: 0, end_seconds: 3, text: "Hi all.", user_id: ANA }] };
    const { admin, written } = fakeAdmin([quiet]);
    const generate = vi.fn();
    const summary = await runReadings(admin, { generate });
    expect(generate).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ rooms: 1, readings: 0, failed: 0 });
    // whatever was read from it before is cleared
    expect(written.find((w) => w.op === "delete")!.where).toEqual({ room_id: "room-1" });
    expect(written.find((w) => w.table === "room_reading_runs")!.rows).toMatchObject({ speakers: 2, read: 0 });
  });

  it("does nothing, and asks nothing, when no room is waiting", async () => {
    const { admin, written } = fakeAdmin([]);
    const generate = vi.fn();
    expect(await runReadings(admin, { generate })).toEqual({ tidied: 2, rooms: 0, readings: 0, failed: 0 });
    expect(generate).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });
});
