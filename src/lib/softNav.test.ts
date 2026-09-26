// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { goTo, softNavTarget } from "./softNav";

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
