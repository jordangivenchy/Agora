import { describe, expect, it } from "vitest";
import { heardAt, soundSeconds } from "./replayTranscribe";

/* An ADTS frame of `length` bytes (header included) at 44.1 kHz, one raw block. */
function frame(length: number): number[] {
  const f = new Array(length).fill(0);
  f[0] = 0xff;
  f[1] = 0xf1;
  f[2] = (1 << 6) | (4 << 2); // AAC-LC, 44.1 kHz
  f[3] = (2 << 6) | ((length >> 11) & 0x03); // stereo
  f[4] = (length >> 3) & 0xff;
  f[5] = ((length & 0x07) << 5) | 0x1f;
  f[6] = 0xfc; // one raw data block
  return f;
}
const FPS = 44100 / 1024; // ≈ 43 frames a second
const clip = (pattern: Array<"silent" | "sound">) =>
  new Uint8Array(pattern.flatMap((p) => Array.from({ length: Math.ceil(FPS) }, () => frame(p === "silent" ? 22 : 380))).flat());

describe("sound in a recording, from AAC frame sizes", () => {
  it("finds nothing in digital silence", () => {
    const sound = soundSeconds(clip(["silent", "silent", "silent", "silent"]));
    expect(sound.length).toBeGreaterThanOrEqual(4);
    expect(sound.some(Boolean)).toBe(false);
  });

  it("marks the seconds that carry sound", () => {
    const sound = soundSeconds(clip(["silent", "silent", "sound", "silent", "silent", "silent", "silent", "silent", "silent", "silent"]));
    expect(sound.slice(0, 3)).toEqual([false, false, true]);
    // 44 frames are a touch over a second, so the sound spills into the next one — and no further
    expect(sound.slice(4).some(Boolean)).toBe(false);
  });

  it("keeps a line only where there was sound around its start", () => {
    const sound = soundSeconds(clip(["silent", "silent", "sound", "silent", "silent", "silent", "silent", "silent", "silent", "silent"]));
    expect(heardAt(sound, 2.4)).toBe(true);
    expect(heardAt(sound, 0.5)).toBe(true); // speech starting a beat after the stamp
    expect(heardAt(sound, 8.2)).toBe(false);
  });

  it("skips bytes that aren't frames", () => {
    const junk = new Uint8Array([1, 2, 3, ...frame(400), 9, 9, ...frame(22)]);
    expect(soundSeconds(junk)).toEqual([true]);
  });
});
