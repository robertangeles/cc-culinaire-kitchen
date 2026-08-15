import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, inArray } from "drizzle-orm";
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
  auditLog,
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
} from "./rosterService.js";

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
  });

  afterAll(async () => {
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
