// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HlsBroadcastSurface, turnSoundOn } from "./HlsPlayer";

/* The broadcast has one voice: the minimized room keeps its own surface
   (and its sound), seen in the call card's window but out of reach
   there, so the card's sound button turns that sound on from outside. */
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  HTMLMediaElement.prototype.canPlayType = () => "maybe"; // native HLS: no hls.js in the test
});

let root: Root;
beforeEach(() => {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

const videos = () => [...document.querySelectorAll("video")];
const unmuteButtons = () => [...document.querySelectorAll("button")].filter((b) => b.textContent?.includes("Tap to unmute"));

describe("the broadcast surface", () => {
  it("starts muted, and the sound turned on from outside it (the call card) reaches it", () => {
    act(() => root.render(createElement(HlsBroadcastSurface, { src: "https://example.test/live.m3u8" })));
    const [room] = videos();
    expect(room.muted).toBe(true); // autoplay starts muted
    expect(unmuteButtons().length).toBe(1);
    act(() => turnSoundOn()); // the card's sound button
    expect(room.muted).toBe(false);
    expect(unmuteButtons().length).toBe(0); // the sound is on everywhere now
  });

  it("a surface that mounts after the sound is on starts with it on", () => {
    act(() => root.render(createElement(HlsBroadcastSurface, { src: "https://example.test/live.m3u8" })));
    expect(videos()[0].muted).toBe(false); // on from the earlier tap, for the page
  });
});
