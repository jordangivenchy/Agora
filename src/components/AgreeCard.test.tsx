// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

/* The card a person agrees on. The frame around it (the sky, the
   wordmark) and the waiting line are stand-ins; the fields, the box, the
   buttons and the words are the real ones. */
vi.mock("@/components/auth/AuthShell", () => ({
  default: ({ children, footer }: { children: ReactNode; footer?: ReactNode }) => createElement("div", null, children, footer),
}));
vi.mock("@/components/LoadingScreen", () => ({
  LoadingLine: ({ label }: { label: string }) => createElement("span", { className: "waiting" }, label),
}));

import AgreeCard, { type AgreeState } from "./AgreeCard";
import { LEGAL, termsSummary } from "@/components/agora/legal";
import { ABOUT_COPY } from "@/components/agora/aboutYou";

let host: HTMLDivElement;
let root: Root;
const onAgree = vi.fn();
const onSignOut = vi.fn();
const contact = LEGAL.contact;

type Over = Partial<{ state: AgreeState; error: string | null; ready: boolean; next: string; askAbout: boolean; held: boolean }>;
async function show(over: Over = {}) {
  await act(async () => {
    root.render(createElement(AgreeCard, { state: "ask", error: null, ready: true, next: "/settings", onAgree, onSignOut, ...over }));
  });
}
const title = () => host.querySelector("h1")?.textContent;
const box = () => host.querySelector<HTMLInputElement>('input[type="checkbox"]');
const go = () => host.querySelector<HTMLButtonElement>("button.agree-go");
const button = (words: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === words) ?? null;
const press = (el: Element | null) => act(async () => (el as HTMLElement).click());

