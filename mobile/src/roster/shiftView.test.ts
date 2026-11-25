import { describe, it, expect } from "vitest";
import type { MyShift } from "@culinaire/shared/schemas/roster";
import { answerNeeded, dayLabel, hoursLabel, isOver, rosterSections, timeLabel, venueToday, weekOf, zoneOr, hiddenConsents, shownSwaps, swapZone } from "./shiftView";

const shift = (over: Partial<MyShift> = {}): MyShift => ({ shiftId: "s1", assignmentId: "a1", storeLocationId: "L1", locationName: "Bar", ianaTimezone: "Australia/Melbourne", roleName: "Chef", startDatetime: "2026-11-25T22:00:00Z", endDatetime: "2026-11-26T06:00:00Z", status: "Published", isPublicHoliday: false, assignmentStatus: "Confirmed", publicHolidayConsent: null, ...over });
/** Thursday 26 November 2026, 9 am in Melbourne (a Monday-to-Sunday week from the 23rd). */
const NOW = Date.parse("2026-11-25T22:00:00Z");

describe("shift times are the venue's, whatever zone the phone is in", () => {
  it("reads one instant on two venues' clocks", () => {
    const s = shift();
    expect([dayLabel(s), timeLabel(s)]).toEqual(["Thu 26 Nov", "9:00 am–5:00 pm"]);
    const perth = shift({ ianaTimezone: "Australia/Perth" });
    expect([dayLabel(perth), timeLabel(perth)]).toEqual(["Thu 26 Nov", "6:00 am–2:00 pm"]);
    const la = shift({ ianaTimezone: "America/Los_Angeles" });
    expect([dayLabel(la), timeLabel(la)]).toEqual(["Wed 25 Nov", "2:00 pm–10:00 pm"]);
  });

  it("says which day a shift that runs past midnight ends", () => {
    expect(timeLabel(shift({ startDatetime: "2026-11-27T07:00:00Z", endDatetime: "2026-11-27T15:00:00Z" }))).toBe("6:00 pm–2:00 am Sat");
  });

  it("falls back to the server's own default when a venue's zone is missing or wrong", () => {
    expect(zoneOr("")).toBe("Australia/Melbourne");
    expect(zoneOr("Mars/Base")).toBe("Australia/Melbourne");
    expect(zoneOr("Australia/Perth")).toBe("Australia/Perth");
  });

  it("counts the hours worked across a clock change", () => {
    expect(hoursLabel(shift())).toBe("8 h");
    expect(hoursLabel(shift({ endDatetime: "2026-11-26T05:30:00Z" }))).toBe("7.5 h");
    // Melbourne's clocks went forward at 2 am on 4 October 2026: 10 pm to 6 am was seven hours.
    expect(hoursLabel(shift({ startDatetime: "2026-10-03T12:00:00Z", endDatetime: "2026-10-03T19:00:00Z" }))).toBe("7 h");
  });

  it("knows the venue's own today", () => {
    const late = Date.parse("2026-11-25T13:30:00Z");
    expect(venueToday("Australia/Melbourne", late)).toBe("2026-11-26");
    expect(venueToday("Australia/Perth", late)).toBe("2026-11-25");
  });
});

describe("this week and next, on the venue's clock", () => {
  const at = (iso: string, zone = "Australia/Melbourne") => weekOf(shift({ startDatetime: iso, ianaTimezone: zone }), NOW);

  it("runs Monday to Sunday", () => {
    expect(at("2026-11-22T12:59:00Z")).toBe("past"); // Sunday 22nd, 11:59 pm
    expect(at("2026-11-22T13:00:00Z")).toBe("this"); // Monday 23rd, midnight
    expect(at("2026-11-29T12:59:00Z")).toBe("this"); // Sunday 29th, 11:59 pm
    expect(at("2026-11-29T13:00:00Z")).toBe("next"); // Monday 30th
    expect(at("2026-12-06T12:59:00Z")).toBe("next"); // Sunday 6th
    expect(at("2026-12-06T13:00:00Z")).toBe("later");
  });

  it("keeps a 6 am Monday shift in its own week (it is still Sunday in UTC)", () => {
    expect(at("2026-11-29T19:00:00Z")).toBe("next");
    expect(at("2026-11-29T19:00:00Z", "America/Los_Angeles")).toBe("this");
  });
});

