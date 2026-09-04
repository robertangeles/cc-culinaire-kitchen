import { describe, it, expect, afterEach } from "vitest";
import { formatAuDate, formatAuDateShort, formatShiftRange, durationHours, daysBetweenLocal } from "./dates.js";

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

describe("durationHours", () => {
  it("computes hours between two ISO instants", () => {
    expect(durationHours("2026-09-07T08:00:00+10:00", "2026-09-07T21:00:00+10:00")).toBe(13);
  });

  it("computes the exact 157h duration from the roster incident", () => {
    expect(durationHours("2026-09-06T22:00:00Z", "2026-09-13T11:00:00Z")).toBe(157);
  });
});

describe("daysBetweenLocal", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("is 0 for a shift that starts and ends the same local day", () => {
    process.env.TZ = "Australia/Sydney";
    expect(daysBetweenLocal("2026-09-07T08:00:00+10:00", "2026-09-07T21:00:00+10:00")).toBe(0);
  });

  it("is 1 for a shift crossing exactly one midnight", () => {
    process.env.TZ = "Australia/Sydney";
    expect(daysBetweenLocal("2026-09-07T23:00:00+10:00", "2026-09-08T02:00:00+10:00")).toBe(1);
  });

  it("counts local calendar days crossed for the 157h incident shift, not raw hours", () => {
    process.env.TZ = "Australia/Sydney";
    expect(daysBetweenLocal("2026-09-06T22:00:00Z", "2026-09-13T11:00:00Z")).toBe(6);
  });
});

describe("formatShiftRange", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("does not repeat the date for a same-day shift", () => {
    process.env.TZ = "Australia/Sydney";
    expect(formatShiftRange("2026-09-07T08:00:00+10:00", "2026-09-07T21:00:00+10:00")).toBe(
      "Mon, 7 Sept, 8:00 am–9:00 pm",
    );
  });

  it("shows both dates when the shift crosses a calendar day", () => {
    process.env.TZ = "Australia/Sydney";
    expect(formatShiftRange("2026-09-07T23:00:00+10:00", "2026-09-08T02:00:00+10:00")).toBe(
      "Mon, 7 Sept, 11:00 pm – Tue, 8 Sept, 2:00 am",
    );
  });

  it("regression: the actual 157h roster-incident shift shows its real end date, not a swallowed one", () => {
    process.env.TZ = "Australia/Sydney";
    expect(formatShiftRange("2026-09-06T22:00:00Z", "2026-09-13T11:00:00Z")).toBe(
      "Mon, 7 Sept, 8:00 am – Sun, 13 Sept, 9:00 pm",
    );
  });

  it("regression: the actual 129h roster-incident shift shows its real end date", () => {
    process.env.TZ = "Australia/Sydney";
    expect(formatShiftRange("2026-08-30T23:00:00Z", "2026-09-05T08:00:00Z")).toBe(
      "Mon, 31 Aug, 9:00 am – Sat, 5 Sept, 6:00 pm",
    );
  });
});
