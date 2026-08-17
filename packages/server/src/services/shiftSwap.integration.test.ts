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
  shiftSwapRequest,
  complianceDocument,
  publicHoliday,
  auditLog,
} from "../db/schema.js";
import { offerSwap, listOpenSwaps, claimSwap, cancelSwap } from "./shiftSwapService.js";
import { refusalMessage } from "./rosterService.js";

/**
 * Real-database behaviour of shiftSwapService (Phase 3, Slice 3).
 * Gated on TENANT_IT=1, same convention as roster.integration.test.ts and
 * staffingCoverage.integration.test.ts.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `sw_${Date.now().toString(36)}`;
const docType = `${tag}-rsa`;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

describe.skipIf(!RUN)("shiftSwapService (real DB)", () => {
  let orgA: number;
  let orgB: number;
  let userA: number; // offerer
  let userB: number; // compliant claimer
  let userC: number; // non-compliant claimer
  let userD: number; // second compliant claimer, for the race
  let userOrgB: number; // orgB-only, for the tenant-isolation check
  let locA: string;
  let roleId: string;
  let publicHolidayId: string;
  const shiftIds: string[] = [];

  beforeAll(async () => {
    [{ id: userA }] = await db.insert(user).values({ userName: "Swap Offerer", userEmail: `${tag}-a@it.test` }).returning({ id: user.userId });
    [{ id: userB }] = await db.insert(user).values({ userName: "Swap Claimer B", userEmail: `${tag}-b@it.test` }).returning({ id: user.userId });
    [{ id: userC }] = await db.insert(user).values({ userName: "Swap Claimer C", userEmail: `${tag}-c@it.test` }).returning({ id: user.userId });
    [{ id: userD }] = await db.insert(user).values({ userName: "Swap Claimer D", userEmail: `${tag}-d@it.test` }).returning({ id: user.userId });
    [{ id: userOrgB }] = await db.insert(user).values({ userName: "Other Org", userEmail: `${tag}-e@it.test` }).returning({ id: user.userId });

    [{ id: orgA }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-A`, joinKey: `${tag}-ka`.slice(0, 25), createdBy: userA })
      .returning({ id: organisation.organisationId });
    [{ id: orgB }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-B`, joinKey: `${tag}-kb`.slice(0, 25), createdBy: userOrgB })
      .returning({ id: organisation.organisationId });

    await db.insert(userOrganisation).values([
      { userId: userA, organisationId: orgA, role: "admin" },
      { userId: userB, organisationId: orgA, role: "admin" },
      { userId: userC, organisationId: orgA, role: "admin" },
      { userId: userD, organisationId: orgA, role: "admin" },
      { userId: userOrgB, organisationId: orgB, role: "admin" },
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

    [{ id: roleId }] = await db
      .insert(rosterRole)
      .values({ organisationId: orgA, storeLocationId: locA, roleName: `${tag}-bartender` })
      .returning({ id: rosterRole.rosterRoleId });
    await db.insert(rosterRoleDocument).values({ rosterRoleId: roleId, documentType: docType });

    // userB and userD hold a Verified, never-expiring document -> compliant.
    // userC holds nothing -> "missing".
    await db.insert(complianceDocument).values([
      {
        organisationId: orgA,
        userId: userB,
        documentType: docType,
        verificationStatus: "Verified",
        storagePublicId: `${tag}-pub-b`,
        uploadedBy: userA,
      },
      {
        organisationId: orgA,
        userId: userD,
        documentType: docType,
        verificationStatus: "Verified",
        storagePublicId: `${tag}-pub-d`,
        uploadedBy: userA,
      },
    ]);

    // A public holiday loaded 10 days out — the consent-reset test's shift lands on it.
    const holidayDate = addDays(TODAY, 10);
    [{ id: publicHolidayId }] = await db
      .insert(publicHoliday)
      .values({
        jurisdiction: "VIC",
        holidayDate,
        holidayName: `${tag} Holiday`,
        loadedForYear: Number(holidayDate.slice(0, 4)),
      })
      .returning({ id: publicHoliday.publicHolidayId });

    async function seedConfirmedShift(dayOffset: number, opts: { isPublicHoliday?: boolean; status?: "Pending" | "Confirmed" } = {}) {
      const day = addDays(TODAY, dayOffset);
      const [row] = await db
        .insert(shift)
        .values({
          organisationId: orgA,
          storeLocationId: locA,
          rosterRoleId: roleId,
          startDatetime: new Date(`${day}T09:00:00+10:00`),
          endDatetime: new Date(`${day}T13:00:00+10:00`),
          isPublicHoliday: opts.isPublicHoliday ?? false,
          createdBy: userA,
        })
        .returning({ id: shift.shiftId });
      shiftIds.push(row.id);
      const [assignmentRow] = await db
        .insert(shiftAssignment)
        .values({ shiftId: row.id, userId: userA, status: opts.status ?? "Confirmed" })
        .returning({ id: shiftAssignment.assignmentId });
      return { shiftId: row.id, assignmentId: assignmentRow.id };
    }

    happyPath = await seedConfirmedShift(1);
    blockedClaim = await seedConfirmedShift(2);
    race = await seedConfirmedShift(3);
    holidayShift = await seedConfirmedShift(10, { isPublicHoliday: true });
    cancelTarget = await seedConfirmedShift(4);
    notConfirmed = await seedConfirmedShift(5, { status: "Pending" });
  });

  let happyPath: { shiftId: string; assignmentId: string };
  let blockedClaim: { shiftId: string; assignmentId: string };
  let race: { shiftId: string; assignmentId: string };
  let holidayShift: { shiftId: string; assignmentId: string };
  let cancelTarget: { shiftId: string; assignmentId: string };
  let notConfirmed: { shiftId: string; assignmentId: string };

  afterAll(async () => {
    if (shiftIds.length) {
      await db.delete(shiftSwapRequest).where(inArray(shiftSwapRequest.shiftId, shiftIds));
      await db.delete(shiftAssignment).where(inArray(shiftAssignment.shiftId, shiftIds));
      await db.delete(shift).where(inArray(shift.shiftId, shiftIds));
    }
    if (publicHolidayId) await db.delete(publicHoliday).where(eq(publicHoliday.publicHolidayId, publicHolidayId));
    await db.delete(complianceDocument).where(eq(complianceDocument.documentType, docType));
    if (roleId) {
      await db.delete(rosterRoleDocument).where(eq(rosterRoleDocument.rosterRoleId, roleId));
      await db.delete(rosterRole).where(eq(rosterRole.rosterRoleId, roleId));
    }
    if (locA) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locA));
    if (orgA && orgB) await db.delete(auditLog).where(inArray(auditLog.organisationId, [orgA, orgB]));
    if (orgA) await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, orgA));
    if (orgB) await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, orgB));
    if (orgA && orgB) await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    await db.delete(user).where(inArray(user.userId, [userA, userB, userC, userD, userOrgB]));
  });

  it("only a Confirmed assignment can be offered for swap", async () => {
    await expect(offerSwap(orgA, notConfirmed.assignmentId, userA)).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 409,
    });
  });

  it("offer -> claim happy path: appears in the browse list, rejects the offerer's own claim, then a compliant claimer takes it and the old assignment is gone", async () => {
    const created = await offerSwap(orgA, happyPath.assignmentId, userA);

    const open = await listOpenSwaps(orgA);
    expect(open.some((s) => s.swapRequestId === created.swapRequestId && s.fromUserName === "Swap Offerer")).toBe(true);

    await expect(claimSwap(orgA, created.swapRequestId, userA)).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 400,
    });

    // Cross-org: a swap that exists in orgA must read as not-found from orgB.
    await expect(claimSwap(orgB, created.swapRequestId, userOrgB)).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 404,
    });

    const claimed = await claimSwap(orgA, created.swapRequestId, userB);
    expect(claimed.userId).toBe(userB);
    expect(claimed.status).toBe("Confirmed");

    const oldAssignment = await db
      .select()
      .from(shiftAssignment)
      .where(eq(shiftAssignment.assignmentId, happyPath.assignmentId));
    expect(oldAssignment).toHaveLength(0);

    const stillOpen = await listOpenSwaps(orgA);
    expect(stillOpen.some((s) => s.swapRequestId === created.swapRequestId)).toBe(false);
  });

  it("claim is blocked by canAssign, with the exact same refusal message assignStaff would produce", async () => {
    const created = await offerSwap(orgA, blockedClaim.assignmentId, userA);

    await expect(claimSwap(orgA, created.swapRequestId, userC)).rejects.toMatchObject({
      name: "AssignmentBlockedError",
      statusCode: 409,
      message: refusalMessage("Swap Claimer C", docType, "missing", null),
    });

    // Blocked claim must not consume the swap — it's still Open afterwards.
    const stillOpen = await listOpenSwaps(orgA);
    expect(stillOpen.some((s) => s.swapRequestId === created.swapRequestId)).toBe(true);
  });

  it("two concurrent claims on the same swap: exactly one wins", async () => {
    const created = await offerSwap(orgA, race.assignmentId, userA);

    const results = await Promise.allSettled([
      claimSwap(orgA, created.swapRequestId, userB),
      claimSwap(orgA, created.swapRequestId, userD),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const assignments = await db.select().from(shiftAssignment).where(eq(shiftAssignment.shiftId, race.shiftId));
    expect(assignments).toHaveLength(1);
  });

  it("claiming a public-holiday shift resets consent to Requested for the new assignee, never inheriting the old assignee's state", async () => {
    const created = await offerSwap(orgA, holidayShift.assignmentId, userA);
    const claimed = await claimSwap(orgA, created.swapRequestId, userB);

    expect(claimed.publicHolidayConsent).toBe("Requested");
  });

  it("the offerer can cancel their own still-open swap, and it disappears from the browse list", async () => {
    const created = await offerSwap(orgA, cancelTarget.assignmentId, userA);
    const cancelled = await cancelSwap(orgA, created.swapRequestId, userA);
    expect(cancelled?.status).toBe("Cancelled");

    const open = await listOpenSwaps(orgA);
    expect(open.some((s) => s.swapRequestId === created.swapRequestId)).toBe(false);

    // The original assignment must still be intact — cancelling is a no-op on the roster.
    const stillAssigned = await db
      .select()
      .from(shiftAssignment)
      .where(eq(shiftAssignment.assignmentId, cancelTarget.assignmentId));
    expect(stillAssigned).toHaveLength(1);

    await expect(cancelSwap(orgA, created.swapRequestId, userA)).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 409,
    });
  });

  it("someone else cannot cancel another staff member's swap offer", async () => {
    const created = await offerSwap(orgA, cancelTarget.assignmentId, userA);
    await expect(cancelSwap(orgA, created.swapRequestId, userB)).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 404,
    });
    await cancelSwap(orgA, created.swapRequestId, userA);
  });
});
