import { describe, expect, it } from "vitest";
import { RUN_LIMITS, timeAndName, transcribeClips, type RunLimits } from "./replayTranscribeRun";
import { readProgress, type ClipLine, type HlsSegment, type TranscriptProgress } from "./replayTranscribe";
import { parseTimeline } from "../components/agora/hlsTimeline";

/* A run of the transcript job with made-up audio and a stand-in for the
   model. Segments are two seconds each; "sound" is frames the size
   speech makes, "silent" the size digital silence makes. */
function frame(length: number): number[] {
  const f = new Array(length).fill(0);
  f[0] = 0xff;
  f[1] = 0xf1;
  f[2] = (1 << 6) | (4 << 2); // AAC-LC, 44.1 kHz
  f[3] = (2 << 6) | ((length >> 11) & 0x03);
  f[4] = (length >> 3) & 0xff;
  f[5] = ((length & 0x07) << 5) | 0x1f;
  f[6] = 0xfc;
  return f;
}
const TWO_SECONDS = Math.round((2 * 44100) / 1024); // 86 frames
const audio = (kind: "sound" | "silent") => new Uint8Array(Array.from({ length: TWO_SECONDS }, () => frame(kind === "silent" ? 22 : 380)).flat());

function recording(pattern: Array<"sound" | "silent">) {
  const segments: HlsSegment[] = pattern.map((_, i) => ({ url: `https://x.test/r/seg_${i}.ts`, duration: 2, offset: i * 2 }));
  const readAudio = async (s: HlsSegment) => audio(pattern[segments.indexOf(s)]);
  return { segments, readAudio };
}

/** Clips of four segments, a pause looked for up to three back. */
const LIMITS: RunLimits = { clipSeconds: 8, pauseReach: 3, startBeforeMs: 180_000, hardStopMs: 280_000 };
const fresh = (): TranscriptProgress => readProgress(null, "test");

/** A model that answers one line a clip, and remembers what it was asked. */
function model(answer: (call: number, clipSeconds: number) => ClipLine[] = (n) => [{ t: 1, e: 3, text: `Clip ${n}.` }]) {
  const calls: number[] = [];
  const transcribe = async (_aac: Uint8Array, clipSeconds: number) => {
    calls.push(clipSeconds);
    return { lines: answer(calls.length, clipSeconds), model: "stand-in" };
  };
  return { calls, transcribe };
}

describe("one run of the transcript job", () => {
  it("does a short recording in one go, clip by clip", async () => {
    const { segments, readAudio } = recording(Array(10).fill("sound"));
    const m = model();
    const progress = fresh();
    const saves: number[] = [];
    const run = await transcribeClips({ segments, progress, readAudio, transcribe: m.transcribe, save: async (p) => void saves.push(p.next), elapsed: () => 0, limits: LIMITS });
    expect(run).toEqual({ progressed: true, error: null });
    expect(progress.next).toBe(10);
    expect(progress.clips.map((c) => [c.from, c.to])).toEqual([[0, 4], [4, 8], [8, 10]]);
    expect(saves).toEqual([4, 8, 10]); // saved after every clip
    // each line is timed from the start of the video, not of its clip
    expect(progress.clips.flatMap((c) => c.lines)).toEqual([
      { t: 1, e: 3, text: "Clip 1." },
      { t: 9, e: 11, text: "Clip 2." },
      { t: 17, e: 19, text: "Clip 3." },
    ]);
    expect(progress.model).toBe("stand-in");
  });

  it("stops when its time is up, and the next run carries on from there", async () => {
    const { segments, readAudio } = recording(Array(12).fill("sound"));
    const m = model();
    const progress = fresh();
    // every clip takes 100 seconds; no clip starts after 180
    let clock = 0;
    const first = await transcribeClips({ segments, progress, readAudio, transcribe: async (a, s) => { clock += 100_000; return m.transcribe(a, s); }, save: async () => {}, elapsed: () => clock, limits: LIMITS });
    expect(first).toEqual({ progressed: true, error: null });
    expect(progress.next).toBe(8);

    // the row is read back in the next run
    const resumed = readProgress(JSON.parse(JSON.stringify(progress)), "test");
    const second = await transcribeClips({ segments, progress: resumed, readAudio, transcribe: m.transcribe, save: async () => {}, elapsed: () => 0, limits: LIMITS });
    expect(second).toEqual({ progressed: true, error: null });
    expect(resumed.next).toBe(12);
    expect(m.calls).toHaveLength(3); // no clip done twice
    expect(resumed.clips.flatMap((c) => c.lines.map((l) => l.text))).toEqual(["Clip 1.", "Clip 2.", "Clip 3."]);
  });

  it("keeps the clips before one that fails, and says why it stopped", async () => {
    const { segments, readAudio } = recording(Array(12).fill("sound"));
    const progress = fresh();
    let calls = 0;
    const run = await transcribeClips({
      segments,
      progress,
      readAudio,
      transcribe: async () => {
        if (++calls === 2) throw new Error("gemini_503: overloaded");
        return { lines: [{ t: 1, text: "Kept." }], model: "stand-in" };
      },
      save: async () => {},
      elapsed: () => 0,
      limits: LIMITS,
    });
    expect(run.progressed).toBe(true);
    expect(run.error).toMatch(/gemini_503/);
    expect(progress.next).toBe(4);
    expect(progress.clips).toHaveLength(1);
  });

  it("reports a run that got nowhere", async () => {
    const { segments } = recording(Array(4).fill("sound"));
    const progress = fresh();
    const run = await transcribeClips({
      segments,
      progress,
      readAudio: async () => {
        throw new Error("segment_fetch_429");
      },
      transcribe: model().transcribe,
      save: async () => {},
      elapsed: () => 0,
      limits: LIMITS,
    });
    expect(run).toEqual({ progressed: false, error: "segment_fetch_429" });
    expect(progress.next).toBe(0);
  });

  it("never hands the model silence, and keeps nothing it says over silence", async () => {
    // eight silent seconds, then a clip with sound only in its first two
    const { segments, readAudio } = recording(["silent", "silent", "silent", "silent", "sound", "silent", "silent", "silent"]);
    const m = model(() => [
      { t: 1, text: "Said." },
      { t: 6.5, text: "Thanks for watching." },
      { t: 7, text: "Made up over silence." },
    ]);
    const progress = fresh();
    await transcribeClips({ segments, progress, readAudio, transcribe: m.transcribe, save: async () => {}, elapsed: () => 0, limits: { ...LIMITS, pauseReach: 0 } });
    expect(m.calls).toHaveLength(1); // the silent clip was never sent
    expect(progress.clips[0].lines).toEqual([]);
    expect(progress.clips[1].lines.map((l) => l.text)).toEqual(["Said."]);
    expect(progress.next).toBe(8);
  });

  it("cuts a clip at a pause when one is in reach", async () => {
    // someone stops for two seconds a little before the planned cut
    const { segments, readAudio } = recording(["sound", "sound", "silent", "sound", "sound", "sound", "sound", "sound"]);
    const progress = fresh();
    await transcribeClips({ segments, progress, readAudio, transcribe: model().transcribe, save: async () => {}, elapsed: () => 0, limits: LIMITS });
    expect(progress.clips[0]).toMatchObject({ from: 0, to: 3 });
    expect(progress.clips[1].from).toBe(3);
    expect(progress.next).toBe(8);
  });

  it("works a recording in clips of about four minutes by default", () => {
    expect(RUN_LIMITS.clipSeconds).toBe(240);
    expect(RUN_LIMITS.startBeforeMs).toBeLessThan(RUN_LIMITS.hardStopMs);
    expect(RUN_LIMITS.hardStopMs).toBeLessThan(300_000); // a function's five minutes
  });
});

