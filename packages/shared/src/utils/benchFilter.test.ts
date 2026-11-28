import { describe, expect, it } from "vitest";
import { compileBlockedTerms, countBlockedTerms } from "./benchFilter.js";

// Made-up placeholder terms only.
const terms = compileBlockedTerms("zorp\nblim flam\n\n  Quux  \nbiff\n");
const refused = (text: string) => countBlockedTerms(text, terms) > 0;

describe("compileBlockedTerms", () => {
  it("reads one term per line, skipping blank lines", () => {
    expect(terms).toHaveLength(4);
  });

  it("an empty or blank list filters nothing", () => {
    expect(compileBlockedTerms("")).toEqual([]);
    expect(compileBlockedTerms(" \n\n \t")).toEqual([]);
    expect(countBlockedTerms("zorp", compileBlockedTerms(""))).toBe(0);
  });

  it("drops a term that has no letters or digits", () => {
    expect(compileBlockedTerms("...\n--")).toEqual([]);
  });
});

describe("countBlockedTerms", () => {
  it("refuses a listed word in any case", () => {
    expect(refused("well zorp to that")).toBe(true);
    expect(refused("ZORP")).toBe(true);
    expect(refused("quux")).toBe(true);
  });

  it("passes ordinary text", () => {
    expect(refused("Service starts at five, mise en place by four.")).toBe(false);
  });

  it("matches whole words only: a word containing a listed one passes", () => {
    expect(refused("zorpish")).toBe(false);
    expect(refused("unzorp")).toBe(false);
    expect(refused("biffy")).toBe(false);
  });

  it("does not let collapsing repeats join a shorter word to a listed one", () => {
    expect(refused("bif")).toBe(false);
    expect(refused("zrp")).toBe(false);
  });

  it("refuses with diacritics or full-width letters", () => {
    expect(refused("zörp")).toBe(true);
    expect(refused("ｚｏｒｐ")).toBe(true);
  });

  it("refuses digits and symbols standing in for letters", () => {
    expect(refused("z0rp")).toBe(true);
    expect(refused("b1ff")).toBe(true);
    expect(refused("b!ff")).toBe(true);
    expect(refused("blim fl@m")).toBe(true);
  });

  it("does not take punctuation at the end of a word for a letter", () => {
    expect(refused("that was zorp!")).toBe(true);
    expect(refused("zorp... really")).toBe(true);
    expect(refused("$zorp$")).toBe(true);
  });

  it("refuses repeated letters", () => {
    expect(refused("zoooorrrp")).toBe(true);
    expect(refused("biiiifffff")).toBe(true);
  });

  it("refuses a word spelt out with separators", () => {
    expect(refused("z o r p")).toBe(true);
    expect(refused("z.o.r.p")).toBe(true);
    expect(refused("z-o-r-p")).toBe(true);
    expect(refused("z_o_r_p")).toBe(true);
  });

  it("refuses a word with invisible characters inside", () => {
    expect(refused("zo​rp")).toBe(true);
    expect(refused("zo­rp")).toBe(true);
  });

  it("matches a phrase with any separators between its words, and not its words alone", () => {
    expect(refused("such a blim flam day")).toBe(true);
    expect(refused("blim   --  flam")).toBe(true);
    expect(refused("blim\nflam")).toBe(true);
    expect(refused("blim")).toBe(false);
    expect(refused("flam blim")).toBe(false);
    expect(refused("blimflam")).toBe(false);
  });

  it("counts each listed term once", () => {
    expect(countBlockedTerms("zorp zorp quux", terms)).toBe(2);
  });

  it("a listed term written with look-alikes matches the plain spelling", () => {
    expect(countBlockedTerms("zorp", compileBlockedTerms("z0rp"))).toBe(1);
  });
});
