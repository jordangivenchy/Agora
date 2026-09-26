// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { SKY_SPLASH_JS } from "./skySplash";

/* The sky is plain script text inlined in the page's head; here it runs
   in a jsdom window with a stand-in 2D context and a hand-cranked
   animation frame, so a page load can be played out step by step. */
let frames: FrameRequestCallback[] = [];
const crank = () => { const due = frames; frames = []; due.forEach((f) => f(performance.now())); };

beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, key) => (key === "canvas" ? undefined : () => {}), set: () => true });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 100 });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  window.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
  window.cancelAnimationFrame = () => {};
  (0, eval)(SKY_SPLASH_JS);
});

beforeEach(() => {
  frames = [];
  document.body.innerHTML = "";
  sessionStorage.clear();
  delete window.__agoraSkySession;
  window.__agoraSkyLiveCount = 0;
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
});

const canvases = () => {
  const a = document.createElement("canvas"), b = document.createElement("canvas");
  document.body.append(a, b);
  return [a, b] as const;
};

describe("the loading sky", () => {
  it("draws at the screen's own resolution, up to 3x", () => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 3 });
    const [a, b] = canvases();
    window.__agoraSky!(a, b, null);
    expect(a.width).toBe(window.innerWidth * 3);
    document.body.innerHTML = "";
    delete window.__agoraSkySession;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 4 });
    const [c, d] = canvases();
    window.__agoraSky!(c, d, null);
    expect(c.width).toBe(window.innerWidth * 3);
  });

  it("a screen that only continues, with nothing to continue, stays idle", () => {
    const [a, b] = canvases();
    const sky = window.__agoraSky!(a, b, null, { carry: true, only: true });
    expect(sky.idle).toBe(true);
    expect(a.dataset.live).toBeUndefined();
    expect(window.__agoraSkySession).toBeUndefined();
  });

  it("carries across a page load: the same stars, on the same clock, taken once", () => {
    const [a, b] = canvases();
    window.__agoraSky!(a, b, null);
    crank(); // the first painted frame starts the clock
    const before = window.__agoraSkySession!;
    window.__agoraSkyCarry!();
    expect(sessionStorage.getItem("ag-sky-carry")).not.toBeNull();

    // The next document: nothing of this one survives but sessionStorage.
    document.body.innerHTML = "";
    delete window.__agoraSkySession;
    window.__agoraSkyLiveCount = 0;
    const [c, d] = canvases();
    const sky = window.__agoraSky!(c, d, null, { carry: true, only: true });
    expect(sky.idle).toBeUndefined();
    const after = window.__agoraSkySession!;
    expect(after.seed).toBe(before.seed);
    expect(after.stars!.length).toBe(before.stars!.length);
    expect(after.start).not.toBeNull();
    expect(sky.elapsed).toBeGreaterThanOrEqual(0);
    expect(sessionStorage.getItem("ag-sky-carry")).toBeNull();
  });

  it("ignores a carry that has gone stale", () => {
    sessionStorage.setItem("ag-sky-carry", JSON.stringify({ seed: 7, w: 1024, h: 768, speed: 1.3, ramp: 0.2, wall: Date.now() - 40000, at: Date.now() - 30000 }));
    const [a, b] = canvases();
    expect(window.__agoraSky!(a, b, null, { carry: true, only: true }).idle).toBe(true);
  });

  it("a later screen in the same page picks up the live sky", () => {
    const [a, b] = canvases();
    const first = window.__agoraSky!(a, b, null, { carry: true, only: true });
    expect(first.idle).toBe(true);
    const [c, d] = canvases();
    window.__agoraSky!(c, d, null); // the room's entering screen, for a link opened cold
    const seed = window.__agoraSkySession!.seed;
    const [e, f] = canvases();
    expect(window.__agoraSky!(e, f, null, { carry: true, only: true }).idle).toBeUndefined();
    expect(window.__agoraSkySession!.seed).toBe(seed);
  });

  it("entering a room brings the sky up over the page, then carries it and goes", () => {
    window.__agoraEnter!("#entered");
    const screen = document.querySelector(".ld-enter");
    expect(screen).not.toBeNull();
    expect(screen!.querySelectorAll("canvas.ld-sky").length).toBe(2);
    expect(sessionStorage.getItem("ag-sky-carry")).toBeNull(); // not before it is on screen
    crank();
    crank();
    expect(sessionStorage.getItem("ag-sky-carry")).not.toBeNull();
    expect(window.location.hash).toBe("#entered");
  });

  it("a room opened in the app takes the sky over from the page, and that one steps aside", () => {
    window.__agoraSkyOver!();
    const over = document.querySelector(".ld-enter[data-over]");
    expect(over).not.toBeNull();
    crank(); // on screen, turning
    const seed = window.__agoraSkySession!.seed;
    // The room's first screen mounts in the same document: only continuing.
    const [a, b] = canvases();
    const sky = window.__agoraSky!(a, b, null, { carry: true, only: true });
    expect(sky.idle).toBeUndefined();
    expect(window.__agoraSkySession!.seed).toBe(seed);
    expect(over!.isConnected).toBe(true); // until the room's screen has painted
    crank();
    crank();
    expect(over!.isConnected).toBe(false);
    expect(window.__agoraSkySession!.live).toBe(1); // the room's screen alone
    expect(sessionStorage.getItem("ag-sky-carry")).toBeNull(); // nothing to carry: one document
  });

  it("a sky brought up over the page that nothing takes over fades away", () => {
    const timers: Array<() => void> = [];
    const realSet = window.setTimeout;
    window.setTimeout = ((f: () => void) => { timers.push(f); return timers.length; }) as unknown as typeof window.setTimeout;
    try {
      window.__agoraSkyOver!();
      const over = document.querySelector(".ld-enter[data-over]") as HTMLElement;
      timers.shift()!(); // fifteen seconds on
      expect(over.style.opacity).toBe("0");
      timers.shift()!(); // the fade done
      expect(over.isConnected).toBe(false);
      expect(window.__agoraSkySession!.live).toBe(0);
    } finally {
      window.setTimeout = realSet;
    }
  });
});
