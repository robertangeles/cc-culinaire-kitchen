import { describe, it, expect } from "vitest";
import {
  toVenueLocalDate,
  toVenueLocalTime,
  shiftEndTimeOnStartDate,
  resolveVenueLocalToUtc,
} from "./rosterService.js";

describe("toVenueLocalTime", () => {
  it("converts a UTC instant to venue-local HH:MM during daylight saving (AEDT, UTC+11)", () => {
    const instant = new Date("2026-01-15T13:30:00.000Z");
    expect(toVenueLocalTime(instant, "Australia/Melbourne")).toBe("00:30");
    // Cross-check: the same instant's local date rolled to the next day too.
    expect(toVenueLocalDate(instant, "Australia/Melbourne")).toBe("2026-01-16");
  });

  it("converts a UTC instant to venue-local HH:MM outside daylight saving (AEST, UTC+10)", () => {
    const instant = new Date("2026-07-15T13:30:00.000Z");
    expect(toVenueLocalTime(instant, "Australia/Melbourne")).toBe("23:30");
    expect(toVenueLocalDate(instant, "Australia/Melbourne")).toBe("2026-07-15");
  });

  it("Queensland never observes daylight saving (always UTC+10)", () => {
    const summerInstant = new Date("2026-01-15T13:30:00.000Z");
    expect(toVenueLocalTime(summerInstant, "Australia/Brisbane")).toBe("23:30");
    expect(toVenueLocalDate(summerInstant, "Australia/Brisbane")).toBe("2026-01-15");
  });

  it("zero-pads single-digit hours and minutes", () => {
    const instant = new Date("2026-06-01T23:05:00.000Z"); // AEST +10 -> 09:05 next day
    expect(toVenueLocalTime(instant, "Australia/Brisbane")).toBe("09:05");
  });
});

describe("shiftEndTimeOnStartDate", () => {
  it("returns the venue-local end-time for a same-day shift", () => {
    // 9am-2pm AEST (Brisbane, no DST) on the same local day.
    const start = new Date("2026-07-15T23:00:00.000Z"); // 2026-07-16 09:00 local
    const end = new Date("2026-07-16T04:00:00.000Z"); // 2026-07-16 14:00 local
    expect(shiftEndTimeOnStartDate(start, end, "Australia/Brisbane")).toBe("14:00");
  });

  it("returns the '24:00' sentinel for a shift that crosses into a later local day (overnight)", () => {
    // 10pm-2am local, Brisbane: end lands on the day AFTER start's local day.
    const start = new Date("2026-07-16T12:00:00.000Z"); // 2026-07-16 22:00 local
    const end = new Date("2026-07-16T16:00:00.000Z"); // 2026-07-17 02:00 local
    expect(shiftEndTimeOnStartDate(start, end, "Australia/Brisbane")).toBe("24:00");
  });
});

describe("resolveVenueLocalToUtc", () => {
  it("round-trips with toVenueLocalDate/toVenueLocalTime during daylight saving (AEDT, UTC+11)", () => {
    const instant = new Date("2026-01-15T22:00:00.000Z"); // 2026-01-16 09:00 local Melbourne
    const dateIso = toVenueLocalDate(instant, "Australia/Melbourne");
    const hhmm = toVenueLocalTime(instant, "Australia/Melbourne");
    expect(resolveVenueLocalToUtc(dateIso, hhmm, "Australia/Melbourne")).toEqual(instant);
  });

  it("round-trips outside daylight saving (AEST, UTC+10)", () => {
    const instant = new Date("2026-07-15T23:00:00.000Z"); // 2026-07-16 09:00 local Melbourne
    const dateIso = toVenueLocalDate(instant, "Australia/Melbourne");
    const hhmm = toVenueLocalTime(instant, "Australia/Melbourne");
    expect(resolveVenueLocalToUtc(dateIso, hhmm, "Australia/Melbourne")).toEqual(instant);
  });

  it("resolves a 9am Melbourne shift using AEST (UTC+10) the week before the DST transition", () => {
    // Australia's 2026 DST starts Sunday 2026-10-04. Monday 2026-09-28 is still AEST.
    expect(resolveVenueLocalToUtc("2026-09-28", "09:00", "Australia/Melbourne")).toEqual(
      new Date("2026-09-27T23:00:00.000Z"),
    );
  });

  it("resolves a 9am Melbourne shift using AEDT (UTC+11) the week after the DST transition", () => {
    // Monday 2026-10-05 is the first Monday after the 2026-10-04 spring-forward.
    expect(resolveVenueLocalToUtc("2026-10-05", "09:00", "Australia/Melbourne")).toEqual(
      new Date("2026-10-04T22:00:00.000Z"),
    );
  });

  it("Queensland never observes daylight saving (always UTC+10)", () => {
    expect(resolveVenueLocalToUtc("2026-01-15", "09:00", "Australia/Brisbane")).toEqual(
      new Date("2026-01-14T23:00:00.000Z"),
    );
    expect(resolveVenueLocalToUtc("2026-07-15", "09:00", "Australia/Brisbane")).toEqual(
      new Date("2026-07-14T23:00:00.000Z"),
    );
  });
});
