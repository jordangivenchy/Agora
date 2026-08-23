import { describe, expect, it } from "vitest";
import { isUserIdentity, planWebhook } from "../roomLifecycle";

const ROOM = "3f2b7c1a-9d4e-4f6b-8a2c-1e5d7b9f0a3c";
const USER = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

describe("isUserIdentity", () => {
  it("accepts a Supabase user uuid", () => {
    expect(isUserIdentity(USER)).toBe(true);
  });
  it("rejects guest identities and junk", () => {
    expect(isUserIdentity("guest-a1b2c3d4")).toBe(false);
    expect(isUserIdentity("")).toBe(false);
    expect(isUserIdentity(undefined)).toBe(false);
    expect(isUserIdentity(`${USER}x`)).toBe(false);
  });
});

describe("planWebhook", () => {
  it("maps participant_left for a signed-in user", () => {
    expect(planWebhook("participant_left", ROOM, USER)).toEqual({
      action: "participant_left",
      roomId: ROOM,
      userId: USER,
    });
  });

  it("ignores guests leaving (no participant row to stamp)", () => {
    expect(planWebhook("participant_left", ROOM, "guest-xy12")).toEqual({
      action: "ignore",
    });
  });

  it("maps participant_joined for a signed-in user", () => {
    expect(planWebhook("participant_joined", ROOM, USER)).toEqual({
      action: "participant_joined",
      roomId: ROOM,
      userId: USER,
    });
  });

  it("maps room_finished regardless of identity", () => {
    expect(planWebhook("room_finished", ROOM, undefined)).toEqual({
      action: "room_finished",
      roomId: ROOM,
    });
  });

  it("ignores rooms whose LiveKit name is not a debate room uuid", () => {
    expect(planWebhook("participant_left", "not-a-room", USER)).toEqual({
      action: "ignore",
    });
    expect(planWebhook("room_finished", undefined, undefined)).toEqual({
      action: "ignore",
    });
  });

  it("ignores unrelated events", () => {
    expect(planWebhook("track_published", ROOM, USER)).toEqual({
      action: "ignore",
    });
  });
});
