import { describe, it, expect } from "vitest";
import { ENTER_AFTER_MS, QUIET_FOR_MS, planSlots, type SlotPerson } from "./gallerySlots";

const NAMES = ["Jordan", "Red", "Alan", "Mia", "Noah", "Ava", "Leo", "Zoe", "Eli", "Ivy", "Max", "Uma", "Kai"];
const T = 1_000_000;
const stage = (n: number, patch: (p: SlotPerson, i: number) => Partial<SlotPerson> = () => ({})): SlotPerson[] =>
  NAMES.slice(0, n).map((key, i) => {
    const base: SlotPerson = { key, speakingSince: null, lastSpoke: 0, cameraOn: i < 6, local: false, host: i === 0, join: i };
    return { ...base, ...patch(base, i) };
  });

describe("gallery slots", () => {
  it("moves nobody while everyone fits", () => {
    const people = stage(9, (_, i) => (i === 8 ? { speakingSince: T - 9000, lastSpoke: T } : {}));
    expect(planSlots(["Eli", "Jordan"], people, 9, null, T)).toEqual({ shown: NAMES.slice(0, 9), hidden: [] });
  });

  it("keeps the last place for +N and fills the rest by priority", () => {
    const { shown, hidden } = planSlots([], stage(13), 9, null, T);
    expect(shown).toHaveLength(8);
    expect(hidden).toHaveLength(5);
    expect(shown.slice(0, 6)).toEqual(NAMES.slice(0, 6)); // cameras on first
  });

  it("lets someone behind +N in after 3 seconds of talking, in the quietest window's spot", () => {
    const start = planSlots([], stage(13), 9, null, T).shown;
    const talking = (since: number) => stage(13, (p) => (p.key === "Ivy" ? { speakingSince: since, lastSpoke: T + ENTER_AFTER_MS } : {}));
    expect(planSlots(start, talking(T + ENTER_AFTER_MS - 1000), 9, null, T + ENTER_AFTER_MS).shown).toEqual(start);
    const after = planSlots(start, talking(T), 9, null, T + ENTER_AFTER_MS).shown;
    const i = after.indexOf("Ivy");
    expect(i).toBeGreaterThanOrEqual(0);
    after.forEach((k, j) => { if (j !== i) expect(k).toBe(start[j]); });
  });

  it("never takes the window of someone who talked in the last 8 seconds", () => {
    const start = planSlots([], stage(13), 9, null, T).shown;
    const now = T + QUIET_FOR_MS;
    const people = stage(13, (p) => (start.includes(p.key) ? { lastSpoke: now - 1000 } : p.key === "Ivy" ? { speakingSince: now - 5000, lastSpoke: now } : {}));
    expect(planSlots(start, people, 9, null, now).shown).toEqual(start);
  });

  it("brings in a camera turning on over a quiet camera-off window", () => {
    const start = planSlots([], stage(13), 9, null, T).shown;
    const people = stage(13, (p) => (p.key === "Kai" ? { cameraOn: true } : {}));
    const next = planSlots(start, people, 9, null, T + 100).shown;
    expect(next).toContain("Kai");
    const gone = start.find((k) => !next.includes(k))!;
    expect(people.find((p) => p.key === gone)!.cameraOn).toBe(false);
  });

  it("always shows the pin and yourself", () => {
    const start = planSlots([], stage(13), 9, null, T).shown;
    const people = stage(13, (p) => (p.key === "Max" ? { local: true } : {}));
    const next = planSlots(start, people, 9, "Uma", T + 100).shown;
    expect(next).toContain("Uma");
    expect(next).toContain("Max");
  });

  it("settles: planning again from its own answer changes nothing", () => {
    const scenes: [SlotPerson[], number, string | null][] = [
      [stage(13), 9, null],
      [stage(13, (p) => (p.key === "Ivy" ? { speakingSince: T - 5000, lastSpoke: T } : p.key === "Kai" ? { cameraOn: true } : {})), 9, null],
      [stage(13, (p) => (p.key === "Max" ? { local: true } : {})), 5, "Uma"],
    ];
    for (const [people, places, pin] of scenes) {
      const once = planSlots([], people, places, pin, T + QUIET_FOR_MS);
      expect(planSlots(once.shown, people, places, pin, T + QUIET_FOR_MS)).toEqual(once);
    }
  });

  it("gives a leaver's spot to the next in line without shifting anyone", () => {
    const start = planSlots([], stage(13), 9, null, T).shown;
    const people = stage(13).filter((p) => p.key !== "Alan");
    const next = planSlots(start, people, 9, null, T + 100).shown;
    const spot = start.indexOf("Alan");
    next.forEach((k, j) => { if (j !== spot) expect(k).toBe(start[j]); });
    expect(next[spot]).not.toBe("Alan");
  });
});
