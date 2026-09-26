import { describe, it, expect } from "vitest";
import { onOrchestraFloor, orchestraFloorGeometry } from "./AgoraScene3D";

/* The grass around the tablet skips the orchestra's stone floor using
   onOrchestraFloor. If the floor ever moves, this is what says so. */
describe("the orchestra floor check", () => {
  const pos = orchestraFloorGeometry().attributes.position;

  it("covers every point of the floor that is actually built", () => {
    for (let i = 0; i < pos.count; i++) {
      expect(onOrchestraFloor(pos.getX(i), pos.getZ(i), 1e-6)).toBe(true);
    }
  });

  it("the floor is the half in front of the tablet, and nothing else", () => {
    // Its far edge reaches out in front…
    let front = 0;
    for (let i = 0; i < pos.count; i++) front = Math.max(front, pos.getZ(i));
    expect(front).toBeGreaterThan(9.9);
    // …and none of it lies behind, under the bowl.
    for (let i = 0; i < pos.count; i++) expect(pos.getZ(i)).toBeGreaterThan(-1e-6);
    expect(onOrchestraFloor(0, 5)).toBe(true);
    expect(onOrchestraFloor(0, -5)).toBe(false);
    expect(onOrchestraFloor(0, 10.5)).toBe(false);
  });

  it("a margin keeps anything near the edge off it too", () => {
    expect(onOrchestraFloor(0, -0.1)).toBe(false);
    expect(onOrchestraFloor(0, -0.1, 0.25)).toBe(true);
    expect(onOrchestraFloor(10.1, 0.5, 0.25)).toBe(true);
  });
});
