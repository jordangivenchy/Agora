import { describe, expect, it } from "vitest";
import {
  DEFAULT_HAND_FAST_LANE_CAP,
  DEFAULT_HLS_AUDIENCE_THRESHOLD,
  audienceThresholdFromEnv,
  decideAudienceMode,
  handFastLaneCapFromEnv,
} from "./audienceMode";

const HLS = "https://cdn.example.com/room/live.m3u8";

describe("decideAudienceMode", () => {
  it("stage roles always get WebRTC, even in a packed room", () => {
    expect(
      decideAudienceMode({ isStage: true, audienceCount: 5000, hlsUrl: HLS, threshold: 15 })
    ).toEqual({ mode: "webrtc" });
  });

  it("audience below the threshold gets WebRTC", () => {
    expect(
      decideAudienceMode({ isStage: false, audienceCount: 14, hlsUrl: HLS, threshold: 15 })
    ).toEqual({ mode: "webrtc" });
  });

  it("audience at the threshold rides HLS", () => {
    expect(
      decideAudienceMode({ isStage: false, audienceCount: 15, hlsUrl: HLS, threshold: 15 })
    ).toEqual({ mode: "hls", url: HLS });
  });

  it("audience above the threshold rides HLS", () => {
    expect(
      decideAudienceMode({ isStage: false, audienceCount: 300, hlsUrl: HLS, threshold: 15 })
    ).toEqual({ mode: "hls", url: HLS });
  });

  it("no HLS stream → WebRTC regardless of size (fallback when egress dies)", () => {
    expect(
      decideAudienceMode({ isStage: false, audienceCount: 300, hlsUrl: null, threshold: 15 })
    ).toEqual({ mode: "webrtc" });
    expect(
      decideAudienceMode({ isStage: false, audienceCount: 300, hlsUrl: undefined, threshold: 15 })
    ).toEqual({ mode: "webrtc" });
    expect(
      decideAudienceMode({ isStage: false, audienceCount: 300, hlsUrl: "", threshold: 15 })
    ).toEqual({ mode: "webrtc" });
  });

  it("threshold 0 sends every new audience member to HLS", () => {
    expect(
      decideAudienceMode({ isStage: false, audienceCount: 0, hlsUrl: HLS, threshold: 0 })
    ).toEqual({ mode: "hls", url: HLS });
  });

  it("garbage threshold falls back to the default", () => {
    expect(
      decideAudienceMode({ isStage: false, audienceCount: 14, hlsUrl: HLS, threshold: NaN })
    ).toEqual({ mode: "webrtc" });
    expect(
      decideAudienceMode({
        isStage: false,
        audienceCount: DEFAULT_HLS_AUDIENCE_THRESHOLD,
        hlsUrl: HLS,
        threshold: -3,
      })
    ).toEqual({ mode: "hls", url: HLS });
  });
});

describe("raised-hand fast lane", () => {
  const packed = { isStage: false, audienceCount: 20000, hlsUrl: HLS, threshold: 15 };

  it("a raised hand inside the cap gets WebRTC even in a 20k room", () => {
    expect(
      decideAudienceMode({ ...packed, handQueueRank: 0, handFastLaneCap: 25 })
    ).toEqual({ mode: "webrtc" });
    expect(
      decideAudienceMode({ ...packed, handQueueRank: 24, handFastLaneCap: 25 })
    ).toEqual({ mode: "webrtc" });
  });

  it("a raised hand beyond the cap stays on HLS until the line moves", () => {
    expect(
      decideAudienceMode({ ...packed, handQueueRank: 25, handFastLaneCap: 25 })
    ).toEqual({ mode: "hls", url: HLS });
  });

  it("hand down (null rank) is unaffected by the lane", () => {
    expect(
      decideAudienceMode({ ...packed, handQueueRank: null, handFastLaneCap: 25 })
    ).toEqual({ mode: "hls", url: HLS });
  });

  it("cap 0 disables the fast lane entirely", () => {
    expect(
      decideAudienceMode({ ...packed, handQueueRank: 0, handFastLaneCap: 0 })
    ).toEqual({ mode: "hls", url: HLS });
  });

  it("garbage cap falls back to the default", () => {
    expect(
      decideAudienceMode({ ...packed, handQueueRank: DEFAULT_HAND_FAST_LANE_CAP - 1, handFastLaneCap: NaN })
    ).toEqual({ mode: "webrtc" });
    expect(
      decideAudienceMode({ ...packed, handQueueRank: DEFAULT_HAND_FAST_LANE_CAP, handFastLaneCap: -5 })
    ).toEqual({ mode: "hls", url: HLS });
  });

  it("the lane never bypasses the no-stream fallback", () => {
    expect(
      decideAudienceMode({ ...packed, hlsUrl: null, handQueueRank: 3 })
    ).toEqual({ mode: "webrtc" });
  });
});

describe("handFastLaneCapFromEnv", () => {
  it("parses a number, honoring an explicit 0", () => {
    expect(handFastLaneCapFromEnv("40")).toBe(40);
    expect(handFastLaneCapFromEnv("0")).toBe(0);
  });
  it("defaults on missing or garbage", () => {
    expect(handFastLaneCapFromEnv(undefined)).toBe(DEFAULT_HAND_FAST_LANE_CAP);
    expect(handFastLaneCapFromEnv("")).toBe(DEFAULT_HAND_FAST_LANE_CAP);
    expect(handFastLaneCapFromEnv("many")).toBe(DEFAULT_HAND_FAST_LANE_CAP);
    expect(handFastLaneCapFromEnv("-1")).toBe(DEFAULT_HAND_FAST_LANE_CAP);
  });
});

describe("audienceThresholdFromEnv", () => {
  it("parses a number", () => {
    expect(audienceThresholdFromEnv("25")).toBe(25);
    expect(audienceThresholdFromEnv("0")).toBe(0);
  });
  it("defaults on missing or garbage", () => {
    expect(audienceThresholdFromEnv(undefined)).toBe(DEFAULT_HLS_AUDIENCE_THRESHOLD);
    expect(audienceThresholdFromEnv("")).toBe(DEFAULT_HLS_AUDIENCE_THRESHOLD);
    expect(audienceThresholdFromEnv("lots")).toBe(DEFAULT_HLS_AUDIENCE_THRESHOLD);
    expect(audienceThresholdFromEnv("-1")).toBe(DEFAULT_HLS_AUDIENCE_THRESHOLD);
  });
});