/* Typing into a field, and choosing from a list, the way a browser tells React about them. */
async function fill(label: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(id: string, value: string) {
  const el = host.querySelector<HTMLSelectElement>(`#${id}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const born = async (month: string, day: string, year: string) => {
  await fill("Month of birth", month);
  await fill("Day of birth", day);
  await fill("Year of birth", year);
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onAgree.mockReset();
  onSignOut.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  LEGAL.contact = contact;
});

describe("the card a person agrees on", () => {
  it("says the points that matter and offers both documents to read", async () => {
    await show();
    const points = [...host.querySelectorAll(".agree-points li")].map((li) => li.textContent);
    expect(points).toEqual(termsSummary());
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".agree-read a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/terms", "/privacy"]);
    // reading opens beside the card, so the tick isn't lost
    expect(links.every((a) => a.target === "_blank")).toBe(true);
  });

  it("puts the age and both documents in the words beside the box", async () => {
    await show();
    const words = host.querySelector("label.agree-check")?.textContent ?? "";
    expect(words).toContain(`${LEGAL.minAge} or older`);
    expect(words).toContain("Terms");
    expect(words).toContain("Privacy Policy");
  });

  it("does nothing until the box is ticked", async () => {
    await show();
    expect(box()?.checked).toBe(false);
    expect(go()?.disabled).toBe(true);
    await press(go());
    expect(onAgree).not.toHaveBeenCalled();

    await press(box());
    expect(box()?.checked).toBe(true);
    expect(host.querySelector("label.agree-check")?.classList.contains("is-on")).toBe(true);
    expect(go()?.disabled).toBe(false);
    await press(go());
    expect(onAgree).toHaveBeenCalledTimes(1);
    // someone we already know sends nothing about themselves again
    expect(onAgree).toHaveBeenCalledWith(null);
  });

  it("stops again when the box is unticked", async () => {
    await show();
    await press(box());
    await press(box());
    expect(box()?.checked).toBe(false);
    expect(go()?.disabled).toBe(true);
    await press(go());
    expect(onAgree).not.toHaveBeenCalled();
  });

  it("shows neither step while the account is looked up", async () => {
    await show({ state: "loading", askAbout: true });
    expect(host.querySelector(".waiting")).not.toBeNull();
    expect(box()).toBeNull();
    expect(go()).toBeNull();
    expect(host.querySelector("input")).toBeNull();
  });

  it("holds still while it saves", async () => {
    await show();
    await press(box());
    await show({ state: "busy" });
    // still ticked, and neither the box nor the button can be pressed twice
    expect(box()?.checked).toBe(true);
    expect(box()?.disabled).toBe(true);
    expect(go()?.disabled).toBe(true);
    expect(go()?.textContent).toBe("Saving…");
  });

  it("says what went wrong, and keeps the tick for another try", async () => {
    await show();
    await press(box());
    await show({ error: "That didn't save. Check your connection and try again." });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("didn't save");
    expect(box()?.checked).toBe(true);
    expect(go()?.disabled).toBe(false);
  });

  it("lets a person sign out instead", async () => {
    await show();
    await press(button("Sign out instead"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onAgree).not.toHaveBeenCalled();
  });

  it("asks for nothing while the terms are still a draft", async () => {
    await show({ ready: false, next: "/replays/abc", askAbout: true });
    expect(box()).toBeNull();
    expect(go()).toBeNull();
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector("a.auth-primary")?.getAttribute("href")).toBe("/replays/abc");
    expect(host.querySelectorAll(".agree-read a")).toHaveLength(2);
  });
});

describe("the first time: a few things about the person", () => {
  it("comes before the terms, and can't be skipped", async () => {
    await show({ askAbout: true });
    expect(title()).toBe(ABOUT_COPY.title);
    expect(box()).toBeNull();
    expect(go()?.textContent).toBe("Continue");
    expect(go()?.disabled).toBe(true);
    await press(go());
    expect(title()).toBe(ABOUT_COPY.title);
  });

  it("keeps a date box to digits, and says what the date comes to", async () => {
    await show({ askAbout: true });
    expect(host.querySelector(".auth-hint")?.textContent).toContain(`${LEGAL.minAge} or older`);
    await fill("Month of birth", "3a/");
    await fill("Year of birth", "19901");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Month of birth"]')?.value).toBe("3");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Year of birth"]')?.value).toBe("1990");
    await fill("Day of birth", "4");
    expect(host.querySelector(".auth-hint")?.textContent).toMatch(/^That makes you \d+\. We keep only the year\.$/);
    await born("2", "30", "1990");
    expect(host.querySelector(".auth-hint")?.classList.contains("is-bad")).toBe(true);
    expect(go()?.disabled).toBe(true);
  });

  it("needs a country, and a state only in the United States", async () => {
    await show({ askAbout: true });
    await born("3", "4", "1990");
    expect(go()?.disabled).toBe(true);
    expect(host.querySelector("#agree-state")).toBeNull();

    await choose("agree-country", "CA");
    expect(host.querySelector("#agree-state")).toBeNull();
    expect(go()?.disabled).toBe(false);

    await choose("agree-country", "US");
    expect(host.querySelector("#agree-state")).not.toBeNull();
    expect(go()?.disabled).toBe(true);
    await choose("agree-state", "US-NY");
    expect(go()?.disabled).toBe(false);
  });

  it("sends the answers with the agreement, and nothing before", async () => {
    await show({ askAbout: true });
    await born("3", "4", "1990");
    await choose("agree-country", "US");
    await choose("agree-state", "US-NY");
    await press(go());
    expect(onAgree).not.toHaveBeenCalled();
    expect(title()).toBe("Before you carry on");

    await press(box());
    await press(go());
    expect(onAgree).toHaveBeenCalledTimes(1);
    expect(onAgree).toHaveBeenCalledWith({ birth: "1990-03-04", country: "US", region: "US-NY" });
  });

  it("drops the state when the country is changed away from the United States", async () => {
    await show({ askAbout: true });
    await born("3", "4", "1990");
    await choose("agree-country", "US");
    await choose("agree-state", "US-NY");
    await choose("agree-country", "FR");
    await press(go());
    await press(box());
    await press(go());
    expect(onAgree).toHaveBeenCalledWith({ birth: "1990-03-04", country: "FR", region: null });
  });

  it("lets a person go back and finds their answers still there", async () => {
    await show({ askAbout: true });
    await born("3", "4", "1990");
    await choose("agree-country", "CA");
    await press(go());
    await press(button("Back"));
    expect(title()).toBe(ABOUT_COPY.title);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Year of birth"]')?.value).toBe("1990");
    expect(host.querySelector<HTMLSelectElement>("#agree-country")?.value).toBe("CA");
    expect(go()?.disabled).toBe(false);
  });

  it("offers no way back to someone who wasn't asked", async () => {
    await show();
    expect(button("Back")).toBeNull();
  });

  it("lets an under-age date through to the terms: the refusal is the server's to make, and to remember", async () => {
    await show({ askAbout: true });
    const year = String(new Date().getFullYear() - 12);
    await born("3", "4", year);
    await choose("agree-country", "CA");
    expect(go()?.disabled).toBe(false);
    await press(go());
    await press(box());
    await press(go());
    expect(onAgree).toHaveBeenCalledWith({ birth: `${year}-03-04`, country: "CA", region: null });
  });
});

describe("an account on hold", () => {
  it("is told why and how to put a mistake right, and can only sign out", async () => {
    LEGAL.contact = "help@example.com";
    await show({ held: true, askAbout: true });
    expect(title()).toBe(ABOUT_COPY.heldTitle);
    expect(host.textContent).toContain(`${LEGAL.minAge} and over`);
    expect(host.textContent).toContain("help@example.com");
    expect(box()).toBeNull();
    expect(go()).toBeNull();
    expect(host.querySelector("input")).toBeNull();
    await press(button("Sign out"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onAgree).not.toHaveBeenCalled();
  });
});
