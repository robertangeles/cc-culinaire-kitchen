import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, and, desc, inArray } from "drizzle-orm";
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
  staffAvailability,
  complianceDocument,
  documentExpiryRule,
  awardRule,
  publicHoliday,
  auditLog,
  notification,
} from "../db/schema.js";
import {
  listRoles,
  createRole,
  setRoleDocuments,
  listRoleDocuments,
  listShifts,
  createShift,
  assignStaff,
  respondToAssignment,
  removeAssignment,
  publishRoster,
  createAvailability,
  listShiftAssignments,
} from "./rosterService.js";
import { requestConsent, respondToConsent } from "./consentService.js";

/**
 * Real-database behaviour of Roster Core (Phase 2, Slice 3), end to end
 * against Postgres. Gated on TENANT_IT=1, same convention as
 * compliance.integration.test.ts. Self-cleaning: children before parents.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `rv_${Date.now().toString(36)}`;
const docType = `${tag}-rsa`;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

describe.skipIf(!RUN)("roster service (real DB)", () => {
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let userC: number;
  let locA: string;
  let locB: string;
  let roleId: string;
  let ruleId: string;
  let publicHolidayId: string;
  let publicHolidayPriorYearId: string;

  beforeAll(async () => {
    [{ id: userA }] = await db
      .insert(user)
      .values({ userName: "Roster Staff A", userEmail: `${tag}-a@it.test` })
      .returning({ id: user.userId });
    [{ id: userB }] = await db
      .insert(user)
      .values({ userName: "Roster Staff B", userEmail: `${tag}-b@it.test` })
      .returning({ id: user.userId });
    [{ id: userC }] = await db
      .insert(user)
      .values({ userName: "Roster Staff C (org B)", userEmail: `${tag}-c@it.test` })
      .returning({ id: user.userId });

    [{ id: orgA }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-A`, joinKey: `${tag}-ka`.slice(0, 25), createdBy: userA })
      .returning({ id: organisation.organisationId });
    [{ id: orgB }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-B`, joinKey: `${tag}-kb`.slice(0, 25), createdBy: userC })
      .returning({ id: organisation.organisationId });

    await db.insert(userOrganisation).values([
      { userId: userA, organisationId: orgA, role: "admin" },
      { userId: userB, organisationId: orgA, role: "admin" },
      { userId: userC, organisationId: orgB, role: "admin" },
      // userC also staffs orgA — a real dual-membership case (joinOrganisation
      // lets any user belong to more than one org), used below to prove a
      // document verified under orgB's compliance program can't gate an
      // assignment at orgA.
      { userId: userC, organisationId: orgA, role: "member" },
    ]);

    [{ id: locA }] = await db
      .insert(storeLocation)
      .values({
        organisationId: orgA,
        locationName: `${tag}-locA`,
        storeKey: `${tag}-ska`.slice(0, 25),
        createdBy: userA,
        state: "VIC",
      })
      .returning({ id: storeLocation.storeLocationId });
    [{ id: locB }] = await db
      .insert(storeLocation)
      .values({
        organisationId: orgB,
        locationName: `${tag}-locB`,
        storeKey: `${tag}-skb`.slice(0, 25),
        createdBy: userC,
      })
      .returning({ id: storeLocation.storeLocationId });

    [{ id: roleId }] = await db
      .insert(rosterRole)
      .values({ organisationId: orgA, storeLocationId: locA, roleName: `${tag}-bartender` })
      .returning({ id: rosterRole.rosterRoleId });

    await db.insert(rosterRoleDocument).values({ rosterRoleId: roleId, documentType: docType });

    [{ id: ruleId }] = await db
      .insert(documentExpiryRule)
      .values({
        documentType: docType,
        jurisdiction: "VIC",
        blockRosterOnExpiry: true,
        effectiveFrom: "2020-01-01",
      })
      .returning({ id: documentExpiryRule.documentExpiryRuleId });

    // Loads VIC for the current year — every existing publishRoster test
    // uses a TODAY-relative window, so this is enough for them to pass the
    // fail-loud holiday-calendar gate without every test needing to seed its
    // own row. The date itself is arbitrary; only (jurisdiction,
    // loadedForYear) matters for "is this year loaded".
    [{ id: publicHolidayId }] = await db
      .insert(publicHoliday)
      .values({
        jurisdiction: "VIC",
        holidayDate: `${new Date().getFullYear()}-01-01`,
        holidayName: `${tag} New Year's Day`,
        loadedForYear: new Date().getFullYear(),
      })
      .returning({ id: publicHoliday.publicHolidayId });

    // Also load the PRIOR year — the isPublicHoliday test below targets Jan
    // 1 and widens its publish window by addDays(-1) (same reason every
    // other publishRoster test in this file widens: a shift's UTC instant
    // can sit outside a tight from/to boundary). Dec 31 the year before
    // still falls inside that window, so assertHolidayCalendarLoaded's
    // per-year loop needs that year loaded too, or its own fail-loud gate
    // blocks a test that isn't exercising the gap-check path at all.
    [{ id: publicHolidayPriorYearId }] = await db
      .insert(publicHoliday)
      .values({
        jurisdiction: "VIC",
        holidayDate: `${new Date().getFullYear() - 1}-01-01`,
        holidayName: `${tag} New Year's Day (prior year)`,
        loadedForYear: new Date().getFullYear() - 1,
      })
      .returning({ id: publicHoliday.publicHolidayId });
  });

  afterAll(async () => {
    if (publicHolidayId) await db.delete(publicHoliday).where(eq(publicHoliday.publicHolidayId, publicHolidayId));
    if (publicHolidayPriorYearId) {
      await db.delete(publicHoliday).where(eq(publicHoliday.publicHolidayId, publicHolidayPriorYearId));
    }
    if (ruleId) await db.delete(documentExpiryRule).where(eq(documentExpiryRule.documentExpiryRuleId, ruleId));
    const shiftRows = await db.select({ id: shift.shiftId }).from(shift).where(eq(shift.organisationId, orgA));
    const shiftIds = shiftRows.map((r) => r.id);
    if (shiftIds.length) {
      await db.delete(shiftAssignment).where(inArray(shiftAssignment.shiftId, shiftIds));
      await db.delete(shift).where(inArray(shift.shiftId, shiftIds));
    }
    await db.delete(staffAvailability).where(inArray(staffAvailability.userId, [userA, userB]));
    await db.delete(complianceDocument).where(eq(complianceDocument.documentType, docType));
    // Query by org, not just the seeded `roleId` — the "createRole" test creates
    // an additional role of its own, which would otherwise orphan-block the
    // storeLocation delete below via roster_role's FK.
    const roleRows = await db.select({ id: rosterRole.rosterRoleId }).from(rosterRole).where(eq(rosterRole.organisationId, orgA));
    const roleIds = roleRows.map((r) => r.id);
    if (roleIds.length) {
      await db.delete(rosterRoleDocument).where(inArray(rosterRoleDocument.rosterRoleId, roleIds));
      await db.delete(rosterRole).where(inArray(rosterRole.rosterRoleId, roleIds));
    }
    if (locA) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locA));
    if (locB) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locB));
    if (orgA && orgB) {
      await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
      // requestConsent/respondToConsent write notification rows — must clear
      // before the organisation FK delete, same reasoning as audit_log below.
      await db.delete(notification).where(inArray(notification.organisationId, [orgA, orgB]));
      // assignStaff/respondToAssignment/removeAssignment/publishRoster all
      // write audit_log rows — must clear before the organisation FK delete.
      await db.delete(auditLog).where(inArray(auditLog.organisationId, [orgA, orgB]));
      await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    }
    if (userA && userB && userC) await db.delete(user).where(inArray(user.userId, [userA, userB, userC]));
  });

  it("createRole + listRoles + setRoleDocuments + listRoleDocuments round-trip", async () => {
    const created = await createRole(orgA, { roleName: `${tag}-chef`, storeLocationId: locA });
    const roles = await listRoles(orgA);
    expect(roles.some((r) => r.rosterRoleId === created.rosterRoleId)).toBe(true);

    const types = await setRoleDocuments(orgA, created.rosterRoleId, [`${tag}-fss`, `${tag}-fss`]);
    expect(types).toEqual([`${tag}-fss`]); // deduped
    expect(await listRoleDocuments(orgA, created.rosterRoleId)).toEqual([`${tag}-fss`]);
  });

  it("createShift + listShifts round-trip, scoped to the caller's org", async () => {
    const start = new Date();
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const created = await createShift(
      orgA,
      { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
      userA,
    );
    const shifts = await listShifts(orgA);
    expect(shifts.some((s) => s.shiftId === created.shiftId)).toBe(true);

    const shiftsOrgB = await listShifts(orgB);
    expect(shiftsOrgB.some((s) => s.shiftId === created.shiftId)).toBe(false);
  });

  it("assignStaff blocks with the verbatim refusal message when the required document is missing", async () => {
    const start = new Date();
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const s = await createShift(
      orgA,
      { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
      userA,
    );

    await expect(assignStaff(orgA, s.shiftId, userA, userA)).rejects.toMatchObject({
      name: "AssignmentBlockedError",
      statusCode: 409,
      message: `Cannot assign. Roster Staff A has not uploaded a ${docType}.`,
    });
  });

  it("assignStaff succeeds once the staff member holds a Verified, unexpired document", async () => {
    await db.insert(complianceDocument).values({
      organisationId: orgA,
      userId: userA,
      documentType: docType,
      verificationStatus: "Verified",
      expiryDate: addDays(TODAY, 365),
      storagePublicId: `${tag}-pub-a`,
      uploadedBy: userA,
    });

    const start = new Date();
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const s = await createShift(
      orgA,
      { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
      userA,
    );

    const assignment = await assignStaff(orgA, s.shiftId, userA, userA);
    expect(assignment.status).toBe("Pending");
  });

  it("assignStaff at orgA ignores a document verified only under orgB's compliance program", async () => {
    // userC belongs to both orgs. orgB independently verified userC's
    // document; orgA never has. The gate must not trust orgB's verification.
    await db.insert(complianceDocument).values({
      organisationId: orgB,
      userId: userC,
      documentType: docType,
      verificationStatus: "Verified",
      expiryDate: addDays(TODAY, 365),
      storagePublicId: `${tag}-pub-c-orgB`,
      uploadedBy: userC,
    });

    const start = new Date();
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const s = await createShift(
      orgA,
      { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
      userA,
    );

    await expect(assignStaff(orgA, s.shiftId, userC, userA)).rejects.toMatchObject({
      name: "AssignmentBlockedError",
      statusCode: 409,
      message: `Cannot assign. Roster Staff C (org B) has not uploaded a ${docType}.`,
    });
  });

  it("respondToAssignment enforces ownership — userB cannot respond to userA's assignment", async () => {
    await db.insert(complianceDocument).values({
      organisationId: orgA,
      userId: userA,
      documentType: docType,
      verificationStatus: "Verified",
      expiryDate: addDays(TODAY, 365),
      storagePublicId: `${tag}-pub-a2`,
      uploadedBy: userA,
    });

    const start = new Date();
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const s = await createShift(
      orgA,
      { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
      userA,
    );
    const assignment = await assignStaff(orgA, s.shiftId, userA, userA);

    await expect(respondToAssignment(orgA, assignment.assignmentId, userB, "Confirmed")).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 404,
    });

    const confirmed = await respondToAssignment(orgA, assignment.assignmentId, userA, "Confirmed");
    expect(confirmed.status).toBe("Confirmed");
  });

  it("removeAssignment deletes the row", async () => {
    await db.insert(complianceDocument).values({
      organisationId: orgA,
      userId: userA,
      documentType: docType,
      verificationStatus: "Verified",
      expiryDate: addDays(TODAY, 365),
      storagePublicId: `${tag}-pub-a3`,
      uploadedBy: userA,
    });
    const start = new Date();
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const s = await createShift(
      orgA,
      { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
      userA,
    );
    const assignment = await assignStaff(orgA, s.shiftId, userA, userA);

    await removeAssignment(orgA, assignment.assignmentId, userA);
    await expect(respondToAssignment(orgA, assignment.assignmentId, userA, "Confirmed")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("listShiftAssignments returns the staff assigned to a shift, name joined in, scoped to the caller's org", async () => {
    await db.insert(complianceDocument).values({
      organisationId: orgA,
      userId: userA,
      documentType: docType,
      verificationStatus: "Verified",
      expiryDate: addDays(TODAY, 365),
      storagePublicId: `${tag}-pub-listassign`,
      uploadedBy: userA,
    });
    const start = new Date();
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const s = await createShift(
      orgA,
      { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
      userA,
    );
    await assignStaff(orgA, s.shiftId, userA, userA);

    const assignments = await listShiftAssignments(orgA, s.shiftId);
    expect(assignments).toEqual([
      {
        assignmentId: expect.any(String),
        userId: userA,
        status: "Pending",
        staffName: "Roster Staff A",
        publicHolidayConsent: null,
      },
    ]);

    await expect(listShiftAssignments(orgB, s.shiftId)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("publishRoster re-checks at publish time and holds a shift whose document expired after assignment, publishing the rest", async () => {
    const [doc] = await db
      .insert(complianceDocument)
      .values({
        organisationId: orgA,
        userId: userB,
        documentType: docType,
        verificationStatus: "Verified",
        expiryDate: addDays(TODAY, 365), // valid at assignment time
        storagePublicId: `${tag}-pub-b`,
        uploadedBy: userB,
      })
      .returning({ id: complianceDocument.complianceDocumentId });

    const start = new Date();
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const shiftToHold = await createShift(
      orgA,
      { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
      userA,
    );
    await assignStaff(orgA, shiftToHold.shiftId, userB, userA); // succeeds — document is valid right now

    // Simulate the certificate expiring between drafting and publishing —
    // exactly what "re-check at publish, not only at assign" exists to catch.
    await db
      .update(complianceDocument)
      .set({ expiryDate: addDays(TODAY, -1) })
      .where(eq(complianceDocument.complianceDocumentId, doc.id));

    // A second, unaffected shift with userA (still valid) to prove the batch
    // is not blocked wholesale by the one bad assignment.
    await db.insert(complianceDocument).values({
      organisationId: orgA,
      userId: userA,
      documentType: docType,
      verificationStatus: "Verified",
      expiryDate: addDays(TODAY, 365),
      storagePublicId: `${tag}-pub-a4`,
      uploadedBy: userA,
    });
    const shiftToPublish = await createShift(
      orgA,
      { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
      userA,
    );
    await assignStaff(orgA, shiftToPublish.shiftId, userA, userA);

    const from = addDays(TODAY, -1);
    const to = addDays(TODAY, 1);
    const result = await publishRoster(orgA, locA, from, to, userA);

    expect(result.publishedShiftIds).toContain(shiftToPublish.shiftId);
    expect(result.publishedShiftIds).not.toContain(shiftToHold.shiftId);
    expect(result.heldShifts.find((h) => h.shiftId === shiftToHold.shiftId)?.reason).toBe(
      `Cannot assign. Roster Staff B's ${docType} expired on ${formatDateForMessage(addDays(TODAY, -1))}.`,
    );

    // The "ship empty" case: zero award_rule rows exist, so warnings must be
    // empty, but the coverage disclosure must still be fully populated —
    // never silently absent just because there was nothing to flag.
    expect(result.awardWarnings).toEqual([]);
    expect(result.awardCoverage.checked.length).toBeGreaterThan(0);
    expect(result.awardCoverage.notChecked.length).toBeGreaterThan(0);
    expect(result.awardCoverage.jurisdiction).toBe("VIC");
  });

  it("publishRoster's audit_log ack always carries the coverage object, even with zero warnings", async () => {
    await db.insert(complianceDocument).values({
      organisationId: orgA,
      userId: userA,
      documentType: docType,
      verificationStatus: "Verified",
      expiryDate: addDays(TODAY, 365),
      storagePublicId: `${tag}-pub-audit1`,
      uploadedBy: userA,
    });
    const start = new Date();
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const s = await createShift(
      orgA,
      { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
      userA,
    );
    await assignStaff(orgA, s.shiftId, userA, userA);

    await publishRoster(orgA, locA, addDays(TODAY, -1), addDays(TODAY, 1), userA);

    const [row] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "roster_publish"), eq(auditLog.entityId, locA)))
      .orderBy(desc(auditLog.createdDttm))
      .limit(1);
    expect(row).toBeTruthy();
    const metadata = row.metadata as { awardWarnings: unknown[]; awardCoverage: { checked: string[] } };
    expect(metadata.awardWarnings).toEqual([]);
    expect(metadata.awardCoverage.checked.length).toBeGreaterThan(0);
  });

  it("publishRoster surfaces an advisory warning when an active award_rule is exceeded, without blocking the shift", async () => {
    const [rule] = await db
      .insert(awardRule)
      .values({
        jurisdiction: "VIC",
        awardCode: `${tag}-MA000009`,
        ruleType: "max_ordinary_hours",
        thresholdValue: "4",
        effectiveFrom: "2020-01-01",
        ruleVersion: `${tag}-v1`,
        sourceCitation: "MA000009 cl 32",
      })
      .returning({ id: awardRule.awardRuleId });

    try {
      await db.insert(complianceDocument).values({
        organisationId: orgA,
        userId: userA,
        documentType: docType,
        verificationStatus: "Verified",
        expiryDate: addDays(TODAY, 365),
        storagePublicId: `${tag}-pub-award1`,
        uploadedBy: userA,
      });
      const start = new Date();
      const end = new Date(start.getTime() + 8 * 60 * 60 * 1000); // 8h shift, exceeds the 4h rule
      const s = await createShift(
        orgA,
        { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
        userA,
      );
      await assignStaff(orgA, s.shiftId, userA, userA);

      const result = await publishRoster(orgA, locA, addDays(TODAY, -1), addDays(TODAY, 1), userA);

      expect(result.publishedShiftIds).toContain(s.shiftId); // advisory only — never blocks
      const warning = result.awardWarnings.find((w) => w.shiftId === s.shiftId);
      expect(warning).toMatchObject({
        severity: "advisory",
        ruleVersion: `${tag}-v1`,
        sourceCitation: "MA000009 cl 32",
      });
      expect(warning!.message).toContain("exceeding the Award's 4-hour ordinary-hours limit");
      expect(result.awardCoverage.ruleVersionsInScope).toContain(`${tag}-v1`);
    } finally {
      await db.delete(awardRule).where(eq(awardRule.awardRuleId, rule.id));
    }
  });

  it("publishRoster fails loud when the venue's jurisdiction+year holiday calendar isn't loaded", async () => {
    // VIC/current-year is loaded (beforeAll); 2031 is not and never will be —
    // fails before any shift is even queried, so no fixture shift is needed.
    await expect(publishRoster(orgA, locA, "2031-01-01", "2031-01-02", userA)).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 409,
      message: "Public holidays for VIC 2031 are not loaded.",
    });
  });

  it("publishRoster sets isPublicHoliday on a shift that falls on a loaded holiday date", async () => {
    const holidayDate = `${new Date().getFullYear()}-01-01`; // seeded in beforeAll
    // Explicit +11:00 (AEDT, always in effect on Jan 1) rather than a bare
    // local-format string — locA's ianaTimezone defaults to
    // Australia/Melbourne, and a bare string parses in the TEST RUNNER's
    // local time, which is UTC in CI. That would silently stop this test
    // from ever crossing a UTC day boundary in CI, defeating the point: 9am
    // Melbourne on Jan 1 is 10pm UTC on Dec 31, the exact case
    // toVenueLocalDate exists to get right.
    const start = new Date(`${holidayDate}T09:00:00+11:00`);
    const end = new Date(`${holidayDate}T17:00:00+11:00`);
    const s = await createShift(
      orgA,
      { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
      userA,
    );

    // Wider than the single holiday day, matching the other publishRoster
    // tests' addDays(-1)/addDays(1) window — startDatetime is parsed as
    // local time while a bare date-only from/to boundary parses as UTC
    // midnight, so a tight same-day window can miss the shift entirely.
    const result = await publishRoster(orgA, locA, addDays(holidayDate, -1), addDays(holidayDate, 1), userA);
    expect(result.publishedShiftIds).toContain(s.shiftId);

    const publishedShift = (await listShifts(orgA, { storeLocationId: locA })).find((row) => row.shiftId === s.shiftId);
    expect(publishedShift?.isPublicHoliday).toBe(true);
  });

  // ── s.114 consent workflow (Slice 7) ──────────────────────────────
  // Same holidayDate/VIC fixture as the isPublicHoliday test above — every
  // shift here uses an explicit +11:00 (AEDT) offset for the same reason:
  // a bare local-format string parses in the TEST RUNNER's zone (UTC in
  // CI), which would stop these shifts from actually landing on the
  // holiday date once read back through toVenueLocalDate.
  describe("public holiday consent", () => {
    const holidayDate = `${new Date().getFullYear()}-01-01`; // seeded in beforeAll

    async function createHolidayAssignment(userId: number) {
      const start = new Date(`${holidayDate}T09:00:00+11:00`);
      const end = new Date(`${holidayDate}T17:00:00+11:00`);
      const s = await createShift(
        orgA,
        { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
        userA,
      );
      const assignment = await assignStaff(orgA, s.shiftId, userId, userA);
      return { shift: s, assignment };
    }

    it("requestConsent rejects a shift that isn't on a loaded public holiday date", async () => {
      const start = new Date(`${TODAY}T09:00:00+11:00`);
      const end = new Date(`${TODAY}T17:00:00+11:00`);
      const s = await createShift(
        orgA,
        { storeLocationId: locA, rosterRoleId: roleId, startDatetime: start.toISOString(), endDatetime: end.toISOString() },
        userA,
      );
      const assignment = await assignStaff(orgA, s.shiftId, userA, userA);
      await expect(requestConsent(orgA, assignment.assignmentId, userB)).rejects.toMatchObject({
        name: "RosterError",
        statusCode: 400,
        message: "This shift is not on a loaded public holiday date.",
      });
    });

    it("requestConsent sets Requested and notifies the assignee directly", async () => {
      const { assignment } = await createHolidayAssignment(userA);
      const updated = await requestConsent(orgA, assignment.assignmentId, userB);
      expect(updated.publicHolidayConsent).toBe("Requested");
      expect(updated.consentRequestedAt).not.toBeNull();

      const notifications = await db
        .select({ id: notification.notificationId, recipientUserId: notification.recipientUserId })
        .from(notification)
        .where(
          and(
            eq(notification.relatedEntityId, assignment.assignmentId),
            eq(notification.type, "HOLIDAY_CONSENT_REQUESTED"),
          ),
        );
      expect(notifications).toHaveLength(1);
      expect(notifications[0].recipientUserId).toBe(userA);
    });

    it("requestConsent refuses to re-request an already-accepted consent", async () => {
      const { assignment } = await createHolidayAssignment(userA);
      await requestConsent(orgA, assignment.assignmentId, userB);
      await respondToConsent(orgA, assignment.assignmentId, userA, "Accepted");
      await expect(requestConsent(orgA, assignment.assignmentId, userB)).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it("respondToConsent 404s for someone who isn't the assignee", async () => {
      const { assignment } = await createHolidayAssignment(userA);
      await requestConsent(orgA, assignment.assignmentId, userB);
      await expect(respondToConsent(orgA, assignment.assignmentId, userB, "Accepted")).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("respondToConsent 409s when there is no pending request", async () => {
      const { assignment } = await createHolidayAssignment(userA);
      await expect(respondToConsent(orgA, assignment.assignmentId, userA, "Accepted")).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it("respondToConsent(Accepted) sets Accepted and audit-logs consent_accept", async () => {
      const { assignment } = await createHolidayAssignment(userA);
      await requestConsent(orgA, assignment.assignmentId, userB);
      const updated = await respondToConsent(orgA, assignment.assignmentId, userA, "Accepted");
      expect(updated.publicHolidayConsent).toBe("Accepted");
      expect(updated.consentRespondedAt).not.toBeNull();

      const [logRow] = await db
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, assignment.assignmentId), eq(auditLog.entityType, "shift_assignment")))
        .orderBy(desc(auditLog.createdDttm))
        .limit(1);
      expect((logRow.metadata as { action: string }).action).toBe("consent_accept");
    });

    it("respondToConsent(Declined) sets Declined and audit-logs consent_decline — never silently overridden", async () => {
      const { assignment } = await createHolidayAssignment(userA);
      await requestConsent(orgA, assignment.assignmentId, userB);
      const updated = await respondToConsent(orgA, assignment.assignmentId, userA, "Declined");
      expect(updated.publicHolidayConsent).toBe("Declined");

      const [logRow] = await db
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, assignment.assignmentId), eq(auditLog.entityType, "shift_assignment")))
        .orderBy(desc(auditLog.createdDttm))
        .limit(1);
      expect((logRow.metadata as { action: string }).action).toBe("consent_decline");

      // A second respond attempt (e.g. a manager trying to flip it back)
      // finds no pending request and is refused — the decline stands.
      await expect(respondToConsent(orgA, assignment.assignmentId, userA, "Accepted")).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it("publishRoster holds a public-holiday shift whose assignee was never asked to consent", async () => {
      const { shift: s } = await createHolidayAssignment(userA);
      const result = await publishRoster(orgA, locA, addDays(holidayDate, -1), addDays(holidayDate, 1), userA);
      expect(result.publishedShiftIds).not.toContain(s.shiftId);
      const held = result.heldShifts.find((h) => h.shiftId === s.shiftId);
      expect(held?.reason).toContain("hasn't been asked to consent");
    });

    it("publishRoster holds a public-holiday shift whose assignee declined", async () => {
      const { shift: s, assignment } = await createHolidayAssignment(userA);
      await requestConsent(orgA, assignment.assignmentId, userB);
      await respondToConsent(orgA, assignment.assignmentId, userA, "Declined");

      const result = await publishRoster(orgA, locA, addDays(holidayDate, -1), addDays(holidayDate, 1), userA);
      expect(result.publishedShiftIds).not.toContain(s.shiftId);
      const held = result.heldShifts.find((h) => h.shiftId === s.shiftId);
      expect(held?.reason).toContain("declined to work this public holiday shift");
    });

    it("publishRoster publishes a public-holiday shift whose assignee accepted", async () => {
      const { shift: s, assignment } = await createHolidayAssignment(userA);
      await requestConsent(orgA, assignment.assignmentId, userB);
      await respondToConsent(orgA, assignment.assignmentId, userA, "Accepted");

      const result = await publishRoster(orgA, locA, addDays(holidayDate, -1), addDays(holidayDate, 1), userA);
      expect(result.publishedShiftIds).toContain(s.shiftId);
      expect(result.heldShifts.find((h) => h.shiftId === s.shiftId)).toBeUndefined();
    });
  });

  it("createAvailability is scoped to the caller's org and location", async () => {
    const created = await createAvailability(orgA, userA, {
      storeLocationId: locA,
      dayOfWeek: 1,
      availableFrom: "09:00",
      availableUntil: "17:00",
      effectiveFrom: "2026-01-01",
    });
    expect(created.userId).toBe(userA);
  });

  it("createRole rejects a cross-org storeLocationId", async () => {
    await expect(createRole(orgA, { roleName: `${tag}-bad`, storeLocationId: locB })).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 404,
    });
  });
});

/** Matches formatAuDate's "D Month YYYY" shape without importing the shared package into the test. */
function formatDateForMessage(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${d} ${months[m - 1]} ${y}`;
}
