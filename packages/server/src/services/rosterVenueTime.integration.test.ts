import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  userOrganisation,
  storeLocation,
  rosterRole,
  rosterRoleDocument,
  shift,
  shiftAssignment,
  shiftSwapRequest,
  staffAvailability,
  publicHoliday,
  auditLog,
  notification,
} from "../db/schema.js";
import {
  createShift,
  listShifts,
  getWeekCalendar,
  listMyShifts,
  publishRoster,
  assignStaff,
  createAvailability,
  updateAvailability,
} from "./rosterService.js";
import { offerSwap, claimSwap, cancelSwap } from "./shiftSwapService.js";
import { handleAssignStaff, handleListMyShifts } from "../controllers/rosterController.js";
import { handleClaimSwap } from "../controllers/workforceController.js";

/**
 * Wave 4 roster fixes against a real database: venue-timezone ranges (Melbourne, Perth, New York, Sydney across
 * both daylight-saving edges), /shifts/mine, availability replay, and the coded 409s.
 * Gated on TENANT_IT=1 like the other roster suites. Every venue uses a state-less address, so no public-holiday
 * calendar is needed, except `vEdge`, whose made-up state "ZZ" has only 2027 loaded.
 */
const RUN = process.env.TENANT_IT === "1";
const tag = `w4_${Date.now().toString(36)}`;

