import { describe, it, expect } from "vitest";
import { parseMarkdown, parseInline } from "./markdown";

describe("blocks", () => {
  it("reads headings, paragraphs (a wrapped paragraph is one), lists and rules", () => {
    const md = ["# Terms", "", "We keep your", "data safe.", "", "## Your rights", "- Access", "- Delete", "", "1. First", "2. Second", "", "---", "### Contact", "Email us."].join("\n");
    expect(parseMarkdown(md)).toEqual([
      { type: "heading", level: 1, spans: [{ text: "Terms" }] },
      { type: "paragraph", spans: [{ text: "We keep your data safe." }] },
      { type: "heading", level: 2, spans: [{ text: "Your rights" }] },
      { type: "list", ordered: false, items: [[{ text: "Access" }], [{ text: "Delete" }]] },
      { type: "list", ordered: true, items: [[{ text: "First" }], [{ text: "Second" }]] },
      { type: "rule" },
      { type: "heading", level: 3, spans: [{ text: "Contact" }] },
      { type: "paragraph", spans: [{ text: "Email us." }] },
    ]);
  });

  it("treats deeper headings as the smallest, strips a quote marker, and reads Windows line endings", () => {
    expect(parseMarkdown("#### Small\r\n> quoted")).toEqual([
      { type: "heading", level: 3, spans: [{ text: "Small" }] },
      { type: "paragraph", spans: [{ text: "quoted" }] },
    ]);
  });

  it("is empty for nothing but blank lines", () => {
    expect(parseMarkdown(" \n\n  ")).toEqual([]);
  });

  it("shows markup it does not know as the plain text it is (raw html is never interpreted)", () => {
    expect(parseMarkdown("<script>alert(1)</script>")).toEqual([{ type: "paragraph", spans: [{ text: "<script>alert(1)</script>" }] }]);
  });
});

describe("inline", () => {
  it("reads bold, italic and links", () => {
    expect(parseInline("a **b** c *d* [e](https://x.test/p?q=1) f")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " c " },
      { text: "d", italic: true },
      { text: " " },
      { text: "e", href: "https://x.test/p?q=1" },
      { text: " f" },
    ]);
  });

  it("opens only web and mail links: any other scheme stays plain text", () => {
    expect(parseInline("[x](javascript:void)")).toEqual([{ text: "x" }]);
    expect(parseInline("[m](mailto:privacy@x.test)")).toEqual([{ text: "m", href: "mailto:privacy@x.test" }]);
    expect(parseInline("[h](http://x.test)")).toEqual([{ text: "h", href: "http://x.test" }]);
  });

  it("leaves underscores inside words and a lone asterisk alone", () => {
    expect(parseInline("snake_case_name and 2 * 3")).toEqual([{ text: "snake_case_name and 2 * 3" }]);
  });

  it("drops code ticks and keeps the text", () => {
    expect(parseInline("run `ls` now")).toEqual([{ text: "run ls now" }]);
  });
});
