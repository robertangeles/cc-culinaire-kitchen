import { describe, it, expect } from "vitest";
import { gapCheckYears, holidayCoversShift } from "./publicHolidayService.js";

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

describe("holidayCoversShift", () => {
  it("a full-day holiday (no threshold) always covers the shift", () => {
    expect(holidayCoversShift(null, "09:00")).toBe(true);
    expect(holidayCoversShift(null, "23:59")).toBe(true);
    expect(holidayCoversShift(null, undefined)).toBe(true);
  });

  it("a partial-day holiday does not cover a shift ending before the threshold", () => {
    expect(holidayCoversShift("18:00", "17:59")).toBe(false);
    expect(holidayCoversShift("19:00", "09:00")).toBe(false);
  });

  it("a partial-day holiday covers a shift ending after the threshold", () => {
    expect(holidayCoversShift("18:00", "18:01")).toBe(true);
    expect(holidayCoversShift("19:00", "24:00")).toBe(true); // overnight-shift sentinel
  });

  it("a partial-day holiday's threshold instant itself is excluded (shift must extend past it)", () => {
    expect(holidayCoversShift("18:00", "18:00")).toBe(false);
  });

  it("omitting the shift end-time on a partial-day holiday defaults to covering it — backward-compatible for callers unaware of the new param", () => {
    expect(holidayCoversShift("18:00", undefined)).toBe(true);
  });
});
