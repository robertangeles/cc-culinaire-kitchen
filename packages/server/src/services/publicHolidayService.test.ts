import { describe, it, expect } from "vitest";
import { gapCheckYears } from "./publicHolidayService.js";

describe("gapCheckYears", () => {
  it("covers only the current year outside the lookahead window", () => {
    expect(gapCheckYears(new Date(2026, 0, 15))).toEqual([2026]); // January
    expect(gapCheckYears(new Date(2026, 8, 30))).toEqual([2026]); // September
  });

  it("adds next year from November on", () => {
    expect(gapCheckYears(new Date(2026, 10, 1))).toEqual([2026, 2027]); // November
    expect(gapCheckYears(new Date(2026, 11, 31))).toEqual([2026, 2027]); // December
  });

  it("October is not yet in the lookahead window", () => {
    expect(gapCheckYears(new Date(2026, 9, 31))).toEqual([2026]);
  });
});
