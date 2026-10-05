// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NotifRow } from "@/lib/notifications";

/* The bell announcing what lands: a pop-up while you're on the page, a
   system notification while you're not, and opening either. Supabase is
   a stand-in that serves `db.rows` and hands back the realtime
   listeners, so a test plays the database's part. */
const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  handlers: {} as Record<string, (p: { new: unknown }) => void>,
}));
vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => {
    const channel = {
      on: (_type: string, filter: { event: string }, handler: (p: { new: unknown }) => void) => {
        db.handlers[filter.event] = handler;
        return channel;
      },
      subscribe: () => channel,
    };
    const query = { select: () => query, eq: () => query, in: () => Promise.resolve({ data: [] }) };
    return {
      rpc: (name: string, args: unknown) => {
        db.rpc(name, args);
        return Promise.resolve({ data: name === "get_notifications" ? db.rows.map((r) => ({ ...r })) : null, error: null });
      },
      from: () => query,
      channel: () => channel,
      removeChannel: () => {},
    };
  },
}));
vi.mock("@/lib/session", () => ({ sessionUser: async () => ({ data: { user: { id: "me" } } }) }));
const nav = vi.hoisted(() => ({ goTo: vi.fn() }));
vi.mock("@/lib/softNav", () => ({ goTo: nav.goTo }));
const alerts = vi.hoisted(() => ({ raise: vi.fn(async () => {}) }));
vi.mock("@/lib/notifAlerts", () => ({ OPEN_NOTIFICATION: "agora:open-notification", raiseSystemAlert: alerts.raise }));
vi.mock("@/lib/verified", () => ({ useVerified: () => false }));
vi.mock("@/components/notifications/NotificationsPanel", () => ({ default: () => null }));
import NotificationsBell from "./NotificationsBell";

function row(over: Partial<NotifRow>): NotifRow {
  return {
    id: "n1", type: "post_comment",
    actor_id: "a1", actor_username: "ada", actor_display_name: null, actor_avatar_url: null,
    room_id: null, room_motion: null, room_status: null, room_scheduled_start: null,
    post_id: "p1", post_title: "Tax the robots", community_name: null,
    comment_id: null, comment_excerpt: null,
    meta: {}, read_at: null, created_at: "2026-10-02T10:00:00.000Z",
    ...over,
  };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const insert = async (r: NotifRow) => {
  db.rows = [r, ...db.rows.filter((x) => x.id !== r.id)];
  await act(async () => db.handlers.INSERT({ new: r }));
  await settle();
};
const update = async (r: NotifRow) => {
  db.rows = db.rows.map((x) => (x.id === r.id ? r : x));
  await act(async () => db.handlers.UPDATE({ new: r }));
  await settle();
};
const toasts = () => [...document.querySelectorAll(".notif-toast:not(.is-leaving) .notif-toast-text")].map((e) => e.textContent);
const looking = (visible: boolean, focused: boolean) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (visible ? "visible" : "hidden") });
  vi.spyOn(document, "hasFocus").mockReturnValue(focused);
};

const worker = Object.assign(new EventTarget(), { startMessages: vi.fn() });
let root: Root;

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: worker });
  root?.unmount();
  document.body.innerHTML = "";
  document.documentElement.className = "";
  db.rows = [row({ id: "old", read_at: "2026-10-01T00:00:00.000Z", created_at: "2026-10-01T00:00:00.000Z" })];
  db.rpc.mockClear();
  nav.goTo.mockClear();
  alerts.raise.mockClear();
  looking(true, true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(NotificationsBell)));
  await settle();
});

describe("the bell, announcing", () => {
  it("pops up what lands while you're on the page, with no system notification", async () => {
    await insert(row({ id: "n1" }));
    expect(toasts()).toEqual(["ada commented on “Tax the robots”"]);
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it("raises a system notification instead while you're away", async () => {
    looking(false, false);
    await insert(row({ id: "n1" }));
    expect(toasts()).toEqual([]);
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    expect((alerts.raise.mock.calls[0] as unknown as [NotifRow])[0]).toMatchObject({ id: "n1", actor_username: "ada" });
  });

  it("does both while the page shows but another app is in front", async () => {
    looking(true, false);
    await insert(row({ id: "n1" }));
    expect(toasts()).toHaveLength(1);
    expect(alerts.raise).toHaveBeenCalledTimes(1);
  });

  it("announces a grouped row that grew, but not one marked read or stamped sent", async () => {
    const first = row({ id: "c1", meta: { count: 1 } });
    await insert(first);
    document.querySelector<HTMLButtonElement>(".notif-toast-close")!.click();
    await wait(220);
    expect(toasts()).toEqual([]);
    // The push dispatcher stamping it delivered: same time, nothing new.
    await update({ ...first });
    expect(toasts()).toEqual([]);
    // Another comment folded in: a new time, and it comes up again.
    await update({ ...first, meta: { count: 2 }, created_at: "2026-10-02T10:05:00.000Z" });
    expect(toasts()).toEqual(["ada and 1 other commented on “Tax the robots”"]);
    document.querySelector<HTMLButtonElement>(".notif-toast-close")!.click();
    await wait(220);
    // Read elsewhere: nothing.
    await update({ ...first, meta: { count: 2 }, created_at: "2026-10-02T10:05:00.000Z", read_at: "2026-10-02T10:06:00.000Z" });
    expect(toasts()).toEqual([]);
  });

  it("keeps three up at most, newest first", async () => {
    for (const id of ["a", "b", "c", "d"]) await insert(row({ id, post_title: id }));
    expect(toasts()).toEqual([
      "ada commented on “d”", "ada commented on “c”", "ada commented on “b”",
    ]);
  });

  it("holds them back while a room lies over the page", async () => {
    document.documentElement.classList.add("agora-covered");
    await insert(row({ id: "n1" }));
    expect(toasts()).toEqual([]);
  });

  it("opens a pop-up's notification and marks it read", async () => {
    await insert(row({ id: "n1" }));
    await act(async () => document.querySelector<HTMLElement>(".notif-toast")!.click());
    expect(db.rpc).toHaveBeenCalledWith("mark_notification_read", { p_id: "n1" });
    expect(nav.goTo).toHaveBeenCalledWith("/posts/p1");
    expect(toasts()).toEqual([]);
  });

  it("sends the pop-ups away when the list is opened", async () => {
    await insert(row({ id: "n1" }));
    await act(async () => document.querySelector<HTMLButtonElement>(".notif-bell-btn")!.click());
    expect(toasts()).toEqual([]);
  });

  it("opens what a clicked system notification is about, and says so to the worker", async () => {
    const answer = vi.fn();
    const message = Object.assign(new Event("message"), {
      data: { type: "agora:open-notification", url: "/posts/p1", id: "n1" },
      ports: [{ postMessage: answer }],
    });
    await act(async () => { worker.dispatchEvent(message); });
    expect(answer).toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith("mark_notification_read", { p_id: "n1" });
    expect(nav.goTo).toHaveBeenCalledWith("/posts/p1");
  });
});
