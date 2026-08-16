import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { organisation, user, storeLocation, publicHoliday } from "../db/schema.js";
import {
  isYearLoaded,
  isPublicHoliday,
  listPublicHolidays,
  createPublicHoliday,
  deletePublicHoliday,
  runPublicHolidayGapCheck,
  PublicHolidayError,
} from "./publicHolidayService.js";

/**
 * Real-database behaviour of publicHolidayService (Phase 2, Slice 6).
 * Gated on TENANT_IT=1, same convention as roster.integration.test.ts.
 *
 * No tenancy on `public_holiday` (jurisdiction-keyed shared reference data,
 * same shape as award_rule), so these tests avoid a real AU jurisdiction
 * code for the CRUD/lookup cases — "ZZZ" can never collide with a real
 * state's rows. The gap-check test, by contrast, MUST use a real
 * jurisdiction (VIC) because runPublicHolidayGapCheck derives jurisdictions
 * from store_location.state — it seeds its own store_location and reads
 * gaps for a year (2099) nobody will ever have loaded.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `phv_${Date.now().toString(36)}`;
const TEST_JURISDICTION = "ZZZ";

describe.skipIf(!RUN)("publicHolidayService (real DB)", () => {
  const seededIds: string[] = [];

  afterAll(async () => {
    for (const id of seededIds) {
      await db.delete(publicHoliday).where(eq(publicHoliday.publicHolidayId, id));
    }
  });

  it("isYearLoaded is false before any row exists for that jurisdiction+year", async () => {
    expect(await isYearLoaded(TEST_JURISDICTION, 2091)).toBe(false);
  });

  it("createPublicHoliday loads the year; isYearLoaded then reports true", async () => {
    const created = await createPublicHoliday({
      jurisdiction: TEST_JURISDICTION,
      holidayDate: "2091-01-01",
      holidayName: `${tag} Test Day`,
      loadedForYear: 2091,
    });
    seededIds.push(created.publicHolidayId);
    expect(await isYearLoaded(TEST_JURISDICTION, 2091)).toBe(true);
  });

  it("isPublicHoliday throws 409 for an unloaded year", async () => {
    await expect(isPublicHoliday("2092-06-01", TEST_JURISDICTION)).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(isPublicHoliday("2092-06-01", TEST_JURISDICTION)).rejects.toBeInstanceOf(PublicHolidayError);
  });

  it("isPublicHoliday returns true for the loaded date, false for another date in the same loaded year", async () => {
    expect(await isPublicHoliday("2091-01-01", TEST_JURISDICTION)).toBe(true);
    expect(await isPublicHoliday("2091-06-01", TEST_JURISDICTION)).toBe(false);
  });

  it("createPublicHoliday rejects a duplicate (jurisdiction, holidayDate) with 409", async () => {
    await expect(
      createPublicHoliday({
        jurisdiction: TEST_JURISDICTION,
        holidayDate: "2091-01-01",
        holidayName: `${tag} Duplicate`,
        loadedForYear: 2091,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("listPublicHolidays filters by jurisdiction and year", async () => {
    const rows = await listPublicHolidays({ jurisdiction: TEST_JURISDICTION, year: 2091 });
    expect(rows.some((r) => r.holidayName === `${tag} Test Day`)).toBe(true);
    expect(rows.every((r) => r.jurisdiction === TEST_JURISDICTION)).toBe(true);
  });

  it("deletePublicHoliday removes the row; a second delete 404s", async () => {
    const created = await createPublicHoliday({
      jurisdiction: TEST_JURISDICTION,
      holidayDate: "2093-12-25",
      holidayName: `${tag} To Delete`,
      loadedForYear: 2093,
    });
    await deletePublicHoliday(created.publicHolidayId);
    await expect(deletePublicHoliday(created.publicHolidayId)).rejects.toMatchObject({ statusCode: 404 });
  });

  describe("runPublicHolidayGapCheck", () => {
    let orgId: number;
    let userId: number;
    let locId: string;

    beforeAll(async () => {
      [{ id: userId }] = await db
        .insert(user)
        .values({ userName: "Gap Check Owner", userEmail: `${tag}-gap@it.test` })
        .returning({ id: user.userId });
      [{ id: orgId }] = await db
        .insert(organisation)
        .values({ organisationName: `${tag}-gap`, joinKey: `${tag}-gapk`.slice(0, 25), createdBy: userId })
        .returning({ id: organisation.organisationId });
      [{ id: locId }] = await db
        .insert(storeLocation)
        .values({
          organisationId: orgId,
          locationName: `${tag}-gap-loc`,
          storeKey: `${tag}-gapsk`.slice(0, 25),
          createdBy: userId,
          state: "VIC",
        })
        .returning({ id: storeLocation.storeLocationId });
    });

    afterAll(async () => {
      await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locId));
      await db.delete(organisation).where(eq(organisation.organisationId, orgId));
      await db.delete(user).where(eq(user.userId, userId));
    });

    it("reports VIC/2099 as missing until a row is loaded for it, then no longer missing", async () => {
      // 2099 is a year nobody else running these suites will ever have
      // loaded — a deterministic "definitely missing" year, independent of
      // whatever real VIC holiday rows already exist in a shared dev DB.
      const farFuture = new Date(2099, 5, 1);

      const before = await runPublicHolidayGapCheck(farFuture);
      expect(before.checked).toContainEqual({ jurisdiction: "VIC", year: 2099 });
      expect(before.missing).toContainEqual({ jurisdiction: "VIC", year: 2099 });

      const created = await createPublicHoliday({
        jurisdiction: "VIC",
        holidayDate: "2099-01-01",
        holidayName: `${tag} Future New Year`,
        loadedForYear: 2099,
      });
      seededIds.push(created.publicHolidayId);

      const after = await runPublicHolidayGapCheck(farFuture);
      expect(after.checked).toContainEqual({ jurisdiction: "VIC", year: 2099 });
      expect(after.missing).not.toContainEqual({ jurisdiction: "VIC", year: 2099 });
    });
  });
});
