/* Who gets a window in the call gallery when the stage has more people
   than the grid has places — one piece of logic for the website
   (CallLayouts.tsx) and the phone app (mobile/src/roomTiles.tsx). Nine
   places: three rows of three. A screen takes its block (callGrid.ts);
   the last place becomes a "+N" window for everyone else.

   While everyone fits, nobody moves: the windows keep the order people
   came on stage and the yellow ring shows who's talking. Past that, the
   windows go to whoever matters most right now — and they change hands
   in place, one window at a time, never as a reshuffle:
   - Your pin, then you (a self-view on stage), are always in view.
   - Empty windows (at first, or when someone leaves) fill in priority
     order: talking now, talked in the last 8 seconds, camera on, host
     or co-host, then who came on stage first.
   - Someone behind "+N" who talks for 3 seconds takes the window of a
     visible person who has been quiet for 8 — the site gallery's and
     multi-speaker's timings, so a "yes" or a cough moves nobody.
   - Someone behind "+N" who turns their camera on takes the window of
     a quiet person whose camera is off.
   - The one to give up a window: the quietest — not talking, not
     recently, not the host — camera off first, then the longest quiet,
     then the latest to come on stage. If everyone in view is talking or
     pinned, the newcomer waits behind "+N". Someone leaving the stage
     hands their window to the next in line, in the same spot. */

export const ENTER_AFTER_MS = 3000;
export const QUIET_FOR_MS = 8000;

export interface SlotPerson {
  key: string;
  /** When their current stretch of talking began, or null. */
  speakingSince: number | null;
  /** When they last talked (0 if never). */
  lastSpoke: number;
  cameraOn: boolean;
  local: boolean;
  host: boolean;
  /** Order they came on stage. */
  join: number;
}

/** `places` counts the windows the people may have, the "+N" window included. */
export function planSlots(prev: string[], people: SlotPerson[], places: number, pinned: string | null, now: number): { shown: string[]; hidden: string[] } {
  const byJoin = [...people].sort((a, b) => a.join - b.join);
  if (byJoin.length <= places) return { shown: byJoin.map((p) => p.key), hidden: [] };
  const room = Math.max(0, places - 1);
  const byKey = new Map(people.map((p) => [p.key, p] as const));
  const talking = (p: SlotPerson) => p.speakingSince !== null;
  const recent = (p: SlotPerson) => now - p.lastSpoke < QUIET_FOR_MS;
  const must = (p: SlotPerson) => p.key === pinned || p.local;
  const score = (p: SlotPerson) => [p.key === pinned ? 0 : 1, p.local ? 0 : 1, talking(p) ? 0 : 1, recent(p) ? 0 : 1, p.cameraOn ? 0 : 1, p.host ? 0 : 1, p.join];
  const better = (a: SlotPerson, b: SlotPerson) => {
    const x = score(a), y = score(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };

  /* Who left keeps a hole where their window was, for the next in line. */
  let slots: (string | null)[] = prev.map((k) => (byKey.has(k) ? k : null));
  /* Fewer windows than before (a screen came up): the least wanted give theirs up, and the grid reflows. */
  if (slots.length > room) {
    let kept = slots.filter((k): k is string => k !== null);
    while (kept.length > room) {
      const worst = kept.map((k) => byKey.get(k)!).sort(better).pop()!;
      kept = kept.filter((k) => k !== worst.key);
    }
    slots = kept;
  }
  const inView = () => new Set(slots.filter((k): k is string => k !== null));
  const waiting = () => { const seen = inView(); return people.filter((p) => !seen.has(p.key)).sort(better); };
  for (const p of waiting()) {
    const hole = slots.indexOf(null);
    if (hole >= 0) slots[hole] = p.key;
    else if (slots.length < room) slots.push(p.key);
    else break;
  }
  const shown = slots.filter((k): k is string => k !== null);
  const hidden = () => { const seen = new Set(shown); return people.filter((p) => !seen.has(p.key)).sort(better); };

  for (const p of hidden()) {
    const cause = must(p) ? "must" : talking(p) && now - p.speakingSince! >= ENTER_AFTER_MS ? "talk" : p.cameraOn ? "camera" : null;
    if (!cause) continue;
    const leavers = shown
      .map((k, i) => ({ q: byKey.get(k)!, i }))
      .filter(({ q }) => {
        if (must(q)) return false;
        if (cause === "must") return true;
        if (talking(q) || recent(q)) return false;
        return cause === "talk" || !q.cameraOn;
      })
      .sort((a, b) => Number(talking(a.q)) - Number(talking(b.q)) || Number(recent(a.q)) - Number(recent(b.q)) || Number(a.q.host) - Number(b.q.host) || Number(a.q.cameraOn) - Number(b.q.cameraOn) || a.q.lastSpoke - b.q.lastSpoke || b.q.join - a.q.join);
    if (leavers.length) shown[leavers[0].i] = p.key;
  }
  return { shown, hidden: hidden().map((p) => p.key) };
}
