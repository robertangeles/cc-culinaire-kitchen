import { describe, it, expect } from "vitest";
import { press, parseEntry, limitMessage, zeroKey, type Key } from "./keypad";

const type = (keys: Key[], start = "") => keys.reduce((entry, k) => press(entry, k), start);

describe("keypad entry (D13)", () => {
  it("builds a number from digits", () => {
    expect(type(["4", "2"])).toBe("42");
  });

  it("starts a decimal with a leading zero and allows one point", () => {
    expect(type(["."])).toBe("0.");
    expect(type(["1", ".", "5", "."])).toBe("1.5");
  });

  it("allows up to three decimals and ignores a fourth", () => {
    expect(type(["1", ".", "2", "3", "4", "5"])).toBe("1.234");
  });

  it("does not grow leading zeros", () => {
    expect(type(["0", "0", "0"])).toBe("0");
    expect(type(["0", "7"])).toBe("7");
  });

  it("backspace removes the last key and clears to blank", () => {
    expect(type(["1", "2", "back"])).toBe("1");
    expect(type(["1", "back", "back"])).toBe("");
  });

  it('"0 - none here" records a deliberate zero whatever was typed', () => {
    expect(press("", "zero")).toBe("0");
    expect(press("37", "zero")).toBe("0");
  });

  it("stops at 99,999 (the server's limit) and says so", () => {
    expect(type(["9", "9", "9", "9", "9"])).toBe("99999");
    expect(press("99999", "9")).toBe("99999");
    expect(press("9999", "9")).toBe("99999");
    expect(press("99999", ".")).toBe("99999.");
    expect(press("99999.", "5")).toBe("99999."); // 99,999.5 is over the limit
    expect(limitMessage("99999", "1")).toBe("The largest number is 99,999.");
    expect(limitMessage("999", "1")).toBeNull();
  });
});

describe("what the entry means", () => {
  it.each([
    ["", null],
    [".", null],
    ["0", 0],
    ["0.", 0],
    ["7", 7],
    ["12.5", 12.5],
    ["0.125", 0.125],
  ])("reads %j as %j (blank is uncounted, never zero)", (entry, value) => {
    expect(parseEntry(entry)).toBe(value);
  });
});

describe("the 0 key", () => {
  it("records zero on purpose when blank and types a digit otherwise", () => {
    expect(press("", zeroKey(""))).toBe("0");
    expect(press("1", zeroKey("1"))).toBe("10");
    expect(press("10", zeroKey("10"))).toBe("100");
  });
});
