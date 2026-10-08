// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/* The once-only "agree to the terms" check that runs on every page.
   Everything it touches is a stand-in: the path, who is signed in, what
   the server says, and where the browser is sent. */
const world = {
  ready: true,
  path: "/settings",
  search: "",
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  answer: { data: null as unknown, error: null as unknown },
  lookups: 0,
};
const replace = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => world.path }));
vi.mock("@/components/agora/legal", async (original) => ({
  ...(await original<typeof import("@/components/agora/legal")>()),
  legalReady: () => world.ready,
}));
vi.mock("@/lib/session", () => ({ sessionUser: async () => ({ data: { user: world.user }, error: null }) }));
vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => {
        world.lookups++;
        return world.answer;
      },
    };
    return { from: () => chain };
  },
}));

import TermsBoot from "./TermsBoot";
import { LEGAL } from "@/components/agora/legal";

let host: HTMLDivElement;
let root: Root;
const realLocation = window.location;

async function open(path: string, search = "") {
  world.path = path;
  world.search = search;
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, pathname: path, search, replace } });
  await act(async () => {
    root.render(createElement(TermsBoot));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  replace.mockReset();
  Object.assign(world, { ready: true, path: "/settings", search: "", user: { id: "11111111-1111-4111-8111-111111111111" }, answer: { data: null, error: null }, lookups: 0 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

describe("asking a signed-in person to agree to the terms, once", () => {
  it("sends someone who hasn't agreed to the agreement page, and remembers where they were", async () => {
    await open("/replays/abc", "?t=30");
    expect(replace).toHaveBeenCalledWith("/agree?next=" + encodeURIComponent("/replays/abc?t=30"));
  });

  it("leaves alone someone who has agreed, and doesn't ask the server again", async () => {
    world.answer = { data: { accepted_at: "2026-10-07T22:10:00Z" }, error: null };
    await open("/settings");
    expect(replace).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("agora:terms")!)).toEqual({ [world.user!.id]: LEGAL.version });
    await open("/feed");
    expect(world.lookups).toBe(1);
  });

  it("never sends anyone away because the lookup failed", async () => {
    world.answer = { data: null, error: { message: "relation does not exist" } };
    await open("/settings");
    expect(replace).not.toHaveBeenCalled();
  });

  it("asks nothing of someone who isn't signed in", async () => {
    world.user = null;
    await open("/");
    expect(world.lookups).toBe(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("never asks on the documents, the agreement page or the way in", async () => {
    for (const path of ["/terms", "/privacy", "/agree", "/login", "/auth/callback", "/beta"]) {
      await open(path);
    }
    expect(world.lookups).toBe(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("leaves the recorder's page alone", async () => {
    await open("/agora/90dabdf2-c208-46c9-8417-b5070fba44a0", "?layout=speaker&rk=1.x&token=t&url=wss%3A%2F%2Fx");
    expect(world.lookups).toBe(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("asks before a room all the same", async () => {
    await open("/agora/90dabdf2-c208-46c9-8417-b5070fba44a0");
    expect(replace).toHaveBeenCalledWith("/agree?next=" + encodeURIComponent("/agora/90dabdf2-c208-46c9-8417-b5070fba44a0"));
  });

  it("does nothing at all while the terms are still a draft", async () => {
    world.ready = false;
    await open("/settings");
    expect(world.lookups).toBe(0);
    expect(replace).not.toHaveBeenCalled();
  });
});
