import { describe, it, expect } from "vitest";
import {
  toVenueLocalDate,
  toVenueLocalTime,
  shiftEndTimeOnStartDate,
  resolveVenueLocalToUtc,
  venueDayRange,
  RosterError,
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

describe("venueDayRange", () => {
  const iso = (r: { from: Date; toExclusive: Date }) => [r.from.toISOString(), r.toExclusive.toISOString()];

  it("reads a bare date as the venue's own day: Monday in Melbourne starts on Sunday 14:00 UTC", () => {
    expect(iso(venueDayRange("2026-06-08", "2026-06-08", "Australia/Melbourne"))).toEqual([
      "2026-06-07T14:00:00.000Z",
      "2026-06-08T14:00:00.000Z",
    ]);
  });

  it("includes a 6 am Monday Melbourne shift that UTC midnight would have dropped", () => {
    const sixAmMonday = resolveVenueLocalToUtc("2026-06-08", "06:00", "Australia/Melbourne");
    const { from, toExclusive } = venueDayRange("2026-06-08", "2026-06-08", "Australia/Melbourne");
    expect(sixAmMonday >= from && sixAmMonday < toExclusive).toBe(true);
    expect(sixAmMonday < new Date("2026-06-08")).toBe(true); // the old UTC-midnight lower bound
  });

  it("spans several days to the start of the day after `to`", () => {
    expect(iso(venueDayRange("2026-06-08", "2026-06-14", "Australia/Perth"))).toEqual([
      "2026-06-07T16:00:00.000Z",
      "2026-06-14T16:00:00.000Z",
    ]);
  });

  it("west of UTC the venue day starts after UTC midnight (New York, EDT = UTC-4)", () => {
    expect(iso(venueDayRange("2026-06-08", "2026-06-08", "America/New_York"))).toEqual([
      "2026-06-08T04:00:00.000Z",
      "2026-06-09T04:00:00.000Z",
    ]);
  });

  it("the day daylight saving starts is 23 hours long (Sydney, Sun 4 Oct 2026)", () => {
    const { from, toExclusive } = venueDayRange("2026-10-04", "2026-10-04", "Australia/Sydney");
    expect(iso({ from, toExclusive })).toEqual(["2026-10-03T14:00:00.000Z", "2026-10-04T13:00:00.000Z"]);
    expect((toExclusive.getTime() - from.getTime()) / 3_600_000).toBe(23);
  });

  it("the day daylight saving ends is 25 hours long (Sydney, Sun 5 Apr 2026)", () => {
    const { from, toExclusive } = venueDayRange("2026-04-05", "2026-04-05", "Australia/Sydney");
    expect(iso({ from, toExclusive })).toEqual(["2026-04-04T13:00:00.000Z", "2026-04-05T14:00:00.000Z"]);
    expect((toExclusive.getTime() - from.getTime()) / 3_600_000).toBe(25);
  });

  it("a range ending on the last day of a month or year rolls over", () => {
    expect(venueDayRange("2026-12-31", "2026-12-31", "UTC").toExclusive.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("keeps the old reading for a full instant: that exact moment, and a day after the `to` instant", () => {
    expect(iso(venueDayRange("2026-06-08T00:00:00Z", "2026-06-08T00:00:00Z", "Australia/Melbourne"))).toEqual([
      "2026-06-08T00:00:00.000Z",
      "2026-06-09T00:00:00.000Z",
    ]);
  });

  it.each([["not-a-date", "2026-06-08"], ["2026-06-08", "2026-13-40"], ["", "2026-06-08"]])(
    "rejects an invalid date (%s, %s) with a 400",
    (from, to) => {
      expect(() => venueDayRange(from, to, "Australia/Melbourne")).toThrowError(RosterError);
      try {
        venueDayRange(from, to, "Australia/Melbourne");
      } catch (err) {
        expect((err as RosterError).statusCode).toBe(400);
      }
    },
  );
});

