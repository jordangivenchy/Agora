import { describe, it, expect } from "vitest";
import { quietFaceSize, quietFaces, splitQuiet } from "./quietFaces";

interface QuietTile { key: string; identity: string; source: "camera" | "screen"; cameraOn: boolean }
const pictured = (t: QuietTile) => t.source === "screen" || t.cameraOn;

const cam = (id: string, on: boolean): QuietTile => ({ key: `${id}:cam`, identity: id, source: "camera", cameraOn: on });
const screen = (id: string): QuietTile => ({ key: `${id}:screen`, identity: id, source: "screen", cameraOn: true });
const ids = (list: QuietTile[]) => list.map((t) => t.identity).join(",");

describe("people without a camera, beside the windows", () => {
  it("gives the windows to the pictures once anyone has one", () => {
    const { windows, quiet } = splitQuiet([cam("a", true), cam("b", false), cam("c", true), cam("d", false)], pictured, null, true);
    expect(ids(windows)).toBe("a,c");
    expect(ids(quiet)).toBe("b,d");
  });

  it("leaves everyone a window when nobody has a picture", () => {
    const all = [cam("a", false), cam("b", false)];
    expect(splitQuiet(all, pictured, null, true)).toEqual({ windows: all, quiet: [] });
  });

  it("counts a shared screen as a picture", () => {
    const { windows, quiet } = splitQuiet([screen("a"), cam("a", false), cam("b", false)], pictured, null, true);
    expect(windows.map((t) => t.key)).toEqual(["a:screen"]);
    expect(ids(quiet)).toBe("a,b");
  });

  it("keeps a window for someone the viewer keeps in view", () => {
    const { windows, quiet } = splitQuiet([cam("a", true), cam("b", false), cam("c", false)], pictured, "b:cam", true);
    expect(ids(windows)).toBe("a,b");
    expect(ids(quiet)).toBe("c");
  });

  it("does nothing when the viewer turned it off", () => {
    const all = [cam("a", true), cam("b", false)];
    expect(splitQuiet(all, pictured, null, false)).toEqual({ windows: all, quiet: [] });
  });

  it("shows the first few faces and folds the rest behind a count", () => {
    const quiet = ["a", "b", "c", "d", "e", "f", "g"].map((id) => cam(id, false));
    const { shown, more } = quietFaces(quiet, new Set(), 5);
    expect(ids(shown)).toBe("a,b,c,d,e");
    expect(ids(more)).toBe("f,g");
  });

  it("always shows whoever is talking", () => {
    const quiet = ["a", "b", "c", "d", "e", "f", "g"].map((id) => cam(id, false));
    const { shown, more } = quietFaces(quiet, new Set(["g", "b"]), 5);
    expect(shown.map((t) => t.identity)).toContain("g");
    expect(shown.map((t) => t.identity)).toContain("b");
    expect(shown).toHaveLength(5);
    expect(more).toHaveLength(2);
    /* Everyone is still somewhere, once. */
    expect([...shown, ...more].map((t) => t.identity).sort().join(",")).toBe("a,b,c,d,e,f,g");
  });

  it("sizes a face to the picture it sits in", () => {
    expect(quietFaceSize(366, 500)).toBe(40);
    expect(quietFaceSize(1126, 470)).toBe(42);
    expect(quietFaceSize(993, 1340)).toBe(72);
  });
});