describe.skipIf(!RUN)("roster venue time and Wave 4 fixes (real DB)", () => {
  let orgId: number;
  let admin: number;
  let staffB: number;
  let staffC: number;
  let roleId: string;
  let docRoleId: string;
  const venue = {} as Record<"mel" | "perth" | "ny" | "syd" | "edge", string>;
  let holidayId: string;

  const mkShift = async (loc: string, startIso: string, hours = 8, role = roleId) =>
    (
      await createShift(
        orgId,
        { storeLocationId: loc, rosterRoleId: role, startDatetime: startIso, endDatetime: new Date(new Date(startIso).getTime() + hours * 3_600_000).toISOString() },
        admin,
      )
    ).shiftId;

  const mkVenue = async (key: keyof typeof venue, ianaTimezone: string, state: string | null = null) => {
    [{ id: venue[key] }] = await db
      .insert(storeLocation)
      .values({ organisationId: orgId, locationName: `${tag}-${key}`, storeKey: `${tag}-${key}`.slice(0, 25), createdBy: admin, state, ianaTimezone })
      .returning({ id: storeLocation.storeLocationId });
  };

  beforeAll(async () => {
    [{ id: admin }] = await db.insert(user).values({ userName: "W4 Admin", userEmail: `${tag}-a@it.test` }).returning({ id: user.userId });
    [{ id: staffB }] = await db.insert(user).values({ userName: "W4 Staff B", userEmail: `${tag}-b@it.test` }).returning({ id: user.userId });
    [{ id: staffC }] = await db.insert(user).values({ userName: "W4 Staff C", userEmail: `${tag}-c@it.test` }).returning({ id: user.userId });
    [{ id: orgId }] = await db
      .insert(organisation)
      .values({ organisationName: tag, joinKey: `${tag}-k`.slice(0, 25), createdBy: admin })
      .returning({ id: organisation.organisationId });
    await db.insert(userOrganisation).values([
      { userId: admin, organisationId: orgId, role: "admin" },
      { userId: staffB, organisationId: orgId, role: "member" },
      { userId: staffC, organisationId: orgId, role: "member" },
    ]);
    await mkVenue("mel", "Australia/Melbourne");
    await mkVenue("perth", "Australia/Perth");
    await mkVenue("ny", "America/New_York");
    await mkVenue("syd", "Australia/Sydney");
    await mkVenue("edge", "Australia/Melbourne", "ZZ");
    [{ id: roleId }] = await db.insert(rosterRole).values({ organisationId: orgId, roleName: `${tag}-cook` }).returning({ id: rosterRole.rosterRoleId });
    [{ id: docRoleId }] = await db.insert(rosterRole).values({ organisationId: orgId, roleName: `${tag}-bar` }).returning({ id: rosterRole.rosterRoleId });
    await db.insert(rosterRoleDocument).values({ rosterRoleId: docRoleId, documentType: `${tag}-rsa` });
    [{ id: holidayId }] = await db
      .insert(publicHoliday)
      .values({ jurisdiction: "ZZ", holidayDate: "2027-01-26", holidayName: `${tag} holiday`, loadedForYear: 2027 })
      .returning({ id: publicHoliday.publicHolidayId });
  });

  afterAll(async () => {
    if (holidayId) await db.delete(publicHoliday).where(eq(publicHoliday.publicHolidayId, holidayId));
    if (orgId) {
      const ids = (await db.select({ id: shift.shiftId }).from(shift).where(eq(shift.organisationId, orgId))).map((r) => r.id);
      if (ids.length) {
        await db.delete(shiftSwapRequest).where(inArray(shiftSwapRequest.shiftId, ids));
        await db.delete(shiftAssignment).where(inArray(shiftAssignment.shiftId, ids));
        await db.delete(shift).where(inArray(shift.shiftId, ids));
      }
      await db.delete(staffAvailability).where(eq(staffAvailability.organisationId, orgId));
      await db.delete(rosterRoleDocument).where(eq(rosterRoleDocument.rosterRoleId, docRoleId));
      await db.delete(rosterRole).where(eq(rosterRole.organisationId, orgId));
      await db.delete(storeLocation).where(eq(storeLocation.organisationId, orgId));
      await db.delete(notification).where(eq(notification.organisationId, orgId));
      await db.delete(auditLog).where(eq(auditLog.organisationId, orgId));
      await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, orgId));
      await db.delete(organisation).where(eq(organisation.organisationId, orgId));
    }
    await db.delete(user).where(inArray(user.userId, [admin, staffB, staffC].filter(Boolean)));
  });

  describe("venue-day ranges", () => {
    it("publishes a 6 am Monday Melbourne shift in a Monday publish, and only the Monday ones", async () => {
      const mon6am = await mkShift(venue.mel, "2026-06-07T20:00:00Z"); // Mon 8 Jun 06:00 AEST
      const sunNight = await mkShift(venue.mel, "2026-06-07T13:30:00Z"); // Sun 7 Jun 23:30 AEST
      const tueEarly = await mkShift(venue.mel, "2026-06-08T14:30:00Z"); // Tue 9 Jun 00:30 AEST

      const result = await publishRoster(orgId, venue.mel, "2026-06-08", "2026-06-08", admin);

      expect(result.publishedShiftIds).toContain(mon6am);
      expect(result.publishedShiftIds).not.toContain(sunNight);
      expect(result.publishedShiftIds).not.toContain(tueEarly);
    });

    it("reads the holiday years on the venue's calendar: 1 Jan 6 am Melbourne is 31 Dec in UTC but needs only 2027", async () => {
      const newYear = await mkShift(venue.edge, "2026-12-31T19:00:00Z"); // Fri 1 Jan 2027 06:00 AEDT
      const result = await publishRoster(orgId, venue.edge, "2027-01-01", "2027-01-01", admin);
      expect(result.publishedShiftIds).toContain(newYear);
    });

    it("still refuses a range that really reaches a year with no holidays loaded", async () => {
      await expect(publishRoster(orgId, venue.edge, "2026-12-31", "2027-01-01", admin)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("the week calendar is the venue's Monday to Sunday", async () => {
      const mon6am = await mkShift(venue.perth, "2026-06-14T22:00:00Z"); // Mon 15 Jun 06:00 AWST
      const sunLate = await mkShift(venue.perth, "2026-06-21T15:00:00Z"); // Sun 21 Jun 23:00 AWST
      const nextMon = await mkShift(venue.perth, "2026-06-21T16:30:00Z"); // Mon 22 Jun 00:30 AWST
      const prevSun = await mkShift(venue.perth, "2026-06-14T15:30:00Z"); // Sun 14 Jun 23:30 AWST

      const week = (await getWeekCalendar(orgId, venue.perth, "2026-06-15", "2026-06-21")).map((s) => s.shiftId);

      expect(week).toContain(mon6am);
      expect(week).toContain(sunLate);
      expect(week).not.toContain(nextMon);
      expect(week).not.toContain(prevSun);
    });

    it("the list, for one venue or across venues in different zones, uses each venue's own day", async () => {
      const mel = await mkShift(venue.mel, "2026-07-12T20:00:00Z"); // Mon 13 Jul 06:00 AEST
      const perth = await mkShift(venue.perth, "2026-07-12T22:00:00Z"); // Mon 13 Jul 06:00 AWST
      const ny = await mkShift(venue.ny, "2026-07-14T02:00:00Z"); // Mon 13 Jul 22:00 EDT (Tue in UTC)
      const melSunNight = await mkShift(venue.mel, "2026-07-12T13:30:00Z"); // Sun 12 Jul 23:30 AEST
      const nySunNight = await mkShift(venue.ny, "2026-07-13T03:00:00Z"); // Sun 12 Jul 23:00 EDT

      const all = (await listShifts(orgId, { from: "2026-07-13", to: "2026-07-13" })).map((s) => s.shiftId);
      expect(all).toEqual(expect.arrayContaining([mel, perth, ny]));
      expect(all).not.toContain(melSunNight);
      expect(all).not.toContain(nySunNight);

      const nyOnly = (await listShifts(orgId, { storeLocationId: venue.ny, from: "2026-07-13", to: "2026-07-13" })).map((s) => s.shiftId);
      expect(nyOnly).toEqual([ny]);
    });

    it("a full instant keeps its old meaning in the list", async () => {
      const at = await mkShift(venue.mel, "2026-08-03T10:00:00Z");
      const rows = (await listShifts(orgId, { storeLocationId: venue.mel, from: "2026-08-03T10:00:00Z", to: "2026-08-03T10:00:00Z" })).map((s) => s.shiftId);
      expect(rows).toEqual([at]);
    });

    it("the day daylight saving starts is 23 hours: Sydney Sun 4 Oct 2026", async () => {
      const first = await mkShift(venue.syd, "2026-10-03T14:30:00Z", 2); // 00:30 AEST
      const last = await mkShift(venue.syd, "2026-10-04T12:30:00Z", 1); // 23:30 AEDT
      const next = await mkShift(venue.syd, "2026-10-04T13:30:00Z", 1); // Mon 5 Oct 00:30 AEDT
      const before = await mkShift(venue.syd, "2026-10-03T13:30:00Z", 1); // Sat 3 Oct 23:30 AEST

      const cal = (await getWeekCalendar(orgId, venue.syd, "2026-10-04", "2026-10-04")).map((s) => s.shiftId);
      const list = (await listShifts(orgId, { storeLocationId: venue.syd, from: "2026-10-04", to: "2026-10-04" })).map((s) => s.shiftId);
      for (const got of [cal, list]) {
        expect(got).toEqual(expect.arrayContaining([first, last]));
        expect(got).not.toContain(next);
        expect(got).not.toContain(before);
      }
    });

    it("the day daylight saving ends is 25 hours: Sydney Sun 5 Apr 2026", async () => {
      const first = await mkShift(venue.syd, "2026-04-04T13:30:00Z", 2); // 00:30 AEDT
      const last = await mkShift(venue.syd, "2026-04-05T13:30:00Z", 1); // 23:30 AEST
      const next = await mkShift(venue.syd, "2026-04-05T14:30:00Z", 1); // Mon 6 Apr 00:30 AEST
      const before = await mkShift(venue.syd, "2026-04-04T12:30:00Z", 1); // Sat 4 Apr 23:30 AEDT

      const cal = (await getWeekCalendar(orgId, venue.syd, "2026-04-05", "2026-04-05")).map((s) => s.shiftId);
      const list = (await listShifts(orgId, { storeLocationId: venue.syd, from: "2026-04-05", to: "2026-04-05" })).map((s) => s.shiftId);
      for (const got of [cal, list]) {
        expect(got).toEqual(expect.arrayContaining([first, last]));
        expect(got).not.toContain(next);
        expect(got).not.toContain(before);
      }
    });

    it("rejects a date that is not a date with a coded 400", async () => {
      await expect(listShifts(orgId, { from: "nope" })).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION" });
    });

    it("rejects a calendar day that does not exist with a coded 400 on every list, not a database error", async () => {
      const bad = { statusCode: 400, code: "VALIDATION" };
      await expect(listShifts(orgId, { from: "2026-02-30" })).rejects.toMatchObject(bad);
      await expect(listShifts(orgId, { to: "2026-04-31" })).rejects.toMatchObject(bad);
      await expect(listMyShifts(orgId, staffB, { from: "2026-02-30" })).rejects.toMatchObject(bad);
      await expect(listMyShifts(orgId, staffB, { to: "2026-04-31" })).rejects.toMatchObject(bad);
      await expect(getWeekCalendar(orgId, venue.syd, "2026-02-30", "2026-03-01")).rejects.toMatchObject(bad);
    });
  });

  describe("GET /shifts/mine", () => {
    const assign = async (shiftId: string, userId: number, status = "Confirmed", consent: string | null = null) =>
      (await db.insert(shiftAssignment).values({ shiftId, userId, status, publicHolidayConsent: consent }).returning({ id: shiftAssignment.assignmentId }))[0].id;
    const setStatus = (shiftId: string, status: string) => db.update(shift).set({ status }).where(eq(shift.shiftId, shiftId));
    const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

    it("with no filters lists Drafts too (the web shape); excludeDrafts leaves them out but keeps a Draft awaiting holiday consent; cancelled never shows", async () => {
      const published = await mkShift(venue.mel, daysFromNow(3));
      const draft = await mkShift(venue.mel, daysFromNow(4));
      const draftConsent = await mkShift(venue.perth, daysFromNow(5));
      const cancelled = await mkShift(venue.mel, daysFromNow(6));
      await setStatus(published, "Published");
      await db.update(shift).set({ isPublicHoliday: true }).where(eq(shift.shiftId, published));
      await setStatus(cancelled, "Cancelled");
      for (const id of [published, draft, cancelled]) await assign(id, staffB);
      await assign(draftConsent, staffB, "Pending", "Requested");

      const everything = (await listMyShifts(orgId, staffB)).map((s) => s.shiftId);
      expect(everything).toEqual(expect.arrayContaining([published, draft, draftConsent]));
      expect(everything).not.toContain(cancelled);

      const mine = await listMyShifts(orgId, staffB, { excludeDrafts: true });
      const ids = mine.map((s) => s.shiftId);

      expect(ids).toContain(published);
      expect(ids).toContain(draftConsent);
      expect(ids).not.toContain(draft);
      expect(ids).not.toContain(cancelled);
      expect(mine.find((s) => s.shiftId === published)).toMatchObject({
        isPublicHoliday: true,
        locationName: `${tag}-mel`,
        ianaTimezone: "Australia/Melbourne",
        state: null,
        roleName: `${tag}-cook`,
      });
      expect(mine.find((s) => s.shiftId === draftConsent)).toMatchObject({ ianaTimezone: "Australia/Perth", publicHolidayConsent: "Requested" });
    });

    it("has no date window unless asked: an old shift is listed with no filters, and `from`, `to` and `limit` bound the list, soonest first", async () => {
      const old = await mkShift(venue.mel, daysFromNow(-40));
      const soon = await mkShift(venue.mel, daysFromNow(20));
      const later = await mkShift(venue.mel, daysFromNow(40));
      for (const id of [old, soon, later]) {
        await setStatus(id, "Published");
        await assign(id, staffC);
      }

      expect((await listMyShifts(orgId, staffC)).map((s) => s.shiftId)).toEqual([old, soon, later]);
      expect((await listMyShifts(orgId, staffC, { from: daysFromNow(-14).slice(0, 10) })).map((s) => s.shiftId)).toEqual([soon, later]);
      expect((await listMyShifts(orgId, staffC, { to: daysFromNow(30).slice(0, 10) })).map((s) => s.shiftId)).toEqual([old, soon]);
      expect((await listMyShifts(orgId, staffC, { limit: 2 })).map((s) => s.shiftId)).toEqual([old, soon]);
    });

    it("with no filters returns more than 100 shifts: there is no default page size", async () => {
      const ids = await Promise.all(Array.from({ length: 101 }, (_, i) => mkShift(venue.mel, daysFromNow(60 + i))));
      await db.insert(shiftAssignment).values(ids.map((shiftId) => ({ shiftId, userId: staffC, status: "Confirmed" })));

      const mine = (await listMyShifts(orgId, staffC)).map((s) => s.shiftId);
      expect(mine).toEqual(expect.arrayContaining(ids));
      expect(await listMyShifts(orgId, staffC, { limit: 5 })).toHaveLength(5);
    });

    it.each([{ limit: "0" }, { limit: "501" }, { excludeDrafts: "yes" }, { excludeDrafts: "1" }])(
      "the controller answers a bad query (%o) with 400 VALIDATION",
      async (query) => {
        const sent = fakeRes();
        await handleListMyShifts({ user: { sub: staffB }, query } as unknown as Request, sent.res, () => undefined);
        expect(sent.status).toBe(400);
        expect(sent.body).toMatchObject({ code: "VALIDATION" });
      },
    );

    it("the controller lists Drafts with no query and leaves them out with excludeDrafts=true", async () => {
      const draft = await mkShift(venue.mel, daysFromNow(7));
      await assign(draft, staffB);
      const list = async (query: Record<string, string>) => {
        const sent = fakeRes();
        await handleListMyShifts({ user: { sub: staffB }, query } as unknown as Request, sent.res, () => undefined);
        return (sent.body as { shiftId: string }[]).map((s) => s.shiftId);
      };

      expect(await list({})).toContain(draft);
      expect(await list({ excludeDrafts: "false" })).toContain(draft);
      expect(await list({ excludeDrafts: "true" })).not.toContain(draft);
    });
  });

  describe("availability", () => {
    const window = { dayOfWeek: 2, availableFrom: "09:00", availableUntil: "17:00", effectiveFrom: "2026-09-01" };

    it("a replayed create returns the existing row, for an any-venue open-ended window and for a venue window", async () => {
      const first = await createAvailability(orgId, staffB, window);
      const again = await createAvailability(orgId, staffB, { ...window, effectiveUntil: null, storeLocationId: null });
      expect(again.staffAvailabilityId).toBe(first.staffAvailabilityId);

      const atVenue = await createAvailability(orgId, staffB, { ...window, storeLocationId: venue.mel });
      expect(atVenue.staffAvailabilityId).not.toBe(first.staffAvailabilityId);
      expect((await createAvailability(orgId, staffB, { ...window, storeLocationId: venue.mel })).staffAvailabilityId).toBe(atVenue.staffAvailabilityId);

      const rows = await db.select().from(staffAvailability).where(eq(staffAvailability.userId, staffB));
      expect(rows.filter((r) => r.dayOfWeek === 2)).toHaveLength(2);
    });

    it("windows that differ in an end date, in the times or in the person are different windows", async () => {
      const base = await createAvailability(orgId, staffC, window);
      const ended = await createAvailability(orgId, staffC, { ...window, effectiveUntil: "2026-12-31" });
      const shorter = await createAvailability(orgId, staffC, { ...window, availableUntil: "16:00" });
      const other = await createAvailability(orgId, staffB, { ...window, availableUntil: "16:30" });
      expect(new Set([base, ended, shorter, other].map((r) => r.staffAvailabilityId)).size).toBe(4);
    });

    it("editing a window into a twin of another answers 409 CONFLICT, not 500", async () => {
      const a = await createAvailability(orgId, staffC, { ...window, dayOfWeek: 4 });
      const b = await createAvailability(orgId, staffC, { ...window, dayOfWeek: 5 });
      await expect(updateAvailability(orgId, b.staffAvailabilityId, staffC, { ...window, dayOfWeek: 4 })).rejects.toMatchObject({
        statusCode: 409,
        code: "CONFLICT",
      });
      expect(a.staffAvailabilityId).not.toBe(b.staffAvailabilityId);
    });
  });

  describe("coded 409s", () => {
    it("assignment: not Draft, already assigned and blocked by compliance carry three different codes", async () => {
      const draft = await mkShift(venue.mel, "2026-11-02T00:00:00Z");
      await assignStaff(orgId, draft, staffB, admin);
      await expect(assignStaff(orgId, draft, staffB, admin)).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_ALREADY_ASSIGNED" });

      const barShift = await mkShift(venue.mel, "2026-11-03T00:00:00Z", 8, docRoleId);
      await expect(assignStaff(orgId, barShift, staffB, admin)).rejects.toMatchObject({ statusCode: 409, code: "ASSIGNMENT_BLOCKED_COMPLIANCE" });

      await db.update(shift).set({ status: "Published" }).where(eq(shift.shiftId, draft));
      await expect(assignStaff(orgId, draft, staffC, admin)).rejects.toMatchObject({ statusCode: 409, code: "SHIFT_NOT_DRAFT" });
    });

    it("the controller puts the code, and the blocked detail, in the response body", async () => {
      const barShift = await mkShift(venue.mel, "2026-11-04T00:00:00Z", 8, docRoleId);
      const sent = fakeRes();
      await handleAssignStaff({ user: { sub: admin }, params: { id: barShift }, body: { userId: staffC } } as unknown as Request, sent.res, () => undefined);
      expect(sent.status).toBe(409);
      expect(sent.body).toMatchObject({ code: "ASSIGNMENT_BLOCKED_COMPLIANCE", blocked: { documentType: `${tag}-rsa`, reason: "missing" } });
    });

    it("swap claim: a replay of your own win, losing to someone else and a cancelled offer are told apart", async () => {
      const s = await mkShift(venue.mel, "2026-11-10T00:00:00Z");
      const [{ id: assignmentId }] = await db
        .insert(shiftAssignment)
        .values({ shiftId: s, userId: admin, status: "Confirmed" })
        .returning({ id: shiftAssignment.assignmentId });
      const offer = await offerSwap(orgId, assignmentId, admin);

      await claimSwap(orgId, offer.swapRequestId, staffB);
      await expect(claimSwap(orgId, offer.swapRequestId, staffB)).rejects.toMatchObject({ statusCode: 409, code: "SWAP_CLAIMED_BY_YOU" });
      await expect(claimSwap(orgId, offer.swapRequestId, staffC)).rejects.toMatchObject({ statusCode: 409, code: "SWAP_CLAIMED_BY_OTHER" });

      const [{ assignmentId: bAssignment }] = await db
        .select({ assignmentId: shiftAssignment.assignmentId })
        .from(shiftAssignment)
        .where(eq(shiftAssignment.shiftId, s));
      const second = await offerSwap(orgId, bAssignment, staffB);
      await cancelSwap(orgId, second.swapRequestId, staffB);
      await expect(claimSwap(orgId, second.swapRequestId, staffC)).rejects.toMatchObject({ statusCode: 409, code: "SWAP_CANCELLED" });
    });

    it("swap claim: two people claiming at the same moment, one wins and the other is told it went to someone else", async () => {
      const s = await mkShift(venue.mel, "2026-11-12T00:00:00Z");
      const [{ id: assignmentId }] = await db
        .insert(shiftAssignment)
        .values({ shiftId: s, userId: admin, status: "Confirmed" })
        .returning({ id: shiftAssignment.assignmentId });
      const offer = await offerSwap(orgId, assignmentId, admin);

      const results = await Promise.allSettled([claimSwap(orgId, offer.swapRequestId, staffB), claimSwap(orgId, offer.swapRequestId, staffC)]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ statusCode: 409, code: "SWAP_CLAIMED_BY_OTHER" });
    });

    it("swap claim over HTTP handler carries the code in the body", async () => {
      const s = await mkShift(venue.mel, "2026-11-11T00:00:00Z");
      const [{ id: assignmentId }] = await db
        .insert(shiftAssignment)
        .values({ shiftId: s, userId: admin, status: "Confirmed" })
        .returning({ id: shiftAssignment.assignmentId });
      const offer = await offerSwap(orgId, assignmentId, admin);
      await claimSwap(orgId, offer.swapRequestId, staffB);

      const sent = fakeRes();
      await handleClaimSwap({ user: { sub: staffB }, params: { id: offer.swapRequestId } } as unknown as Request, sent.res, () => undefined);
      expect(sent.status).toBe(409);
      expect(sent.body).toMatchObject({ code: "SWAP_CLAIMED_BY_YOU" });
    });
  });
});

function fakeRes() {
  const out: { status: number; body: unknown; res: Response } = { status: 200, body: undefined, res: undefined as unknown as Response };
  out.res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.body = body;
      return this;
    },
  } as unknown as Response;
  return out;
}