describe("the finished transcript: each line's time and speaker", () => {
  const STARTED = Date.parse("2026-10-07T18:00:00.000Z"); // the recorder was asked for
  const FIRST_FRAME = "2026-10-07T18:00:04.000Z"; // filming began four seconds later
  const playlist = ["#EXTM3U", `#EXT-X-PROGRAM-DATE-TIME:${FIRST_FRAME}`, "#EXTINF:30.0,", "a.ts", "#EXT-X-ENDLIST"].join("\n");
  const timeline = parseTimeline(playlist);
  const wall = (videoSeconds: number) => Date.parse(FIRST_FRAME) + videoSeconds * 1000;
  const ANA = "11111111-1111-4111-8111-111111111111";
  const BEN = "22222222-2222-4222-8222-222222222222";
  const progress: TranscriptProgress = {
    v: 1,
    sig: "test",
    next: 15,
    clips: [
      { from: 0, to: 8, lines: [{ t: 2, e: 5, text: "I'd start with the cost." }, { t: 6, e: 9.5, text: "That's not what the study says." }] },
      { from: 8, to: 15, lines: [{ t: 12, text: "Fair, but look at the second year." }] },
    ],
  };

  it("times lines from when the recording was asked for, the way the replay page reads them", () => {
    const lines = timeAndName({ progress, timeline, startedAtMs: STARTED, spans: [], solo: null, utterances: [] });
    expect(lines.map((l) => l.offset_seconds)).toEqual([6, 10, 16]); // video time + the four seconds
    expect(lines[0].end_seconds).toBe(9);
    expect(lines.map((l) => l.user_id)).toEqual([null, null, null]);
  });

  it("names each line from the recorder's note of who was speaking", () => {
    const spans = [
      { user_id: ANA, from: wall(1.8), to: wall(5.4) },
      { user_id: BEN, from: wall(6.3), to: wall(10) },
      { user_id: ANA, from: wall(12.2), to: wall(15) },
    ];
    const lines = timeAndName({ progress, timeline, startedAtMs: STARTED, spans, solo: null, utterances: [] });
    expect(lines.map((l) => l.user_id)).toEqual([ANA, BEN, ANA]);
  });

  it("names every line after the one person on the stage", () => {
    const lines = timeAndName({ progress, timeline, startedAtMs: STARTED, spans: [], solo: BEN, utterances: [] });
    expect(lines.map((l) => l.user_id)).toEqual([BEN, BEN, BEN]);
  });

  it("still works for a recording that carries no clock", () => {
    const bare = parseTimeline(["#EXTM3U", "#EXTINF:30.0,", "a.ts"].join("\n"));
    const lines = timeAndName({ progress, timeline: bare, startedAtMs: STARTED, spans: [{ user_id: ANA, from: STARTED + 1500, to: STARTED + 5500 }], solo: null, utterances: [] });
    expect(lines.map((l) => l.offset_seconds)).toEqual([2, 6, 12]);
    expect(lines[0].user_id).toBe(ANA); // the notes are matched from the stamp instead
  });
});
