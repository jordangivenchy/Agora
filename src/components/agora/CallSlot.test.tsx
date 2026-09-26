// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

/* The call slot keeps a room — and its call — through in-app page
   changes, minimized while another page shows, and lets it go only when
   you leave. The room here is a stand-in that reports what the slot
   tells it and how often it has been mounted. */
const nav = vi.hoisted(() => ({ path: "/agora/room-1", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: nav.push }),
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
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  nav.push.mockReset();
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

  it("minimizes to the last page browsed, and opens back into the room", () => {
    act(() => slot().minimize());
    expect(nav.push).toHaveBeenLastCalledWith("/"); // nothing browsed yet: home
    at("/communities/c-1");
    act(() => slot().expand());
    expect(nav.push).toHaveBeenLastCalledWith("/agora/room-1");
    at("/agora/room-1");
    act(() => slot().minimize());
    expect(nav.push).toHaveBeenLastCalledWith("/communities/c-1");
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

  it("coming back to the room after leaving it is a fresh visit", () => {
    act(() => slot().leave("/"));
    at("/");
    at("/agora/room-1");
    expect(shown()?.dataset.minimized).toBe("false");
    expect(room.mounts).toBe(2);
  });
});
