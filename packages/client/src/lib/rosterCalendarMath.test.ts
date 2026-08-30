import { describe, it, expect } from "vitest";
import {
  minutesForPixel,
  pixelForMinutes,
  snapMinutes,
  minutesSinceMidnight,
  addDaysIso,
  mondayOfWeek,
  dayColumnIndexForDate,
  laneIndexForRole,
} from "./rosterCalendarMath.js";

describe("pixelForMinutes / minutesForPixel", () => {
  it("round-trips for an arbitrary hour height", () => {
    const hourHeightPx = 64;
    for (const minutes of [0, 15, 90, 375, 1439]) {
      const px = pixelForMinutes(minutes, hourHeightPx);
      expect(minutesForPixel(px, hourHeightPx)).toBeCloseTo(minutes, 5);
    }
  });

  it("scales linearly with hour height", () => {
    expect(pixelForMinutes(60, 40)).toBe(40);
    expect(pixelForMinutes(30, 40)).toBe(20);
    expect(pixelForMinutes(0, 40)).toBe(0);
  });
});

describe("snapMinutes", () => {
  it("snaps to the nearest 15-minute step by default", () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(15)).toBe(15);
    expect(snapMinutes(22)).toBe(15);
    expect(snapMinutes(23)).toBe(30);
  });

  it("respects a custom step", () => {
    expect(snapMinutes(12, 10)).toBe(10);
    expect(snapMinutes(16, 10)).toBe(20);
  });

  it("snaps negative minutes correctly (a drag that moves above its start)", () => {
    expect(snapMinutes(-7)).toBe(0);
    expect(snapMinutes(-8)).toBe(-15);
  });
});

describe("minutesSinceMidnight", () => {
  it("reads local hours/minutes off a Date", () => {
    const d = new Date(2026, 0, 1, 14, 30);
    expect(minutesSinceMidnight(d)).toBe(14 * 60 + 30);
  });

  it("is zero at local midnight", () => {
    expect(minutesSinceMidnight(new Date(2026, 0, 1, 0, 0))).toBe(0);
  });
});

describe("addDaysIso / mondayOfWeek", () => {
  it("adds and subtracts days across a month boundary", () => {
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysIso("2026-02-01", -1)).toBe("2026-01-31");
  });

  it("a Monday is its own week start", () => {
    expect(mondayOfWeek("2026-08-31")).toBe("2026-08-31"); // a Monday
  });

  it("a Sunday belongs to the PRIOR Monday, not the next one", () => {
    // 2026-09-06 is a Sunday; its week started 2026-08-31.
    expect(mondayOfWeek("2026-09-06")).toBe("2026-08-31");
  });

  it("mid-week days resolve to the same Monday", () => {
    expect(mondayOfWeek("2026-09-02")).toBe("2026-08-31"); // Wednesday
    expect(mondayOfWeek("2026-09-05")).toBe("2026-08-31"); // Saturday
  });
});

describe("dayColumnIndexForDate", () => {
  const weekStart = "2026-08-31"; // Monday

  it("returns 0 for the week start itself", () => {
    expect(dayColumnIndexForDate(weekStart, weekStart)).toBe(0);
  });

  it("returns 6 for the Sunday ending that week", () => {
    expect(dayColumnIndexForDate("2026-09-06", weekStart)).toBe(6);
  });

  it("returns a negative index for a date before the week start", () => {
    expect(dayColumnIndexForDate("2026-08-30", weekStart)).toBe(-1);
  });
});

describe("laneIndexForRole", () => {
  const roleIds = ["role-a", "role-b", "role-c"];

  it("is stable across calls for the same role list", () => {
    expect(laneIndexForRole("role-b", roleIds)).toBe(1);
    expect(laneIndexForRole("role-b", roleIds)).toBe(1);
  });

  it("returns -1 for a role not in the list", () => {
    expect(laneIndexForRole("role-z", roleIds)).toBe(-1);
  });
});
