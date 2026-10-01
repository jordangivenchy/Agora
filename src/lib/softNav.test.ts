// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { goTo, pointsToRoom, softNavTarget } from "./softNav";
import { enterRoom, openRoom } from "./enterRoom";

/* While a call is live, which plain link clicks become in-app page
   changes (so the call carries on), and which the browser keeps. */
const here = { href: "https://agorasphere.net/communities/abc", origin: "https://agorasphere.net", pathname: "/communities/abc", search: "" };
const click = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const link = (href: string, target = "", attrs: string[] = []) => ({ href, target, hasAttribute: (n: string) => attrs.includes(n) });

describe("softNavTarget", () => {
  it("takes a plain link to another page on the site in place", () => {
    expect(softNavTarget(link("https://agorasphere.net/users/jordan"), click, here)).toBe("/users/jordan");
    expect(softNavTarget(link("/news?story=12#top"), click, here)).toBe("/news?story=12#top");
  });

  it("leaves new-tab and modified clicks to the browser", () => {
    expect(softNavTarget(link("/users/jordan", "_blank"), click, here)).toBeNull();
    expect(softNavTarget(link("/users/jordan"), { ...click, metaKey: true }, here)).toBeNull();
    expect(softNavTarget(link("/users/jordan"), { ...click, button: 1 }, here)).toBeNull();
    expect(softNavTarget(link("/users/jordan"), { ...click, defaultPrevented: true }, here)).toBeNull();
    expect(softNavTarget(link("/clip.mp4", "", ["download"]), click, here)).toBeNull();
  });

  it("leaves other sites, files, the API, sign-in callbacks and in-page jumps alone", () => {
    expect(softNavTarget(link("https://discord.gg/abc"), click, here)).toBeNull();
    expect(softNavTarget(link("/api/health"), click, here)).toBeNull();
    expect(softNavTarget(link("/auth/callback?code=1"), click, here)).toBeNull();
    expect(softNavTarget(link("/icon.png"), click, here)).toBeNull();
    expect(softNavTarget(link("/communities/abc#rules"), click, here)).toBeNull();
  });

  it("lets another room be a fresh page — that one ends the call on purpose", () => {
    expect(softNavTarget(link("/agora/some-room-1a2b3c4d"), click, here)).toBeNull();
  });
});

describe("goTo", () => {
  afterEach(() => { delete window.__agoraSoftNav; });

  it("changes page in the app while a call is live", () => {
    const seen: string[] = [];
    window.__agoraSoftNav = (url) => { seen.push(url); return true; };
    goTo("/posts/1");
    expect(seen).toEqual(["/posts/1"]);
    expect(window.location.hash).toBe("");
  });

  it("is a normal page load without one", () => {
    goTo("#no-call");
    expect(window.location.hash).toBe("#no-call");
  });
});

/* Opening the room you are already in (minimized to its card) brings it
   back up instead of loading it and joining it all over again. */
describe("pointsToRoom", () => {
  const id = "90dabdf2-c208-46c9-8417-b5070fba44a0";
  const at = "https://agorasphere.net/explore";

  it("knows the room by its pretty address, its short id or its full id", () => {
    expect(pointsToRoom("/agora/should-the-agora-host-debates-90dabdf2", id, at)).toBe(true);
    expect(pointsToRoom("https://agorasphere.net/agora/90dabdf2", id, at)).toBe(true);
    expect(pointsToRoom(`/agora/${id}`, id, at)).toBe(true);
    expect(pointsToRoom(`/agora/${id.toUpperCase()}`, id, at)).toBe(true);
  });

  it("tells other rooms, other pages and other sites apart", () => {
    expect(pointsToRoom("/agora/some-room-1a2b3c4d", id, at)).toBe(false);
    expect(pointsToRoom("/replays/should-the-agora-host-debates-90dabdf2", id, at)).toBe(false);
    expect(pointsToRoom("/agora/should-the-agora-host-debates-90dabdf2/extra", id, at)).toBe(false);
    expect(pointsToRoom("https://example.com/agora/90dabdf2", id, at)).toBe(false);
  });
});

describe("entering a room", () => {
  afterEach(() => {
    delete window.__agoraOpenCall;
    delete window.__agoraEnter;
  });

  it("brings the room you are in back up, and loads nothing", () => {
    const opened: string[] = [];
    let loaded = false;
    window.__agoraOpenCall = (url) => { opened.push(url); return true; };
    window.__agoraEnter = () => { loaded = true; };
    enterRoom("/agora/should-the-agora-host-debates-90dabdf2");
    openRoom({ id: "90dabdf2-c208-46c9-8417-b5070fba44a0", motion: "Should the Agora host debates", status: "live" });
    expect(opened).toHaveLength(2);
    expect(loaded).toBe(false);
  });

  it("enters any other room as before", () => {
    let loaded = "";
    window.__agoraOpenCall = () => false;
    window.__agoraEnter = (url) => { loaded = url; };
    enterRoom("/agora/some-room-1a2b3c4d");
    expect(loaded).toBe("/agora/some-room-1a2b3c4d");
  });
});
