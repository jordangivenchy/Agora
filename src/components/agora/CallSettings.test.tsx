// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import CallSettings from "./CallSettings";

/* The call's microphone test. Once you can speak, the call holds your
   microphone muted — a live track switched off, which sounds like
   silence — so the test listens to a copy of its own and leaves the
   call's track alone. The browser's audio parts are stand-ins: a track
   that is on sounds loud, one that is off sounds like nothing. */
class FakeTrack {
  enabled: boolean;
  readyState: "live" | "ended" = "live";
  copies: FakeTrack[] = [];
  constructor(enabled: boolean) {
    this.enabled = enabled;
  }
  clone() {
    const copy = new FakeTrack(this.enabled);
    this.copies.push(copy);
    return copy;
  }
  stop() {
    this.readyState = "ended";
  }
}
class FakeStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[]) {
    this.tracks = tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
  getTracks() {
    return this.tracks;
  }
}
class FakeAudioContext {
  createMediaStreamSource(stream: FakeStream) {
    const track = stream.tracks[0];
    return {
      connect: (analyser: { track: FakeTrack | null }) => {
        analyser.track = track;
      },
    };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      track: null as FakeTrack | null,
      getByteTimeDomainData(buf: Uint8Array) {
        const loud = !!this.track && this.track.enabled && this.track.readyState === "live";
        for (let i = 0; i < buf.length; i++) buf[i] = loud ? (i % 2 ? 228 : 28) : 128;
      },
    };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

let host: HTMLDivElement;
let root: Root;
const getUserMedia = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("MediaStream", FakeStream);
  getUserMedia.mockReset();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const button = (label: RegExp) => [...host.querySelectorAll("button")].find((b) => label.test(b.textContent ?? ""))!;
const press = (label: RegExp) => act(async () => { button(label).click(); });
/* The microphone's meter is the second in the Audio section (the speaker's comes first). */
const micCellsLit = () => host.querySelectorAll(".ag-set-meter")[1]?.querySelectorAll(".is-lit").length ?? 0;

async function open(callTrack: FakeTrack | null, more: { restreamRoomId?: string | null } = {}) {
  const nothing = () => {};
  await act(async () => {
    root.render(
      createElement(CallSettings, {
        cameras: [], activeCameraId: null, onSwitchCamera: nothing,
        mics: [], activeMicId: null, onSwitchMic: nothing,
        speakers: [], activeSpeakerId: null, onSwitchSpeaker: nothing,
        outputVolume: 1, onOutputVolume: nothing,
        getMicStreamTrack: () => callTrack as unknown as MediaStreamTrack | null,
        onClose: nothing,
        ...more,
      }),
    );
  });
  /* The section's row: its label, then a chevron. */
  await press(/^Audio/);
}

describe("the call's microphone test", () => {
  it("shows a level while the call holds the mic muted, and leaves you muted", async () => {
    const muted = new FakeTrack(false);
    await open(muted);
    expect(button(/Test microphone/).disabled).toBe(false);

    await press(/Test microphone/);
    await wait(60);
    expect(micCellsLit()).toBeGreaterThan(0);
    /* It listened to a copy switched on for itself; the call's own track is as it was. */
    expect(muted.copies).toHaveLength(1);
    expect(muted.copies[0].enabled).toBe(true);
    expect(muted.enabled).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();

    await press(/Stop test/);
    expect(micCellsLit()).toBe(0);
    expect(muted.copies[0].readyState).toBe("ended");
    expect(muted.readyState).toBe("live");
    expect(muted.enabled).toBe(false);
  });

  it("opens a microphone for the test when the call has none, and closes it after", async () => {
    const own = new FakeTrack(true);
    getUserMedia.mockResolvedValue(new FakeStream([own]));
    await open(null);

    await press(/Test microphone/);
    await wait(60);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(micCellsLit()).toBeGreaterThan(0);

    await press(/Stop test/);
    expect(own.readyState).toBe("ended");
  });

  it("says why when the browser refuses the microphone", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await open(null);

    await press(/Test microphone/);
    await wait(20);
    expect(host.querySelector("[role=alert]")?.textContent).toMatch(/Mic access is blocked/);
    expect(button(/Test microphone/)).toBeTruthy();
    expect(micCellsLit()).toBe(0);
  });
});

describe("the call's settings", () => {
  const rows = () => [...host.querySelectorAll(".ag-set-rowlabel")].map((e) => e.textContent);

  it("offers Restream to the room's host and to nobody else", async () => {
    await open(null);
    expect(rows()).not.toContain("Restream");
    await open(null, { restreamRoomId: "90dabdf2-c208-46c9-8417-b5070fba44a0" });
    expect(rows()).toContain("Restream");
  });
});
