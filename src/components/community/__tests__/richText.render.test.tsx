import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RichText from "../RichText";

const r = (text: string, inline = false) => renderToStaticMarkup(<RichText text={text} inline={inline} />);

describe("RichText rendering", () => {
  it("handles nested formats", () => {
    expect(r("**bold *and italic* here**")).toContain("<strong>bold <em>and italic</em> here</strong>");
  });
  it("renders spoilers as blacked-out spans", () => {
    const h = r("a >!secret!< b");
    expect(h).toContain('class="rt-spoiler"');
    expect(h).toContain("secret");
    expect(h).not.toContain(">!");
  });
  it("spoiler spanning formatting", () => {
    expect(r(">!**bold** text!<")).toMatch(/rt-spoiler.*<strong>bold<\/strong> text/);
  });
  it("spoiler at line start is not a quote", () => {
    const h = r(">!sp!<");
    expect(h).not.toContain("<blockquote");
    expect(h).toContain("rt-spoiler");
  });
  it("keeps a URL inside link text and ignores unsafe hrefs", () => {
    expect(r("[see https://x.com](https://y.com)")).toContain('href="https://y.com"');
    const h = r("[x](javascript:alert(1))");
    expect(h).not.toContain("javascript:");
    expect(h).toContain("x");
  });
  it("links open in a new tab with noopener", () => {
    expect(r("[a](https://y.com)")).toContain('target="_blank" rel="noopener noreferrer"');
  });
  it("superscript both ways, strike, code, mentions", () => {
    const h = r("x^2 and ^(a b) ~~no~~ `co**de` @sam");
    expect(h).toContain("x<sup>2</sup>");
    expect(h).toContain("<sup>a b</sup>");
    expect(h).toContain("<del>no</del>");
    expect(h).toContain("<code>co**de</code>");
    expect(h).toContain('href="/users/sam"');
  });
  it("does not mention inside emails or links", () => {
    expect(r("mail a@b.com")).not.toContain("rt-mention");
  });
  it("leaves lone asterisks and snake_case alone", () => {
    expect(r("2 * 3 * 4")).toContain("2 * 3 * 4");
    expect(r("my_var_name")).toContain("my_var_name");
  });
  it("auto-links bare URLs", () => {
    expect(r("go to https://a.com/x")).toContain('href="https://a.com/x"');
  });
  it("single newline is a <br>, blank line a new paragraph", () => {
    const h = r("a\nb\n\nc");
    expect(h).toContain("a<br/>");
    expect(h.match(/<p>/g)?.length).toBe(2);
  });
  it("lists, headings, code blocks, tables, quotes, hr", () => {
    expect(r("- a\n* b")).toContain("<ul>");
    expect(r("1. one\n2. two")).toContain("<ol>");
    expect(r("## Title")).toContain("<h2>Title</h2>");
    expect(r("#nospace")).toContain("#nospace");
    expect(r("```\n**not bold**\n```")).toContain("**not bold**");
    const t = r("| a | b |\n|---|---|\n| 1 | **2** |");
    expect(t).toContain("<th");
    expect(t).toContain("<strong>2</strong>");
    expect(r("> q1")).toContain("<blockquote>");
    expect(r("---")).toContain("<hr/>");
  });
  it("inline mode drops block wrappers", () => {
    const h = r("## **T**", true);
    expect(h).not.toContain("<h2");
    expect(h).not.toContain("<p>");
    expect(h).toContain("<strong>T</strong>");
  });
  it("escaped characters from the editor serializer render literally", () => {
    expect(r("2 \\* 3 &gt; 1")).toContain("2 * 3 &gt; 1");
  });
});
