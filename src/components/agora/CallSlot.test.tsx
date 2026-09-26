// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

/* The call slot keeps a room — and its call — through in-app page
   changes, minimized while another page shows, and lets it go only when
   you leave. The room here is a stand-in that reports what the slot
   tells it and how often it has been mounted. */
const nav = vi.hoisted(() => ({ path: "/agora/room-1", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));
const room = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("./AgoraRoomPage", () => ({
  default: function StandIn() {
    const slot = (globalThis as unknown as { __useCallSlot: typeof useCallSlot }).__useCallSlot();
    useEffect(() => { room.mounts++; }, []);
    (globalThis as unknown as { __slot: CallSlotApi }).__slot = slot;
    return createElement("div", { id: "room", "data-minimized": String(slot.minimized) });
  },
}));
import CallSlot, { useCallSlot, type CallSlotApi } from "./CallSlot";
(globalThis as unknown as { __useCallSlot: typeof useCallSlot }).__useCallSlot = useCallSlot;

const params = Promise.resolve({ id: "room-1" });
const slot = () => (globalThis as unknown as { __slot: CallSlotApi }).__slot;
const shown = () => document.getElementById("room");
let root: Root;
const at = (path: string) => {
  nav.path = path;
  act(() => root.render(createElement(CallSlot, { params })));
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/agora/room-1");
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  nav.push.mockReset();
  nav.replace.mockReset();
  room.mounts = 0;
  at("/agora/room-1");
});

describe("the call slot", () => {
  it("keeps the room through a page change, minimized", () => {
    expect(shown()?.dataset.minimized).toBe("false");
    at("/communities/c-1");
    expect(shown()?.dataset.minimized).toBe("true");
    at("/users/jordan");
    expect(shown()?.dataset.minimized).toBe("true");
    expect(room.mounts).toBe(1); // never remounted: the call was never dropped
  });

  it("tells the room which page is showing", () => {
    expect(slot().path).toBe("/agora/room-1");
    at("/communities/c-1");
    expect(slot().path).toBe("/communities/c-1");
    at("/users/jordan");
    expect(slot().path).toBe("/users/jordan"); // still minimized, but a new page
  });

  it("minimizes to the last page browsed; back from the card, it lies over that page", () => {
    act(() => slot().minimize());
    expect(nav.push).toHaveBeenLastCalledWith("/"); // nothing browsed yet: home, from the server
    at("/communities/c-1");
    act(() => slot().expand(true));
    // The address follows the room back without Next navigating: the
    // page stays mounted underneath.
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/agora/room-1");
    expect((window.history.state as Record<string, unknown>).agoraRoomOver).toBe(true);
    at("/agora/room-1"); // usePathname follows the browser's history
    expect(slot().minimized).toBe(false);
    expect(slot().overPage).toBe(true);
  });

  it("over a kept page, Minimize is history: back to that page, nothing to load", () => {
    at("/communities/c-1");
    act(() => slot().expand(true));
    at("/agora/room-1");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    act(() => slot().minimize());
    expect(back).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it("opened again before the minimized-to page arrives, it stays put and calls that page off", () => {
    act(() => slot().minimize());
    expect(nav.push).toHaveBeenLastCalledWith("/"); // still on the room's address: that page is on its way
    const before = window.history.length;
    act(() => slot().expand(true));
    expect(window.history.length).toBe(before); // in place, no second history entry
    expect(window.location.pathname).toBe("/agora/room-1");
    expect(slot().overPage).toBe(false); // the room's own page is still the one under it
  });

  it("a room loaded fresh at its address has its own page under it, whatever the entry says", () => {
    act(() => root.unmount());
    // A reload of an entry the card made: the mark survives, the page under it does not.
    window.history.replaceState({ agoraRoomOver: true }, "", "/agora/room-1");
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    at("/agora/room-1");
    expect(slot().overPage).toBe(false);
    expect((window.history.state as Record<string, unknown>).agoraRoomOver).toBe(false);
  });

  it("leaving holds the room until the next page shows, then lets it go", () => {
    act(() => slot().leave("/"));
    expect(nav.push).toHaveBeenLastCalledWith("/");
    expect(shown()).not.toBeNull(); // no blank frame while home loads
    at("/");
    expect(shown()).toBeNull();
  });

  it("the card's Leave lets it go where you are", () => {
    at("/feed");
    act(() => slot().end());
    expect(shown()).toBeNull();
  });

  it("in the page's place, back from the card, it is Next's navigation to the room again", () => {
    at("/communities/c-1");
    act(() => slot().expand(false));
    expect(nav.push).toHaveBeenLastCalledWith("/agora/room-1");
    at("/agora/room-1");
    expect(slot().overPage).toBe(false);
  });

  it("coming back to the room after leaving it is a fresh visit", () => {
    act(() => slot().leave("/"));
    at("/");
    at("/agora/room-1");
    expect(shown()?.dataset.minimized).toBe("false");
    expect(room.mounts).toBe(2);
  });
});
