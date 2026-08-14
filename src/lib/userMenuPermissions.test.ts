import { describe, it, expect } from "vitest";
import { visibleActions, type MenuPermissionInput } from "./userMenuPermissions";

const base: MenuPermissionInput = {
  signedIn: true,
  isSelf: false,
  inRoom: false,
  targetIsDebater: false,
  targetIsSpectator: false,
  isHost: false,
  timerActive: false,
  targetHasTurn: false,
  isModerator: false,
};

describe("visibleActions", () => {
  it("own avatar shows only navigation actions", () => {
    const s = visibleActions({ ...base, isSelf: true });
    expect(s.standard).toEqual(["view_profile", "copy_link"]);
    expect(s.host).toEqual([]);
    expect(s.moderator).toEqual([]);
  });

  it("signed-out users can only view profiles and copy links", () => {
    const s = visibleActions({ ...base, signedIn: false });
    expect(s.standard).toEqual(["view_profile", "copy_link"]);
    expect(s.host).toEqual([]);
    expect(s.moderator).toEqual([]);
  });

  it("standard signed-in menu outside a room has no AV or host actions", () => {
    const s = visibleActions(base);
    expect(s.standard).toContain("follow");
    expect(s.standard).toContain("block");
    expect(s.standard).toContain("report");
    expect(s.standard).not.toContain("mute_audio");
    expect(s.host).toEqual([]);
  });

  it("local AV controls appear only for debaters in a room", () => {
    const spectator = visibleActions({ ...base, inRoom: true, targetIsSpectator: true });
    expect(spectator.standard).not.toContain("mute_audio");
    const debater = visibleActions({ ...base, inRoom: true, targetIsDebater: true });
    expect(debater.standard).toContain("mute_audio");
    expect(debater.standard).toContain("hide_camera");
  });

  it("host sees stage controls for spectators and demotion for debaters", () => {
    const spec = visibleActions({ ...base, inRoom: true, isHost: true, targetIsSpectator: true });
    expect(spec.host).toContain("host_stage_pro");
    expect(spec.host).toContain("host_kick");
    expect(spec.host).not.toContain("host_to_audience");

    const deb = visibleActions({ ...base, inRoom: true, isHost: true, targetIsDebater: true });
    expect(deb.host).toContain("host_to_audience");
    expect(deb.host).toContain("host_mute_mic");
    expect(deb.host).not.toContain("host_stage_pro");
  });

  it("turn controls depend on the timer and whose turn it is", () => {
    const noTimer = visibleActions({ ...base, inRoom: true, isHost: true, targetIsDebater: true });
    expect(noTimer.host).not.toContain("host_end_turn");
    expect(noTimer.host).not.toContain("host_give_turn");

    const theirTurn = visibleActions({
      ...base, inRoom: true, isHost: true, targetIsDebater: true,
      timerActive: true, targetHasTurn: true,
    });
    expect(theirTurn.host).toContain("host_end_turn");

    const notTheirTurn = visibleActions({
      ...base, inRoom: true, isHost: true, targetIsDebater: true,
      timerActive: true, targetHasTurn: false,
    });
    expect(notTheirTurn.host).toContain("host_give_turn");
  });

  it("host section never appears for non-hosts or outside rooms", () => {
    expect(visibleActions({ ...base, targetIsDebater: true, isHost: true }).host).toEqual([]);
    expect(
      visibleActions({ ...base, inRoom: true, targetIsDebater: true }).host
    ).toEqual([]);
  });

  it("moderator section appears only for moderators", () => {
    expect(visibleActions(base).moderator).toEqual([]);
    const mod = visibleActions({ ...base, isModerator: true });
    expect(mod.moderator).toContain("mod_panel");
    expect(mod.moderator).toContain("mod_suspend");
  });
});
