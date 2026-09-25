// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const stage = vi.hoisted(() => ({ forced: "software" as "software" | null }));
vi.mock("@/lib/stageQuality", () => ({
  useSimpleStage: () => ({ on: stage.forced !== null, chosen: false, forced: stage.forced }),
}));
import GpuNotice from "./GpuNotice";

/* The notice is for a browser drawing without its graphics card: it
   names the switch, and "Got it" puts it away for good. */
describe("GpuNotice", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  it("shows on a software renderer, and names the switch", async () => {
    stage.forced = "software";
    await act(async () => { root.render(<GpuNotice />); });
    const text = host.textContent ?? "";
    expect(text).toContain("without your graphics card");
    expect(text).toContain("Use graphics acceleration when available");
    expect(text).toContain("chrome://gpu");
  });

  it("stays away once put away", async () => {
    stage.forced = "software";
    await act(async () => { root.render(<GpuNotice />); });
    const button = host.querySelector("button");
    expect(button).not.toBeNull();
    await act(async () => { button!.click(); });
    expect(host.querySelector(".ag-gpu-notice")).toBeNull();
    expect(window.localStorage.getItem("agora:gpu-notice-read")).toBe("1");
  });

  it("has nothing to say to a browser with a GPU", async () => {
    stage.forced = null;
    await act(async () => { root.render(<GpuNotice />); });
    expect(host.querySelector(".ag-gpu-notice")).toBeNull();
  });
});
