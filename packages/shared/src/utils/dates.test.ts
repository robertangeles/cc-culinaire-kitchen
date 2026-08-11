import { describe, it, expect, afterEach } from "vitest";
import { formatAuDate, formatAuDateShort } from "./dates.js";

describe("formatAuDate", () => {
  it("formats a Date instance", () => {
    expect(formatAuDate(new Date(2026, 5, 15))).toBe("15 June 2026");
  });

  it("formats a YYYY-MM-DD string", () => {
    expect(formatAuDate("2026-06-15")).toBe("15 June 2026");
  });

  it("does not zero-pad a single-digit day", () => {
    expect(formatAuDate("2026-01-05")).toBe("5 January 2026");
  });

  it("handles the first day of the year", () => {
    expect(formatAuDate("2026-01-01")).toBe("1 January 2026");
  });

  it("handles the last day of the year", () => {
    expect(formatAuDate("2026-12-31")).toBe("31 December 2026");
  });
});

describe("formatAuDateShort", () => {
  it("formats a Date instance as DD/MM/YYYY", () => {
    expect(formatAuDateShort(new Date(2026, 5, 15))).toBe("15/06/2026");
  });

  it("formats a YYYY-MM-DD string as DD/MM/YYYY", () => {
    expect(formatAuDateShort("2026-06-15")).toBe("15/06/2026");
  });

  it("zero-pads single-digit day and month", () => {
    expect(formatAuDateShort("2026-01-05")).toBe("05/01/2026");
  });
});

describe("no timezone-induced off-by-one shift", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  // The classic bug: new Date("2026-06-15") parses as UTC midnight, so a
  // host timezone behind UTC renders 14 June. Prove the fix holds on both
  // sides of UTC.
  it("does not shift the day on a host timezone west of UTC", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(formatAuDate("2026-06-15")).toBe("15 June 2026");
    expect(formatAuDateShort("2026-06-15")).toBe("15/06/2026");
  });

  it("does not shift the day on a host timezone east of UTC", () => {
    process.env.TZ = "Pacific/Auckland";
    expect(formatAuDate("2026-06-15")).toBe("15 June 2026");
    expect(formatAuDateShort("2026-06-15")).toBe("15/06/2026");
  });
});