describe("what the list shows", () => {
  it("never shows a draft shift, even one with a consent question on it, and counts those apart", () => {
    const rows = [shift(), shift({ assignmentId: "a2", status: "Draft" }), shift({ assignmentId: "a3", status: "Draft", publicHolidayConsent: "Requested" })];
    expect(rosterSections(rows, NOW).flatMap((s) => s.shifts.map((r) => r.assignmentId))).toEqual(["a1"]);
    expect(hiddenConsents(rows)).toBe(1);
  });

  it("groups by week in order, leaves last week out and has no empty section", () => {
    const rows = [shift({ assignmentId: "old", startDatetime: "2026-11-16T22:00:00Z" }), shift({ assignmentId: "later", startDatetime: "2026-12-20T22:00:00Z" }), shift({ assignmentId: "now" })];
    expect(rosterSections(rows, NOW).map((s) => [s.title, s.shifts.map((r) => r.assignmentId)])).toEqual([["This week", ["now"]], ["Later", ["later"]]]);
  });

  it("needs an answer while pending or asked about a public holiday, and not once the shift is over", () => {
    expect(answerNeeded(shift({ assignmentStatus: "Pending" }), NOW)).toBe(true);
    expect(answerNeeded(shift({ publicHolidayConsent: "Requested" }), NOW)).toBe(true);
    expect(answerNeeded(shift(), NOW)).toBe(false);
    const over = shift({ assignmentStatus: "Pending", startDatetime: "2026-11-23T22:00:00Z", endDatetime: "2026-11-24T06:00:00Z" });
    expect([isOver(over, NOW), answerNeeded(over, NOW)]).toEqual([true, false]);
  });
});

describe("the zone of a shift offered for swap", () => {
  const swap = { swapRequestId: "w", shiftId: "s9", fromAssignmentId: "a9", fromUserId: 2, fromUserName: "Sam", startDatetime: "2026-11-27T01:00:00Z", endDatetime: "2026-11-27T09:00:00Z", roleName: "Chef", storeLocationId: "L2" };
  const loc = (id: string, zone?: string) => ({ storeLocationId: id, organisationId: 1, locationName: `Venue ${id}`, classification: "branch", ianaTimezone: zone });

  it("is the one the server sends with the swap, for any venue", () => {
    expect(swapZone({ ...swap, ianaTimezone: "Australia/Adelaide", locationName: "Adelaide Bar" }, [loc("L2", "Australia/Perth")], [])).toEqual({ zone: "Australia/Adelaide", locationName: "Adelaide Bar" });
  });

  it("never shows a swap of a draft or cancelled shift", () => {
    const of = (shiftStatus?: string) => shownSwaps([{ ...swap, shiftStatus, ianaTimezone: "Australia/Perth" }], 1, [], [], NOW);
    expect([of("Published"), of(undefined)].map((r) => r.shown.length)).toEqual([1, 1]);
    for (const status of ["Draft", "Cancelled"]) expect(of(status)).toEqual({ shown: [], hidden: 0 });
  });

  it("from an older server comes from the person's own locations or shifts, and is unknown otherwise: never the phone's", () => {
    expect(swapZone(swap, [loc("L2", "Australia/Perth")], [])).toEqual({ zone: "Australia/Perth", locationName: "Venue L2" });
    expect(swapZone(swap, [loc("L1", "Australia/Perth")], [shift({ storeLocationId: "L2", ianaTimezone: "Australia/Adelaide" })])).toEqual({ zone: "Australia/Adelaide", locationName: "Bar" });
    expect(swapZone(swap, [loc("L1", "Australia/Perth"), loc("L2")], [shift()])).toBeNull();
  });

  it("leaves out an offer of a shift the person already works, and does not count it, but not one they declined", () => {
    const work = (assignmentStatus: string) => shownSwaps([{ ...swap, ianaTimezone: "Australia/Perth" }], 1, [], [shift({ shiftId: "s9", assignmentId: "a1", assignmentStatus })], NOW);
    for (const status of ["Confirmed", "Pending"]) expect(work(status)).toEqual({ shown: [], hidden: 0 });
    expect(work("Declined").shown).toHaveLength(1);
  });

  it("shows a colleague's offers that have not started where the zone is known, and counts the rest", () => {
    const all = [swap, { ...swap, swapRequestId: "other", storeLocationId: "L9" }, { ...swap, swapRequestId: "mine", fromUserId: 1 }, { ...swap, swapRequestId: "begun", startDatetime: "2026-11-25T22:00:00Z" }];
    const { shown, hidden } = shownSwaps(all, 1, [loc("L2", "Australia/Perth")], [], NOW);
    expect(shown).toMatchObject([{ swapRequestId: "w", ianaTimezone: "Australia/Perth", locationName: "Venue L2" }]);
    expect(hidden).toBe(1);
  });
});
