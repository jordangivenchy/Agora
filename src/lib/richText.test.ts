import { describe, it, expect } from "vitest";
import { parseBlocks, parseInline, toggleLinePrefix, wrapCodeBlock, wrapLink, wrapSelection } from "./richText";

describe("parseInline", () => {
  it("handles nested formats", () => {
    const r = parseInline("**bold *and italic* here**");
    expect(r).toEqual([
      { type: "bold", children: [
        { type: "text", text: "bold " },
        { type: "italic", children: [{ type: "text", text: "and italic" }] },
        { type: "text", text: " here" },
      ] },
    ]);
  });

  it("parses spoilers", () => {
    expect(parseInline("a >!secret!< b")).toEqual([
      { type: "text", text: "a " },
      { type: "spoiler", children: [{ type: "text", text: "secret" }] },
      { type: "text", text: " b" },
    ]);
  });

  it("keeps a URL inside link text and ignores unsafe hrefs", () => {
    expect(parseInline("[see https://x.com](https://y.com)")).toEqual([
      { type: "link", href: "https://y.com", children: [{ type: "text", text: "see " }, { type: "url", href: "https://x.com" }] },
    ]);
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ type: "text", text: "[x](javascript:alert(1))" }]);
  });

  it("parses superscript both ways, strike, code, mentions", () => {
    expect(parseInline("x^2 and ^(a b) ~~no~~ `co**de` @sam")).toEqual([
      { type: "text", text: "x" },
      { type: "sup", children: [{ type: "text", text: "2" }] },
      { type: "text", text: " and " },
      { type: "sup", children: [{ type: "text", text: "a b" }] },
      { type: "text", text: " " },
      { type: "strike", children: [{ type: "text", text: "no" }] },
      { type: "text", text: " " },
      { type: "code", text: "co**de" },
      { type: "text", text: " " },
      { type: "mention", name: "sam" },
    ]);
  });

  it("leaves lone asterisks and snake_case alone", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([{ type: "text", text: "2 * 3 * 4" }]);
    expect(parseInline("my_var_name")).toEqual([{ type: "text", text: "my_var_name" }]);
    expect(parseInline("_it_")).toEqual([{ type: "italic", children: [{ type: "text", text: "it" }] }]);
  });

  it("drops trailing sentence punctuation from bare URLs", () => {
    expect(parseInline("go to https://a.com/x.")).toEqual([
      { type: "text", text: "go to " }, { type: "url", href: "https://a.com/x" }, { type: "text", text: "." },
    ]);
  });
});

describe("parseBlocks", () => {
  it("splits paragraphs on blank lines and keeps single newlines as br", () => {
    expect(parseBlocks("a\nb\n\nc")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "a" }, { type: "br" }, { type: "text", text: "b" }] },
      { type: "paragraph", children: [{ type: "text", text: "c" }] },
    ]);
  });

  it("parses bullet and numbered lists", () => {
    expect(parseBlocks("- a\n* b\n\n1. one\n2. two")).toEqual([
      { type: "list", ordered: false, items: [[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]] },
      { type: "list", ordered: true, items: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]] },
    ]);
  });

  it("only treats `1.` and `#` at line start", () => {
    expect(parseBlocks("version 1. is out")).toEqual([{ type: "paragraph", children: [{ type: "text", text: "version 1. is out" }] }]);
    expect(parseBlocks("issue # 5")).toEqual([{ type: "paragraph", children: [{ type: "text", text: "issue # 5" }] }]);
    expect(parseBlocks("#nospace")).toEqual([{ type: "paragraph", children: [{ type: "text", text: "#nospace" }] }]);
    expect(parseBlocks("## Title")).toEqual([{ type: "heading", level: 2, children: [{ type: "text", text: "Title" }] }]);
  });

  it("keeps ** literal inside code blocks", () => {
    expect(parseBlocks("```\n**not bold**\n# not heading\n```\nafter")).toEqual([
      { type: "code", text: "**not bold**\n# not heading" },
      { type: "paragraph", children: [{ type: "text", text: "after" }] },
    ]);
  });

  it("parses tables", () => {
    expect(parseBlocks("| a | b |\n|---|---|\n| 1 | **2** |")).toEqual([
      { type: "table", header: [[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]],
        rows: [[[{ type: "text", text: "1" }], [{ type: "bold", children: [{ type: "text", text: "2" }] }]]] },
    ]);
    // a pipe line without a separator row is just text
    expect(parseBlocks("a | b")[0].type).toBe("paragraph");
  });

  it("parses quotes, hr, and does not confuse spoilers with quotes", () => {
    expect(parseBlocks("> q1\n> q2\n\n---\n>!sp!<")).toEqual([
      { type: "quote", children: [{ type: "paragraph", children: [{ type: "text", text: "q1" }, { type: "br" }, { type: "text", text: "q2" }] }] },
      { type: "hr" },
      { type: "paragraph", children: [{ type: "spoiler", children: [{ type: "text", text: "sp" }] }] },
    ]);
  });
});

describe("composer helpers", () => {
  it("wrapSelection toggles", () => {
    const w = wrapSelection("hi there", 3, 8, "**");
    expect(w).toEqual({ value: "hi **there**", selStart: 5, selEnd: 10 });
    expect(wrapSelection(w.value, w.selStart, w.selEnd, "**").value).toBe("hi there");
  });

  it("toggleLinePrefix numbers lines and toggles off", () => {
    const on = toggleLinePrefix("a\nb\nc", 0, 5, (n) => `${n}. `, /^\d+\.\s/);
    expect(on.value).toBe("1. a\n2. b\n3. c");
    expect(toggleLinePrefix(on.value, on.selStart, on.selEnd, (n) => `${n}. `, /^\d+\.\s/).value).toBe("a\nb\nc");
    expect(toggleLinePrefix("x\ny", 3, 3, "- ", /^[-*]\s/).value).toBe("x\n- y");
  });

  it("wrapCodeBlock and wrapLink", () => {
    expect(wrapCodeBlock("a\nb", 2, 3).value).toBe("a\n```\nb\n```");
    const l = wrapLink("see here", 4, 8);
    expect(l.value).toBe("see [here](url)");
    expect(l.value.slice(l.selStart, l.selEnd)).toBe("url");
  });
});
