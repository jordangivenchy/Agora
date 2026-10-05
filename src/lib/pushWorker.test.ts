import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/* public/push-sw.js, run against a stand-in for the worker's world: its
   listeners caught, the windows it finds and the notifications it shows
   recorded. */

type Win = {
  url: string;
  focused: boolean;
  visibilityState: "visible" | "hidden";
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  answers: boolean;
};

function win(over: Partial<Win> = {}): Win {
  const w: Win = {
    url: "https://agorasphere.net/home",
    focused: false,
    visibilityState: "hidden",
    focus: vi.fn(async () => w),
    postMessage: vi.fn(),
    answers: true,
    ...over,
  };
  w.postMessage = vi.fn((_msg: unknown, ports: MessagePort[]) => {
    if (w.answers) ports[0].postMessage("opened");
  });
  return w;
}

function worker(wins: Win[]) {
  const listeners = new Map<string, (e: unknown) => void>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const openWindow = vi.fn(async () => null);
  const scope = {
    location: { origin: "https://agorasphere.net" },
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    skipWaiting: vi.fn(),
    registration: {
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      }),
    },
    clients: { matchAll: vi.fn(async () => wins), openWindow },
  };
  const src = readFileSync(path.resolve(__dirname, "../../public/push-sw.js"), "utf8");
  new Function("self", "clients", src)(scope, scope.clients);

  const run = async (type: string, event: Record<string, unknown>) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
  };
  return {
    shown,
    openWindow,
    push: (data: unknown) => run("push", { data: { json: () => data } }),
    click: (data: unknown) => {
      const close = vi.fn();
      return run("notificationclick", { notification: { data, close } }).then(() => close);
    },
  };
}

describe("push-sw.js", () => {
  it("shows a push with its key, picture and the row it's about", async () => {
    const w = worker([win()]);
    await w.push({ title: "Ada is live", body: "“M” — join the amphitheater.", url: "https://agorasphere.net/agora/m-r1", tag: "live:r1", id: "n1", ts: 5 });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("Ada is live");
    expect(w.shown[0].options).toMatchObject({
      body: "“M” — join the amphitheater.",
      icon: "/mark-512.png",
      badge: "/notification-badge.png",
      tag: "live:r1",
      timestamp: 5,
      data: { url: "https://agorasphere.net/agora/m-r1", id: "n1" },
    });
  });

  it("shows nothing while the site is the window in front (the page has its pop-up)", async () => {
    const w = worker([win({ focused: true, visibilityState: "visible" })]);
    await w.push({ title: "Ada is live", body: "", url: "/" });
    expect(w.shown).toHaveLength(0);
  });

  it("hands a click to an open tab, which goes there itself, then brings it forward", async () => {
    const tab = win();
    const w = worker([tab]);
    const close = await w.click({ url: "https://agorasphere.net/posts/p1?c=2#c2", id: "n1" });
    expect(close).toHaveBeenCalled();
    expect(tab.postMessage.mock.calls[0][0]).toEqual({ type: "agora:open-notification", url: "/posts/p1?c=2#c2", id: "n1" });
    expect(tab.focus).toHaveBeenCalled();
    expect(w.openWindow).not.toHaveBeenCalled();
  });

  it("opens a new tab when the open one doesn't take it (a live room on its own page)", async () => {
    const tab = win({ answers: false });
    const w = worker([tab]);
    await w.click({ url: "/posts/p1", id: "n1" });
    expect(tab.focus).not.toHaveBeenCalled();
    expect(w.openWindow).toHaveBeenCalledWith("https://agorasphere.net/posts/p1");
  });

  it("brings the tab forward when there's nowhere to go", async () => {
    const tab = win({ answers: false });
    const w = worker([tab]);
    await w.click({ url: null, id: "n1" });
    expect(tab.focus).toHaveBeenCalled();
    expect(w.openWindow).not.toHaveBeenCalled();
  });

  it("prefers the tab in front, and opens one when none is open", async () => {
    const back = win();
    const front = win({ focused: true, visibilityState: "visible" });
    await worker([back, front]).click({ url: "/home", id: null });
    expect(front.postMessage).toHaveBeenCalled();
    expect(back.postMessage).not.toHaveBeenCalled();

    const none = worker([]);
    await none.click({ url: "/home", id: null });
    expect(none.openWindow).toHaveBeenCalledWith("https://agorasphere.net/home");
  });
});
