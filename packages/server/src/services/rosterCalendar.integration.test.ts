import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { organisation, user, userOrganisation, storeLocation, rosterRole, shift, shiftAssignment } from "../db/schema.js";
import { getWeekCalendar } from "./rosterService.js";

/**
 * Real-database behaviour of getWeekCalendar (Roster week calendar).
 * Gated on TENANT_IT=1, same convention as staffingCoverage.integration.test.ts.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `rc_${Date.now().toString(36)}`;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

describe.skipIf(!RUN)("getWeekCalendar (real DB)", () => {
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let locA: string;
  let locB: string;
  let roleId: string;
  const shiftIds: string[] = [];

  beforeAll(async () => {
    [{ id: userA }] = await db.insert(user).values({ userName: "Calendar Staff A", userEmail: `${tag}-a@it.test` }).returning({ id: user.userId });
    [{ id: userB }] = await db.insert(user).values({ userName: "Calendar Staff B", userEmail: `${tag}-b@it.test` }).returning({ id: user.userId });

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

    // Draft, unassigned.
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
    // s1 also has a Declined assignment — it must read as unassigned, not
    // as if the decliner is still on the shift.
    await db.insert(shiftAssignment).values({ shiftId: s1.id, userId: userB, status: "Declined" });

    // Draft, two assignees on the same shift — both must appear.
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
    await db.insert(shiftAssignment).values([
      { shiftId: s2.id, userId: userA },
      { shiftId: s2.id, userId: userB },
    ]);

    // Published, one assignee — confirms Published shifts are still included.
    const day3 = addDays(TODAY, 2);
    const [s3] = await db
      .insert(shift)
      .values({
        organisationId: orgA,
        storeLocationId: locA,
        rosterRoleId: roleId,
        startDatetime: new Date(`${day3}T09:00:00Z`),
        endDatetime: new Date(`${day3}T17:00:00Z`),
        status: "Published",
        createdBy: userA,
      })
      .returning({ id: shift.shiftId });
    shiftIds.push(s3.id);
    await db.insert(shiftAssignment).values({ shiftId: s3.id, userId: userA, status: "Confirmed" });

    // Cancelled — must never appear.
    const day4 = addDays(TODAY, 3);
    const [s4] = await db
      .insert(shift)
      .values({
        organisationId: orgA,
        storeLocationId: locA,
        rosterRoleId: roleId,
        startDatetime: new Date(`${day4}T09:00:00Z`),
        endDatetime: new Date(`${day4}T11:00:00Z`),
        status: "Cancelled",
        createdBy: userA,
      })
      .returning({ id: shift.shiftId });
    shiftIds.push(s4.id);
  });

  afterAll(async () => {
    if (shiftIds.length) {
      await db.delete(shiftAssignment).where(inArray(shiftAssignment.shiftId, shiftIds));
      await db.delete(shift).where(inArray(shift.shiftId, shiftIds));
    }
    if (roleId) await db.delete(rosterRole).where(eq(rosterRole.rosterRoleId, roleId));
    if (locA) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locA));
    if (locB) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locB));
    if (orgA && orgB) {
      await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
      await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    }
    if (userA && userB) await db.delete(user).where(inArray(user.userId, [userA, userB]));
  });

  it("returns one row per shift with role name and assignees inline, excludes Cancelled", async () => {
    const rows = await getWeekCalendar(orgA, locA, TODAY, addDays(TODAY, 4));

    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.shiftId === shiftIds[3])).toBe(false); // Cancelled

    const unassigned = rows.find((r) => r.shiftId === shiftIds[0])!;
    expect(unassigned.roleName).toBe(`${tag}-bartender`);
    // Reads as unassigned even though it carries a Declined row — only
    // Pending/Confirmed assignees are "on" a shift.
    expect(unassigned.assignments).toEqual([]);

    const twoAssignees = rows.find((r) => r.shiftId === shiftIds[1])!;
    expect(twoAssignees.assignments).toHaveLength(2);
    expect(twoAssignees.assignments.map((a) => a.staffName).sort()).toEqual(["Calendar Staff A", "Calendar Staff B"]);

    const published = rows.find((r) => r.shiftId === shiftIds[2])!;
    expect(published.status).toBe("Published");
    expect(published.assignments).toEqual([{ assignmentId: expect.any(String), userId: userA, staffName: "Calendar Staff A", status: "Confirmed" }]);
  });

  it("rejects invalid from/to with 400", async () => {
    await expect(getWeekCalendar(orgA, locA, "not-a-date", TODAY)).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 400,
    });
  });

  it("404s a location in another org rather than confirming it exists", async () => {
    await expect(getWeekCalendar(orgA, locB, TODAY, addDays(TODAY, 4))).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 404,
    });
  });
});
