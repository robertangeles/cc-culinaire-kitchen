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
  rosterShiftTemplate,
  shift,
  auditLog,
} from "../db/schema.js";
import {
  createRole,
  updateRole,
  deleteRole,
  listTemplates,
  createTemplateRow,
  updateTemplateRow,
  deleteTemplateRow,
  generateWeekFromTemplate,
  undoGeneration,
} from "./rosterService.js";

/**
 * Real-database behaviour of Roster Scheduling Templates
 * (docs/designs/roster-scheduling-templates.md), end to end against
 * Postgres. Gated on TENANT_IT=1, same convention as roster.integration.test.ts.
 * Kept in its own file rather than extending roster.integration.test.ts
 * (already 1000+ lines) — self-contained fixtures, self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `rst_${Date.now().toString(36)}`;

const MON = 1;
const TUE = 2;
const WEEK_1 = "2027-03-01"; // Monday
const WEEK_2 = "2027-03-08"; // Monday, the following week

describe.skipIf(!RUN)("roster shift templates (real DB)", () => {
  let orgA: number;
  let orgB: number;
  let userA: number;
  let locA: string; // org A, Australia/Melbourne
  let locOther: string; // org A, a second venue
  let locB: string; // org B, for cross-org checks
  let roleA: string; // scoped to locA

  beforeAll(async () => {
    [{ id: userA }] = await db
      .insert(user)
      .values({ userName: "Templates Admin", userEmail: `${tag}-a@it.test` })
      .returning({ id: user.userId });

    [{ id: orgA }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-A`, joinKey: `${tag}-ka`.slice(0, 25), createdBy: userA })
      .returning({ id: organisation.organisationId });
    [{ id: orgB }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-B`, joinKey: `${tag}-kb`.slice(0, 25), createdBy: userA })
      .returning({ id: organisation.organisationId });

    await db.insert(userOrganisation).values([{ userId: userA, organisationId: orgA, role: "admin" }]);

    [{ id: locA }] = await db
      .insert(storeLocation)
      .values({
        organisationId: orgA,
        locationName: `${tag}-locA`,
        storeKey: `${tag}-ska`.slice(0, 25),
        createdBy: userA,
        ianaTimezone: "Australia/Melbourne",
      })
      .returning({ id: storeLocation.storeLocationId });
    [{ id: locOther }] = await db
      .insert(storeLocation)
      .values({
        organisationId: orgA,
        locationName: `${tag}-locOther`,
        storeKey: `${tag}-sko`.slice(0, 25),
        createdBy: userA,
        ianaTimezone: "Australia/Melbourne",
      })
      .returning({ id: storeLocation.storeLocationId });
    [{ id: locB }] = await db
      .insert(storeLocation)
      .values({
        organisationId: orgB,
        locationName: `${tag}-locB`,
        storeKey: `${tag}-skb`.slice(0, 25),
        createdBy: userA,
      })
      .returning({ id: storeLocation.storeLocationId });

    [{ id: roleA }] = await db
      .insert(rosterRole)
      .values({ organisationId: orgA, storeLocationId: locA, roleName: `${tag}-server` })
      .returning({ id: rosterRole.rosterRoleId });
  });

  afterAll(async () => {
    const templateRows = await db
      .select({ id: rosterShiftTemplate.rosterShiftTemplateId })
      .from(rosterShiftTemplate)
      .where(eq(rosterShiftTemplate.organisationId, orgA));
    if (templateRows.length) {
      await db.delete(rosterShiftTemplate).where(
        inArray(
          rosterShiftTemplate.rosterShiftTemplateId,
          templateRows.map((r) => r.id),
        ),
      );
    }
    const shiftRows = await db.select({ id: shift.shiftId }).from(shift).where(eq(shift.organisationId, orgA));
    if (shiftRows.length) {
      await db.delete(shift).where(
        inArray(
          shift.shiftId,
          shiftRows.map((r) => r.id),
        ),
      );
    }
    const roleRows = await db.select({ id: rosterRole.rosterRoleId }).from(rosterRole).where(eq(rosterRole.organisationId, orgA));
    if (roleRows.length) {
      await db.delete(rosterRole).where(
        inArray(
          rosterRole.rosterRoleId,
          roleRows.map((r) => r.id),
        ),
      );
    }
    if (locA) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locA));
    if (locOther) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locOther));
    if (locB) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locB));
    if (orgA && orgB) {
      await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
      await db.delete(auditLog).where(inArray(auditLog.organisationId, [orgA, orgB]));
      await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    }
    if (userA) await db.delete(user).where(eq(user.userId, userA));
  });

  describe("createTemplateRow / updateTemplateRow", () => {
    it("creates a valid same-day row and a valid overnight row", async () => {
      const dayRow = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });
      expect(dayRow.startTime).toBe("09:00");

      const overnightRow = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: TUE,
        startTime: "22:00",
        endTime: "02:00",
      });
      expect(overnightRow.endTime).toBe("02:00");

      await deleteTemplateRow(orgA, dayRow.rosterShiftTemplateId);
      await deleteTemplateRow(orgA, overnightRow.rosterShiftTemplateId);
    });

    it("rejects a role belonging to a different venue (400)", async () => {
      await expect(
        createTemplateRow(orgA, {
          storeLocationId: locOther,
          rosterRoleId: roleA, // roleA is scoped to locA, not locOther
          dayOfWeek: MON,
          startTime: "09:00",
          endTime: "17:00",
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects an overlapping row for the same role/day (400)", async () => {
      const first = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      await expect(
        createTemplateRow(orgA, {
          storeLocationId: locA,
          rosterRoleId: roleA,
          dayOfWeek: MON,
          startTime: "16:00", // overlaps first's 09:00-17:00
          endTime: "22:00",
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      // A non-overlapping row on the same day is fine.
      const second = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "17:00",
        endTime: "22:00",
      });
      expect(second.rosterShiftTemplateId).toBeTruthy();

      await deleteTemplateRow(orgA, first.rosterShiftTemplateId);
      await deleteTemplateRow(orgA, second.rosterShiftTemplateId);
    });

    it("rejects startTime === endTime (400)", async () => {
      await expect(
        createTemplateRow(orgA, {
          storeLocationId: locA,
          rosterRoleId: roleA,
          dayOfWeek: MON,
          startTime: "09:00",
          endTime: "09:00",
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("updateTemplateRow applies the same overlap/role-venue validation, excluding itself", async () => {
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      // Updating to its own exact same slot must not self-reject as an overlap.
      const updated = await updateTemplateRow(orgA, row.rosterShiftTemplateId, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "10:00",
        endTime: "18:00",
      });
      expect(updated.startTime).toBe("10:00");

      await expect(
        updateTemplateRow(orgA, row.rosterShiftTemplateId, {
          storeLocationId: locOther,
          rosterRoleId: roleA,
          dayOfWeek: MON,
          startTime: "10:00",
          endTime: "18:00",
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
    });
  });

  describe("listTemplates", () => {
    it("scopes by org and, when given, by venue", async () => {
      const rowA = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      const allOrgA = await listTemplates(orgA);
      expect(allOrgA.some((r) => r.rosterShiftTemplateId === rowA.rosterShiftTemplateId)).toBe(true);

      const scopedToOther = await listTemplates(orgA, locOther);
      expect(scopedToOther.some((r) => r.rosterShiftTemplateId === rowA.rosterShiftTemplateId)).toBe(false);

      const scopedToOrgB = await listTemplates(orgB);
      expect(scopedToOrgB.some((r) => r.rosterShiftTemplateId === rowA.rosterShiftTemplateId)).toBe(false);

      await deleteTemplateRow(orgA, rowA.rosterShiftTemplateId);
    });
  });

  describe("deleteTemplateRow", () => {
    it("404s on a cross-org id", async () => {
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });
      await expect(deleteTemplateRow(orgB, row.rosterShiftTemplateId)).rejects.toMatchObject({ statusCode: 404 });
      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
    });

    it("deletes cleanly even after it has generated shifts — the generated shift survives with sourceTemplateRowId set to null", async () => {
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });
      const result = await generateWeekFromTemplate(orgA, locA, WEEK_1, userA);
      expect(result.created).toBe(1);

      const [generated] = await db.select().from(shift).where(eq(shift.sourceTemplateRowId, row.rosterShiftTemplateId));
      expect(generated).toBeTruthy();

      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);

      const [afterDelete] = await db.select().from(shift).where(eq(shift.shiftId, generated.shiftId));
      expect(afterDelete).toBeTruthy();
      expect(afterDelete.sourceTemplateRowId).toBeNull();

      await db.delete(shift).where(eq(shift.shiftId, generated.shiftId));
    });
  });

  describe("generateWeekFromTemplate", () => {
    it("creates a shift per non-conflicting row and resolves venue-local time to the correct UTC instant", async () => {
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      const result = await generateWeekFromTemplate(orgA, locA, WEEK_1, userA);
      expect(result).toEqual({ created: 1, skipped: 0, failed: 0 });

      const [generated] = await db.select().from(shift).where(eq(shift.sourceTemplateRowId, row.rosterShiftTemplateId));
      // 2027-03-01 (Monday) is outside AEDT (ends first Sunday of April) — AEDT (+11) still applies.
      expect(generated.startDatetime.toISOString()).toBe("2027-02-28T22:00:00.000Z");
      expect(generated.endDatetime.toISOString()).toBe("2027-03-01T06:00:00.000Z");
      expect(generated.generatedForWeekStart).toBe(WEEK_1);

      await db.delete(shift).where(eq(shift.shiftId, generated.shiftId));
      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
    });

    it("skips a slot that already has a non-cancelled shift, and does not treat a Cancelled shift as a conflict", async () => {
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      const first = await generateWeekFromTemplate(orgA, locA, WEEK_1, userA);
      expect(first).toEqual({ created: 1, skipped: 0, failed: 0 });

      // Re-running immediately: the existing Draft shift blocks regeneration.
      const second = await generateWeekFromTemplate(orgA, locA, WEEK_1, userA);
      expect(second).toEqual({ created: 0, skipped: 1, failed: 0 });

      const [generated] = await db.select().from(shift).where(eq(shift.sourceTemplateRowId, row.rosterShiftTemplateId));
      await db.update(shift).set({ status: "Cancelled" }).where(eq(shift.shiftId, generated.shiftId));

      // Cancelling it frees the slot for regeneration.
      const third = await generateWeekFromTemplate(orgA, locA, WEEK_1, userA);
      expect(third).toEqual({ created: 1, skipped: 0, failed: 0 });

      const regenerated = await db.select().from(shift).where(eq(shift.sourceTemplateRowId, row.rosterShiftTemplateId));
      await db.delete(shift).where(
        inArray(
          shift.shiftId,
          regenerated.map((r) => r.shiftId),
        ),
      );
      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
    });

    it("reports a failed row (not an aborted batch) when its role's venue was changed via updateRole after the template was created", async () => {
      const movableRole = await createRole(orgA, { roleName: `${tag}-movable`, storeLocationId: locA });
      const stableRow = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: TUE,
        startTime: "09:00",
        endTime: "17:00",
      });
      const movableRow = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: movableRole.rosterRoleId,
        dayOfWeek: TUE,
        startTime: "09:00",
        endTime: "17:00",
      });

      // The role's venue changes after the template row was created — the
      // template row itself is untouched, but generation must now reject it.
      await updateRole(orgA, movableRole.rosterRoleId, {
        roleName: movableRole.roleName,
        storeLocationId: locOther,
        confirmed: true,
      });

      const result = await generateWeekFromTemplate(orgA, locA, WEEK_1, userA);
      expect(result).toEqual({ created: 1, skipped: 0, failed: 1 });

      const generated = await db.select().from(shift).where(eq(shift.sourceTemplateRowId, stableRow.rosterShiftTemplateId));
      await db.delete(shift).where(
        inArray(
          shift.shiftId,
          generated.map((r) => r.shiftId),
        ),
      );
      await deleteTemplateRow(orgA, stableRow.rosterShiftTemplateId);
      await deleteTemplateRow(orgA, movableRow.rosterShiftTemplateId);
      await deleteRole(orgA, movableRole.rosterRoleId);
    });

    it("an overnight row generated near the end of a week does not double-book the following week's generation", async () => {
      // Sunday (dayOfWeek 0) 22:00-02:00: lands on WEEK_1's Sunday, ending
      // Monday morning — which is WEEK_2's own first day.
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: 0,
        startTime: "22:00",
        endTime: "02:00",
      });

      const week1Result = await generateWeekFromTemplate(orgA, locA, WEEK_1, userA);
      expect(week1Result).toEqual({ created: 1, skipped: 0, failed: 0 });

      // WEEK_2 generation must not mistake WEEK_1's overnight shift (which
      // spills into WEEK_2's Monday morning) for a conflict on WEEK_2's own
      // Sunday-night row (a different calendar occurrence), nor duplicate it.
      const week2Result = await generateWeekFromTemplate(orgA, locA, WEEK_2, userA);
      expect(week2Result).toEqual({ created: 1, skipped: 0, failed: 0 });

      const generated = await db.select().from(shift).where(eq(shift.sourceTemplateRowId, row.rosterShiftTemplateId));
      expect(generated).toHaveLength(2);
      await db.delete(shift).where(
        inArray(
          shift.shiftId,
          generated.map((r) => r.shiftId),
        ),
      );
      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
    });

    it("resolves a target week straddling a DST transition using each day's correct offset", async () => {
      // Australia's 2026 DST starts Sunday 2026-10-04. This template's
      // Monday-anchored week (2026-09-28) sits entirely in AEST (+10).
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      const result = await generateWeekFromTemplate(orgA, locA, "2026-09-28", userA);
      expect(result).toEqual({ created: 1, skipped: 0, failed: 0 });

      const [generated] = await db.select().from(shift).where(eq(shift.sourceTemplateRowId, row.rosterShiftTemplateId));
      expect(generated.startDatetime.toISOString()).toBe("2026-09-27T23:00:00.000Z"); // 09:00 AEST (+10)

      await db.delete(shift).where(eq(shift.shiftId, generated.shiftId));
      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
    });

    it("concurrency: two simultaneous calls for the same venue/week create exactly one shift per row, the loser's 23505 folds into skipped", async () => {
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      const [resultA, resultB] = await Promise.all([
        generateWeekFromTemplate(orgA, locA, WEEK_1, userA),
        generateWeekFromTemplate(orgA, locA, WEEK_1, userA),
      ]);

      expect(resultA.created + resultB.created).toBe(1);
      expect(resultA.skipped + resultB.skipped).toBe(1);
      expect(resultA.failed + resultB.failed).toBe(0);

      const generated = await db.select().from(shift).where(eq(shift.sourceTemplateRowId, row.rosterShiftTemplateId));
      expect(generated).toHaveLength(1);

      await db.delete(shift).where(
        inArray(
          shift.shiftId,
          generated.map((r) => r.shiftId),
        ),
      );
      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
    });
  });

  describe("undoGeneration", () => {
    it("cancels exactly the shifts generated for this venue/week, leaves manual shifts and other weeks untouched, and is idempotent", async () => {
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: roleA,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      await generateWeekFromTemplate(orgA, locA, WEEK_1, userA);
      await generateWeekFromTemplate(orgA, locA, WEEK_2, userA);
      const [manual] = await db
        .insert(shift)
        .values({
          organisationId: orgA,
          storeLocationId: locA,
          rosterRoleId: roleA,
          startDatetime: new Date("2027-03-01T23:00:00.000Z"),
          endDatetime: new Date("2027-03-02T02:00:00.000Z"),
          createdBy: userA,
        })
        .returning();

      const undoResult = await undoGeneration(orgA, locA, WEEK_1);
      expect(undoResult).toEqual({ cancelled: 1 });

      const week1Shifts = await db
        .select()
        .from(shift)
        .where(eq(shift.generatedForWeekStart, WEEK_1));
      expect(week1Shifts.every((s) => s.status === "Cancelled")).toBe(true);

      const week2Shifts = await db
        .select()
        .from(shift)
        .where(eq(shift.generatedForWeekStart, WEEK_2));
      expect(week2Shifts.every((s) => s.status !== "Cancelled")).toBe(true);

      const [manualAfter] = await db.select().from(shift).where(eq(shift.shiftId, manual.shiftId));
      expect(manualAfter.status).not.toBe("Cancelled");

      // Idempotent: a second run cancels nothing new.
      const secondUndo = await undoGeneration(orgA, locA, WEEK_1);
      expect(secondUndo).toEqual({ cancelled: 0 });

      const allGenerated = await db
        .select()
        .from(shift)
        .where(eq(shift.sourceTemplateRowId, row.rosterShiftTemplateId));
      await db.delete(shift).where(
        inArray(
          shift.shiftId,
          [...allGenerated.map((r) => r.shiftId), manual.shiftId],
        ),
      );
      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
    });
  });

  describe("deleteRole in-use-template guard (regression)", () => {
    it("blocks deleting a role used only in a template (409), same pattern as the existing shift-in-use guard", async () => {
      const guardedRole = await createRole(orgA, { roleName: `${tag}-guarded`, storeLocationId: locA });
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: guardedRole.rosterRoleId,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      await expect(deleteRole(orgA, guardedRole.rosterRoleId)).rejects.toMatchObject({ statusCode: 409 });

      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
      await deleteRole(orgA, guardedRole.rosterRoleId); // now unblocked
    });
  });

  describe("updateRole cross-venue conflict check (docs/designs/roster-roles-venue-picker.md)", () => {
    it("rejects (409, RoleVenueConflictError) an unconfirmed move away from a venue where the role is still templated", async () => {
      const conflictRole = await createRole(orgA, { roleName: `${tag}-conflict1`, storeLocationId: locA });
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: conflictRole.rosterRoleId,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      await expect(
        updateRole(orgA, conflictRole.rosterRoleId, { roleName: conflictRole.roleName, storeLocationId: locOther }),
      ).rejects.toMatchObject({
        statusCode: 409,
        name: "RoleVenueConflictError",
        conflicts: [{ storeLocationId: locA }],
      });

      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
      await deleteRole(orgA, conflictRole.rosterRoleId);
    });

    it("saves when confirmed:true is passed despite the conflict", async () => {
      const confirmedRole = await createRole(orgA, { roleName: `${tag}-conflict2`, storeLocationId: locA });
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: confirmedRole.rosterRoleId,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      const updated = await updateRole(orgA, confirmedRole.rosterRoleId, {
        roleName: confirmedRole.roleName,
        storeLocationId: locOther,
        confirmed: true,
      });
      expect(updated.storeLocationId).toBe(locOther);

      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
      await deleteRole(orgA, confirmedRole.rosterRoleId);
    });

    it("never conflicts when widening to org-wide (storeLocationId: null), even with templates at another venue", async () => {
      const wideningRole = await createRole(orgA, { roleName: `${tag}-widen`, storeLocationId: locA });
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: wideningRole.rosterRoleId,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      const updated = await updateRole(orgA, wideningRole.rosterRoleId, {
        roleName: wideningRole.roleName,
        storeLocationId: null,
      });
      expect(updated.storeLocationId).toBeNull();

      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
      await deleteRole(orgA, wideningRole.rosterRoleId);
    });

    it("does not conflict when the only templates are at the new target venue itself", async () => {
      const sameVenueRole = await createRole(orgA, { roleName: `${tag}-samevenue`, storeLocationId: locA });
      const row = await createTemplateRow(orgA, {
        storeLocationId: locA,
        rosterRoleId: sameVenueRole.rosterRoleId,
        dayOfWeek: MON,
        startTime: "09:00",
        endTime: "17:00",
      });

      const updated = await updateRole(orgA, sameVenueRole.rosterRoleId, {
        roleName: `${tag}-samevenue-renamed`,
        storeLocationId: locA,
      });
      expect(updated.storeLocationId).toBe(locA);

      await deleteTemplateRow(orgA, row.rosterShiftTemplateId);
      await deleteRole(orgA, sameVenueRole.rosterRoleId);
    });
  });

  describe("createRole duplicate-name guard (idx_roster_role_org_location_name)", () => {
    it("rejects (409) a role name that already exists at the same venue", async () => {
      const name = `${tag}-dupname`;
      const first = await createRole(orgA, { roleName: name, storeLocationId: locA });

      await expect(createRole(orgA, { roleName: name, storeLocationId: locA })).rejects.toMatchObject({
        statusCode: 409,
      });

      await deleteRole(orgA, first.rosterRoleId);
    });

    it("allows the same name at a different venue, and allows two org-wide roles with the same name", async () => {
      const name = `${tag}-dupname-ok`;
      const atLocA = await createRole(orgA, { roleName: name, storeLocationId: locA });
      const atLocOther = await createRole(orgA, { roleName: name, storeLocationId: locOther });
      const wide1 = await createRole(orgA, { roleName: name, storeLocationId: null });
      const wide2 = await createRole(orgA, { roleName: name, storeLocationId: null });

      await deleteRole(orgA, atLocA.rosterRoleId);
      await deleteRole(orgA, atLocOther.rosterRoleId);
      await deleteRole(orgA, wide1.rosterRoleId);
      await deleteRole(orgA, wide2.rosterRoleId);
    });
  });
});
