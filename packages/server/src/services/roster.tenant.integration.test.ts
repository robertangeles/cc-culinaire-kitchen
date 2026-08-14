import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

// Load .env before the first query — see tenantIsolation.integration.test.ts for why
// this has to run after the import statements but before any db call.
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
  shift,
  shiftAssignment,
  staffAvailability,
} from "../db/schema.js";

/**
 * Real-database tenant-isolation canary for Roster Core (Phase 2, Slice 2).
 *
 * No service layer exists yet at this slice (that's Slice 3), so this proves
 * the schema itself — columns, FKs, CHECK constraints — supports correct
 * tenant scoping ahead of the service that will enforce it, mirroring the
 * compliance vault's canary (compliance.tenant.integration.test.ts) but at
 * the raw-table level for roster_role, shift, shift_assignment, and
 * staff_availability.
 *
 * Gated on TENANT_IT=1. Self-cleaning: every row this suite creates is
 * deleted, children before parents, including rows left behind by a
 * CHECK-violation insert that unexpectedly succeeds.
 */
const RUN = process.env.TENANT_IT === "1";

describe.skipIf(!RUN)("roster core — tenant isolation (real DB)", () => {
  const tag = `rvit_${Date.now().toString(36)}`;
  let userA: number;
  let userB: number;
  let orgA: number;
  let orgB: number;
  let locA: string;
  let locB: string;
  let roleA: string;
  let roleB: string;
  let shiftA: string;
  let shiftB: string;
  let assignA: string;
  let assignB: string;
  let availA: string;
  let availB: string;

  beforeAll(async () => {
    [{ id: userA }] = await db
      .insert(user)
      .values({ userName: "RVIT A", userEmail: `${tag}-a@it.test` })
      .returning({ id: user.userId });
    [{ id: userB }] = await db
      .insert(user)
      .values({ userName: "RVIT B", userEmail: `${tag}-b@it.test` })
      .returning({ id: user.userId });

    [{ id: orgA }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-A`, joinKey: `${tag}-ka`.slice(0, 25), createdBy: userA })
      .returning({ id: organisation.organisationId });
    [{ id: orgB }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-B`, joinKey: `${tag}-kb`.slice(0, 25), createdBy: userB })
      .returning({ id: organisation.organisationId });

    await db.insert(userOrganisation).values([
      { userId: userA, organisationId: orgA, role: "admin" },
      { userId: userB, organisationId: orgB, role: "admin" },
    ]);

    [{ id: locA }] = await db
      .insert(storeLocation)
      .values({
        organisationId: orgA,
        locationName: `${tag}-locA`,
        storeKey: `${tag}-ska`.slice(0, 25),
        createdBy: userA,
      })
      .returning({ id: storeLocation.storeLocationId });
    [{ id: locB }] = await db
      .insert(storeLocation)
      .values({
        organisationId: orgB,
        locationName: `${tag}-locB`,
        storeKey: `${tag}-skb`.slice(0, 25),
        createdBy: userB,
      })
      .returning({ id: storeLocation.storeLocationId });

    [{ id: roleA }] = await db
      .insert(rosterRole)
      .values({ organisationId: orgA, storeLocationId: locA, roleName: `${tag}-chef` })
      .returning({ id: rosterRole.rosterRoleId });
    [{ id: roleB }] = await db
      .insert(rosterRole)
      .values({ organisationId: orgB, storeLocationId: locB, roleName: `${tag}-chef` })
      .returning({ id: rosterRole.rosterRoleId });

    const start = new Date();
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);

    [{ id: shiftA }] = await db
      .insert(shift)
      .values({
        organisationId: orgA,
        storeLocationId: locA,
        rosterRoleId: roleA,
        startDatetime: start,
        endDatetime: end,
        createdBy: userA,
      })
      .returning({ id: shift.shiftId });
    [{ id: shiftB }] = await db
      .insert(shift)
      .values({
        organisationId: orgB,
        storeLocationId: locB,
        rosterRoleId: roleB,
        startDatetime: start,
        endDatetime: end,
        createdBy: userB,
      })
      .returning({ id: shift.shiftId });

    [{ id: assignA }] = await db
      .insert(shiftAssignment)
      .values({ shiftId: shiftA, userId: userA })
      .returning({ id: shiftAssignment.assignmentId });
    [{ id: assignB }] = await db
      .insert(shiftAssignment)
      .values({ shiftId: shiftB, userId: userB })
      .returning({ id: shiftAssignment.assignmentId });

    [{ id: availA }] = await db
      .insert(staffAvailability)
      .values({
        userId: userA,
        organisationId: orgA,
        dayOfWeek: 1,
        availableFrom: "09:00",
        availableUntil: "17:00",
        effectiveFrom: "2026-01-01",
      })
      .returning({ id: staffAvailability.staffAvailabilityId });
    [{ id: availB }] = await db
      .insert(staffAvailability)
      .values({
        userId: userB,
        organisationId: orgB,
        dayOfWeek: 1,
        availableFrom: "09:00",
        availableUntil: "17:00",
        effectiveFrom: "2026-01-01",
      })
      .returning({ id: staffAvailability.staffAvailabilityId });
  });

  afterAll(async () => {
    const assignIds = [assignA, assignB].filter(Boolean);
    if (assignIds.length) {
      await db.delete(shiftAssignment).where(inArray(shiftAssignment.assignmentId, assignIds));
    }
    const availIds = [availA, availB].filter(Boolean);
    if (availIds.length) {
      await db.delete(staffAvailability).where(inArray(staffAvailability.staffAvailabilityId, availIds));
    }
    const shiftIds = [shiftA, shiftB].filter(Boolean);
    if (shiftIds.length) {
      await db.delete(shift).where(inArray(shift.shiftId, shiftIds));
    }
    const roleIds = [roleA, roleB].filter(Boolean);
    if (roleIds.length) {
      await db.delete(rosterRole).where(inArray(rosterRole.rosterRoleId, roleIds));
    }
    if (locA) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locA));
    if (locB) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locB));
    if (orgA && orgB) {
      await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
      await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    }
    if (userA && userB) await db.delete(user).where(inArray(user.userId, [userA, userB]));
  });

  it("roster_role scoped by organisation_id excludes the other org's role", async () => {
    const rowsA = await db.select().from(rosterRole).where(eq(rosterRole.organisationId, orgA));
    expect(rowsA.some((r) => r.rosterRoleId === roleA)).toBe(true);
    expect(rowsA.some((r) => r.rosterRoleId === roleB)).toBe(false);
  });

  it("shift scoped by organisation_id excludes the other org's shift", async () => {
    const rowsA = await db.select().from(shift).where(eq(shift.organisationId, orgA));
    expect(rowsA.some((r) => r.shiftId === shiftA)).toBe(true);
    expect(rowsA.some((r) => r.shiftId === shiftB)).toBe(false);
  });

  it("shift_assignment scoped via its parent shift's organisation_id excludes the other org's assignment", async () => {
    const rowsA = await db
      .select({ assignmentId: shiftAssignment.assignmentId })
      .from(shiftAssignment)
      .innerJoin(shift, eq(shiftAssignment.shiftId, shift.shiftId))
      .where(eq(shift.organisationId, orgA));
    expect(rowsA.some((r) => r.assignmentId === assignA)).toBe(true);
    expect(rowsA.some((r) => r.assignmentId === assignB)).toBe(false);
  });

  it("staff_availability scoped by organisation_id excludes the other org's availability", async () => {
    const rowsA = await db.select().from(staffAvailability).where(eq(staffAvailability.organisationId, orgA));
    expect(rowsA.some((r) => r.staffAvailabilityId === availA)).toBe(true);
    expect(rowsA.some((r) => r.staffAvailabilityId === availB)).toBe(false);
  });

  // ── CHECK constraints — database guarantees, proven directly ──────────

  it("chk_shift_time_order rejects a shift ending at or before it starts", async () => {
    const start = new Date();
    let insertedId: string | undefined;
    try {
      const [row] = await db
        .insert(shift)
        .values({
          organisationId: orgA,
          storeLocationId: locA,
          rosterRoleId: roleA,
          startDatetime: start,
          endDatetime: start,
          createdBy: userA,
        })
        .returning({ id: shift.shiftId });
      insertedId = row.id;
    } catch (err) {
      expect((err as { code?: string }).code).toBe("23514");
      return;
    } finally {
      if (insertedId) await db.delete(shift).where(eq(shift.shiftId, insertedId));
    }
    throw new Error("chk_shift_time_order: CHECK constraint did not fire — insert succeeded (REAL BUG)");
  });

  it("chk_staff_availability_time_order rejects availableUntil at or before availableFrom", async () => {
    let insertedId: string | undefined;
    try {
      const [row] = await db
        .insert(staffAvailability)
        .values({
          userId: userA,
          organisationId: orgA,
          dayOfWeek: 2,
          availableFrom: "17:00",
          availableUntil: "17:00",
          effectiveFrom: "2026-01-01",
        })
        .returning({ id: staffAvailability.staffAvailabilityId });
      insertedId = row.id;
    } catch (err) {
      expect((err as { code?: string }).code).toBe("23514");
      return;
    } finally {
      if (insertedId) {
        await db.delete(staffAvailability).where(eq(staffAvailability.staffAvailabilityId, insertedId));
      }
    }
    throw new Error(
      "chk_staff_availability_time_order: CHECK constraint did not fire — insert succeeded (REAL BUG)",
    );
  });

  it("chk_staff_availability_date_order rejects effectiveUntil before effectiveFrom", async () => {
    let insertedId: string | undefined;
    try {
      const [row] = await db
        .insert(staffAvailability)
        .values({
          userId: userA,
          organisationId: orgA,
          dayOfWeek: 3,
          availableFrom: "09:00",
          availableUntil: "17:00",
          effectiveFrom: "2026-06-01",
          effectiveUntil: "2026-01-01",
        })
        .returning({ id: staffAvailability.staffAvailabilityId });
      insertedId = row.id;
    } catch (err) {
      expect((err as { code?: string }).code).toBe("23514");
      return;
    } finally {
      if (insertedId) {
        await db.delete(staffAvailability).where(eq(staffAvailability.staffAvailabilityId, insertedId));
      }
    }
    throw new Error(
      "chk_staff_availability_date_order: CHECK constraint did not fire — insert succeeded (REAL BUG)",
    );
  });
});
