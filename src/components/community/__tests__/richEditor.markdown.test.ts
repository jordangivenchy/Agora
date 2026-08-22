// @vitest-environment jsdom
import { beforeAll, describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions, cleanMarkdown } from "../richEditorExtensions";

function make(md: string) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({ element: el, extensions: buildExtensions(), content: md, contentType: "markdown" });
  return editor;
}
const round = (md: string) => { const e = make(md); const out = e.getMarkdown(); e.destroy(); return out; };
const html = (md: string) => { const e = make(md); const out = e.getHTML(); e.destroy(); return out; };

describe("markdown round-trip", () => {
  it.each([
    ["**bold**"], ["*italic*"], ["~~strike~~"], ["`code`"],
    ["# H1"], ["## H2"], ["### H3"],
    ["- a\n- b"], ["1. one\n2. two"],
    ["- a\n  - nested"],
    ["> quote"],
    ["```\ncode **here**\n```"],
    ["[text](https://x.com)"],
    ["^(sup)"],
    [">!spoiler!<"], ["a >!secret **b**!< c"],
    ["@sam hi"],
    ["---"],
  ])("%s", (md) => {
    expect(round(md)).toBe(md);
  });

  it("canonicalises ^x to ^(x) and pads tables", () => {
    expect(round("x^2")).toBe("x^(2)");
    expect(round("| a | b |\n| --- | --- |\n| 1 | 2 |").trim()).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |");
  });

  it("renders custom marks/nodes as HTML", () => {
    expect(html(">!s!<")).toContain("rt-spoiler");
    expect(html("x^2")).toContain("<sup>");
    expect(html("@sam")).toContain("rt-mention");
    expect(html("# H")).toContain("<h1>");
  });

  it("drops unsafe link hrefs", () => {
    expect(html("[x](javascript:alert(1))")).not.toContain("<a");
  });

  it("empty editor → empty string", () => {
    expect(round("")).toBe("");
  });

  it("hard breaks survive", () => {
    expect(round("a\nb")).toBe("a  \nb");
  });

  it("escapes literal markdown characters", () => {
    const e = make("");
    e.commands.setContent("2 * 3", { contentType: "html" });
    expect(e.getMarkdown()).toBe("2 \\* 3");
    e.destroy();
  });
});

describe("keyboard behaviour (ProseMirror keymap via keydown)", () => {
  function press(e: Editor, key: string, mods: Partial<KeyboardEventInit> = {}) {
    const ev = new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true, ...mods });
    e.view.dom.dispatchEvent(ev);
    return ev.defaultPrevented;
  }
  const tail = (e: Editor) => e.commands.focus("end");
  const out = (e: Editor) => cleanMarkdown(e.getMarkdown());
  beforeAll(() => {
    /* jsdom has no layout; scrollIntoView on focus needs these. */
    Element.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
    Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
  });

  it("Enter continues a bullet list, empty item exits it", () => {
    const e = make("- a");
    tail(e);
    press(e, "Enter"); e.commands.insertContent("b");
    expect(out(e)).toBe("- a\n- b");
    press(e, "Enter"); press(e, "Enter"); e.commands.insertContent("out");
    expect(out(e)).toBe("- a\n- b\n\nout");
    e.destroy();
  });

  it("Enter continues a numbered list with the next number", () => {
    const e = make("1. x");
    tail(e);
    press(e, "Enter"); e.commands.insertContent("y");
    expect(out(e)).toBe("1. x\n2. y");
    e.destroy();
  });

  it("Tab nests, Shift+Tab lifts", () => {
    const e = make("- a\n- b");
    tail(e);
    expect(press(e, "Tab")).toBe(true);
    expect(out(e)).toBe("- a\n  - b");
    expect(press(e, "Tab", { shiftKey: true })).toBe(true);
    expect(out(e)).toBe("- a\n- b");
    e.destroy();
  });

  it("Backspace on an empty item exits the list", () => {
    const e = make("- a");
    tail(e);
    press(e, "Enter");
    expect(e.isActive("listItem")).toBe(true);
    press(e, "Backspace");
    expect(e.isActive("listItem")).toBe(false);
    expect(out(e)).toBe("- a");
    e.destroy();
  });

  it("Tab in a table goes to the next cell, not a list sink", () => {
    const e = make("");
    e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    e.commands.insertContent("h1");
    press(e, "Tab"); e.commands.insertContent("h2");
    expect(e.getMarkdown()).toContain("| h1  | h2  |");
    e.destroy();
  });

  it("Mod+Enter fires onSubmit; plain Enter does not", () => {
    let n = 0;
    const el = document.createElement("div");
    const e = new Editor({ element: el, extensions: buildExtensions({ onSubmit: () => { n += 1; } }), content: "hi", contentType: "markdown" });
    tail(e);
    press(e, "Enter");
    expect(n).toBe(0);
    press(e, "Enter", { ctrlKey: true }); // jsdom is non-Mac: Mod = Ctrl; Meta is bound on macOS
    expect(n).toBe(1);
    e.destroy();
  });

  it("cleanMarkdown drops &nbsp; placeholder paragraphs", () => {
    expect(cleanMarkdown("a\n\n&nbsp;\n\n\n\nb")).toBe("a\n\nb");
  });
});
