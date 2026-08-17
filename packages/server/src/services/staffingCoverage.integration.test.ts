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
  complianceDocument,
} from "../db/schema.js";
import { getStaffingCoverage } from "./staffingCoverageService.js";

/**
 * Real-database behaviour of staffingCoverageService (Phase 3, Slice 2).
 * Gated on TENANT_IT=1, same convention as roster.integration.test.ts.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `sc_${Date.now().toString(36)}`;
const docType = `${tag}-rsa`;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

describe.skipIf(!RUN)("staffingCoverageService (real DB)", () => {
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let userC: number;
  let locA: string;
  let locB: string;
  let roleId: string;
  const shiftIds: string[] = [];

  beforeAll(async () => {
    [{ id: userA }] = await db.insert(user).values({ userName: "Coverage Staff A", userEmail: `${tag}-a@it.test` }).returning({ id: user.userId });
    [{ id: userB }] = await db.insert(user).values({ userName: "Coverage Staff B", userEmail: `${tag}-b@it.test` }).returning({ id: user.userId });
    [{ id: userC }] = await db.insert(user).values({ userName: "Coverage Staff C", userEmail: `${tag}-c@it.test` }).returning({ id: user.userId });

    [{ id: orgA }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-A`, joinKey: `${tag}-ka`.slice(0, 25), createdBy: userA })
      .returning({ id: organisation.organisationId });
    [{ id: orgB }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-B`, joinKey: `${tag}-kb`.slice(0, 25), createdBy: userA })
      .returning({ id: organisation.organisationId });

    await db.insert(userOrganisation).values([
      { userId: userA, organisationId: orgA, role: "admin" },
      { userId: userB, organisationId: orgA, role: "admin" },
      { userId: userC, organisationId: orgA, role: "admin" },
    ]);

    [{ id: locA }] = await db
      .insert(storeLocation)
      .values({ organisationId: orgA, locationName: `${tag}-locA`, storeKey: `${tag}-ska`.slice(0, 25), createdBy: userA })
      .returning({ id: storeLocation.storeLocationId });
    [{ id: locB }] = await db
      .insert(storeLocation)
      .values({ organisationId: orgB, locationName: `${tag}-locB`, storeKey: `${tag}-skb`.slice(0, 25), createdBy: userA })
      .returning({ id: storeLocation.storeLocationId });

    [{ id: roleId }] = await db
      .insert(rosterRole)
      .values({ organisationId: orgA, storeLocationId: locA, roleName: `${tag}-bartender` })
      .returning({ id: rosterRole.rosterRoleId });
    await db.insert(rosterRoleDocument).values({ rosterRoleId: roleId, documentType: docType });

    // userA holds a Verified, unexpired document -> "ok".
    await db.insert(complianceDocument).values({
      organisationId: orgA,
      userId: userA,
      documentType: docType,
      verificationStatus: "Verified",
      expiryDate: addDays(TODAY, 365),
      storagePublicId: `${tag}-pub-a`,
      uploadedBy: userA,
    });
    // userB and userC hold nothing.

    // Day 1: userA assigned, compliant -> "ok".
    const [s1] = await db
      .insert(shift)
      .values({
        organisationId: orgA,
        storeLocationId: locA,
        rosterRoleId: roleId,
        startDatetime: new Date(`${TODAY}T09:00:00Z`),
        endDatetime: new Date(`${TODAY}T13:00:00Z`),
        createdBy: userA,
      })
      .returning({ id: shift.shiftId });
    shiftIds.push(s1.id);
    await db.insert(shiftAssignment).values({ shiftId: s1.id, userId: userA });

    // Day 2: userB assigned, missing the required document -> "missing".
    const day2 = addDays(TODAY, 1);
    const [s2] = await db
      .insert(shift)
      .values({
        organisationId: orgA,
        storeLocationId: locA,
        rosterRoleId: roleId,
        startDatetime: new Date(`${day2}T09:00:00Z`),
        endDatetime: new Date(`${day2}T15:00:00Z`),
        createdBy: userA,
      })
      .returning({ id: shift.shiftId });
    shiftIds.push(s2.id);
    await db.insert(shiftAssignment).values({ shiftId: s2.id, userId: userB });

    // Day 3: nobody assigned -> "unstaffed".
    const day3 = addDays(TODAY, 2);
    const [s3] = await db
      .insert(shift)
      .values({
        organisationId: orgA,
        storeLocationId: locA,
        rosterRoleId: roleId,
        startDatetime: new Date(`${day3}T09:00:00Z`),
        endDatetime: new Date(`${day3}T17:00:00Z`),
        createdBy: userA,
      })
      .returning({ id: shift.shiftId });
    shiftIds.push(s3.id);

    // Day 4: TWO people assigned to the SAME shift (both missing the
    // document) — hours must be counted once, not once per assignee.
    const day4 = addDays(TODAY, 3);
    const [s4] = await db
      .insert(shift)
      .values({
        organisationId: orgA,
        storeLocationId: locA,
        rosterRoleId: roleId,
        startDatetime: new Date(`${day4}T09:00:00Z`),
        endDatetime: new Date(`${day4}T11:00:00Z`), // 2h
        createdBy: userA,
      })
      .returning({ id: shift.shiftId });
    shiftIds.push(s4.id);
    await db.insert(shiftAssignment).values([
      { shiftId: s4.id, userId: userB },
      { shiftId: s4.id, userId: userC },
    ]);
  });

  afterAll(async () => {
    if (shiftIds.length) {
      await db.delete(shiftAssignment).where(inArray(shiftAssignment.shiftId, shiftIds));
      await db.delete(shift).where(inArray(shift.shiftId, shiftIds));
    }
    await db.delete(complianceDocument).where(eq(complianceDocument.documentType, docType));
    if (roleId) {
      await db.delete(rosterRoleDocument).where(eq(rosterRoleDocument.rosterRoleId, roleId));
      await db.delete(rosterRole).where(eq(rosterRole.rosterRoleId, roleId));
    }
    if (locA) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locA));
    if (locB) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locB));
    if (orgA && orgB) {
      await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
      await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    }
    if (userA && userB && userC) await db.delete(user).where(inArray(user.userId, [userA, userB, userC]));
  });

  it("computes the worst status per (day, role) cell, matching a manual canAssign call per assignment", async () => {
    // to = day 4, not day 3 — day 3's shift starts at 09:00 UTC, which is
    // AFTER a bare "to" date string's UTC-midnight parse, same boundary
    // reasoning roster.integration.test.ts's addDays(-1)/addDays(1)
    // widening already documents elsewhere in this codebase.
    const result = await getStaffingCoverage(orgA, locA, TODAY, addDays(TODAY, 4));

    expect(result.roles).toEqual([{ roleId, roleName: `${tag}-bartender` }]);

    const byDate = new Map(result.cells.map((c) => [c.date, c]));
    expect(byDate.get(TODAY)?.status).toBe("ok");
    expect(byDate.get(TODAY)?.rosteredHours).toBe(4);

    expect(byDate.get(addDays(TODAY, 1))?.status).toBe("missing");
    expect(byDate.get(addDays(TODAY, 1))?.detail).toContain("Coverage Staff B");
    expect(byDate.get(addDays(TODAY, 1))?.rosteredHours).toBe(6);

    expect(byDate.get(addDays(TODAY, 2))?.status).toBe("unstaffed");
    expect(byDate.get(addDays(TODAY, 2))?.rosteredHours).toBe(8);

    // Two assignees on one 2h shift -> counted once, not 4h.
    expect(byDate.get(addDays(TODAY, 3))?.status).toBe("missing");
    expect(byDate.get(addDays(TODAY, 3))?.rosteredHours).toBe(2);
  });

  it("summary counts reconcile against the same cells the grid renders", async () => {
    const result = await getStaffingCoverage(orgA, locA, TODAY, addDays(TODAY, 4));
    expect(result.summary).toEqual({ covered: 1, atRisk: 2, unstaffed: 1 });
    expect(result.summary.covered + result.summary.atRisk + result.summary.unstaffed).toBe(result.cells.length);
  });

  it("rejects invalid from/to with 400", async () => {
    await expect(getStaffingCoverage(orgA, locA, "not-a-date", TODAY)).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 400,
    });
  });

  it("404s a location in another org rather than confirming it exists", async () => {
    await expect(getStaffingCoverage(orgA, locB, TODAY, addDays(TODAY, 4))).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 404,
    });
  });
});
