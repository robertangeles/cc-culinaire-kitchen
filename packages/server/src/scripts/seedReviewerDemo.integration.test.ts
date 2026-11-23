import { describe, it, expect, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { stockTakeSession, storeLocation, userOrganisation } from "../db/schema.js";
import { loginUser } from "../services/authService.js";
import { getUserLocationContext } from "../services/locationContextService.js";
import { getUserWithRolesAndPermissions } from "../services/authService.js";
import { listAreas } from "../services/storageAreaService.js";
import { DEMO_AREAS, seedReviewerDemo } from "./seedReviewerDemo.js";

/** The reviewer can sign in and count straight away, and a second run changes nothing. Gated on TENANT_IT=1 like the other real-DB suites. */
const RUN = process.env.TENANT_IT === "1";
const PREFIX = "it-reviewer-";
const email = `${PREFIX}${Date.now()}@it.test`;
const PASSWORD = "Reviewer-Passw0rd!";

describe.skipIf(!RUN)("seedReviewerDemo (real DB)", { timeout: 120_000 }, () => {
  let userId = 0;
  let orgId = 0;

  /** Deletes the rows matching `where`, and first every row anywhere that points at them (the foreign keys do not cascade). */
  async function purge(table: string, where: string, depth = 0): Promise<void> {
    if (depth > 6) return;
    const rows = await db.execute<{ child: string; child_col: string; parent_col: string }>(sql`
      select c.conrelid::regclass::text as child, a.attname as child_col, af.attname as parent_col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
      where c.contype = 'f' and c.confrelid = ${table}::regclass and c.conrelid <> c.confrelid`);
    for (const fk of rows) await purge(fk.child, `"${fk.child_col}" in (select "${fk.parent_col}" from ${table} where ${where})`, depth + 1);
    await db.execute(sql.raw(`delete from ${table} where ${where}`));
  }

  // Also sweeps what an earlier failed run left behind.
  afterAll(async () => {
    const rows = await db.execute<{ user_id: number; organisation_id: number | null }>(sql`
      select u.user_id, uo.organisation_id from "user" u left join user_organisation uo on uo.user_id = u.user_id where u.user_email like ${PREFIX + "%"}`);
    for (const r of rows) {
      if (r.organisation_id) await purge("organisation", `organisation_id = ${r.organisation_id}`);
      await purge('"user"', `user_id = ${r.user_id}`);
    }
  });

  it("makes a verified reviewer who signs in with no second step, at a location, with areas and an open area count", async () => {
    const out = await seedReviewerDemo(email, PASSWORD);
    userId = out.userId;
    orgId = out.organisationId;
    expect(out.openedStockTake).toBe(true);

    const login = await loginUser(email, PASSWORD);
    expect(login.requiresMfa).toBe(false);

    const ctx = await getUserLocationContext(userId);
    expect(ctx.locations.map((l) => l.storeLocationId)).toEqual([out.storeLocationId]);

    const areas = await listAreas(out.storeLocationId, orgId);
    for (const demo of DEMO_AREAS) expect(areas.find((a) => a.areaName === demo.area)?.itemCount).toBe(4);

    const open = await db.select().from(stockTakeSession).where(eq(stockTakeSession.storeLocationId, out.storeLocationId));
    expect(open.filter((s) => s.sessionStatus === "OPEN")).toHaveLength(1);
    expect(open[0].countMode).toBe("AREA");

    const me = await getUserWithRolesAndPermissions(userId);
    expect(me?.permissions).toContain("inventory:count");
  });

  it("a second run reuses everything: one user, one organisation, one location, one open stock take", async () => {
    const out = await seedReviewerDemo(email, PASSWORD);
    expect(out.userId).toBe(userId);
    expect(out.organisationId).toBe(orgId);
    expect(out.openedStockTake).toBe(false);
    expect(await db.select().from(userOrganisation).where(eq(userOrganisation.userId, userId))).toHaveLength(1);
    expect(await db.select().from(storeLocation).where(eq(storeLocation.organisationId, orgId))).toHaveLength(1);
    expect((await listAreas(out.storeLocationId, orgId)).filter((a) => a.itemCount > 0)).toHaveLength(3);
  });
});
