// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HlsBroadcastSurface } from "./HlsPlayer";

/* The broadcast has one voice: the minimized room keeps its own surface
   (and its sound) while the call card shows the same broadcast silently,
   and one unmute — from either — turns that one sound on. */
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
  it("the card's silent copy never plays sound, and its unmute turns the room's on", () => {
    act(() => root.render(createElement(Fragment, null,
      createElement(HlsBroadcastSurface, { src: "https://example.test/live.m3u8" }),
      createElement(HlsBroadcastSurface, { src: "https://example.test/live.m3u8", compact: true, silent: true }),
    )));
    const [room, card] = videos();
    expect(room.muted).toBe(true); // autoplay starts muted
    expect(card.muted).toBe(true);
    expect(unmuteButtons().length).toBe(2);
    act(() => unmuteButtons()[1].click()); // the tap on the card
    expect(room.muted).toBe(false); // the room's surface carries the sound
    expect(card.muted).toBe(true); // the card stays pictures only
    expect(unmuteButtons().length).toBe(0); // the sound is on everywhere now
  });

  it("a surface that mounts after the sound is on starts with it on", () => {
    act(() => root.render(createElement(HlsBroadcastSurface, { src: "https://example.test/live.m3u8" })));
    expect(videos()[0].muted).toBe(false); // on from the earlier tap, for the page
  });
});
