import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { organisation, user, userOrganisation, storeLocation, staffAvailability } from "../db/schema.js";
import { migrations } from "./index.js";

/** Migration 0005 (one availability window per person): idempotent, applied by hand before the deploy. Gated on TENANT_IT=1. */
const RUN = process.env.TENANT_IT === "1";

describe("migration 0005", () => {
  it("is registered after 0003 (0004 is reserved for the push work)", () => {
    const ids = migrations.map((m) => m.id);
    expect(ids).toContain("0005_staff_availability_unique");
    expect(ids.indexOf("0005_staff_availability_unique")).toBeGreaterThan(ids.indexOf("0003_apple_sign_in"));
  });
});

describe.skipIf(!RUN)("migration 0005 (real DB)", () => {
  const tag = `mig5-${Date.now().toString(36)}`;
  let userId: number;
  let orgId: number;
  let locId: string;

  beforeAll(async () => {
    [{ id: userId }] = await db.insert(user).values({ userName: `${tag} User`, userEmail: `${tag}@it.test` }).returning({ id: user.userId });
    [{ id: orgId }] = await db
      .insert(organisation)
      .values({ organisationName: tag, joinKey: `${tag}-k`.slice(0, 25), createdBy: userId })
      .returning({ id: organisation.organisationId });
    await db.insert(userOrganisation).values({ userId, organisationId: orgId, role: "member" });
    [{ id: locId }] = await db
      .insert(storeLocation)
      .values({ organisationId: orgId, locationName: tag, storeKey: tag.slice(0, 25), createdBy: userId })
      .returning({ id: storeLocation.storeLocationId });
  });

  afterAll(async () => {
    await db.delete(staffAvailability).where(eq(staffAvailability.userId, userId));
    await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locId));
    await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, orgId));
    await db.delete(organisation).where(eq(organisation.organisationId, orgId));
    await db.delete(user).where(eq(user.userId, userId));
  });

  const ROLLBACK = new Error("rollback");

  it("removes only exact twins, keeps the oldest of each set, then enforces one row per window; running it twice changes nothing more", async () => {
    const m = migrations.find((x) => x.id === "0005_staff_availability_unique")!;
    const insert = (tx: typeof db, createdAt: string, o: { loc?: string | null; until?: string | null; to?: string } = {}) =>
      tx.execute(sql`
        INSERT INTO staff_availability (user_id, organisation_id, store_location_id, day_of_week, available_from, available_until, effective_from, effective_until, created_dttm)
        VALUES (${userId}, ${orgId}, ${o.loc ?? null}, 1, '09:00', ${o.to ?? "17:00"}, '2026-09-01', ${o.until ?? null}, ${createdAt}::timestamptz)
        RETURNING staff_availability_id`) as unknown as Promise<Array<{ staff_availability_id: string }>>;

    let seen: { rows: Array<{ id: string; created: string; to: string; loc: string | null; until: string | null }>; oldestAnyVenue: string; oldestAtVenue: string } | undefined;
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`DROP INDEX IF EXISTS uq_staff_availability_window`); // the state production is in now
        // Three copies of the any-venue window (the middle one is the oldest), two copies of a venue window, and three look-alikes that are NOT twins.
        const [a1] = await insert(tx as never, "2026-01-02T00:00:00Z");
        const [a0] = await insert(tx as never, "2026-01-01T00:00:00Z");
        await insert(tx as never, "2026-01-03T00:00:00Z");
        const [v0] = await insert(tx as never, "2026-02-01T00:00:00Z", { loc: locId });
        await insert(tx as never, "2026-02-02T00:00:00Z", { loc: locId });
        await insert(tx as never, "2026-03-01T00:00:00Z", { to: "16:00" });
        await insert(tx as never, "2026-03-02T00:00:00Z", { until: "2026-12-31" });
        await insert(tx as never, "2026-03-03T00:00:00Z", { loc: locId, to: "16:00" });

        for (let i = 0; i < 2; i++) for (const s of m.statements) await tx.execute(sql.raw(s));

        const rows = (await tx.execute(sql`
          SELECT staff_availability_id AS id, created_dttm::text AS created, available_until AS "to", store_location_id AS loc, effective_until::text AS until
          FROM staff_availability WHERE user_id = ${userId} ORDER BY created_dttm`)) as unknown as NonNullable<typeof seen>["rows"];
        seen = { rows, oldestAnyVenue: a0.staff_availability_id, oldestAtVenue: v0.staff_availability_id };
        expect(a1.staff_availability_id).not.toBe(a0.staff_availability_id);

        // The rule is live: an exact twin is refused (unique violation; the transaction is dead after this, so it comes last).
        await expect(insert(tx as never, "2026-04-01T00:00:00Z")).rejects.toMatchObject({ code: "23505" });
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });

    expect(seen!.rows).toHaveLength(5); // 3 + 2 twins -> 1 + 1, plus 3 look-alikes
    const ids = seen!.rows.map((r) => r.id);
    expect(ids).toContain(seen!.oldestAnyVenue);
    expect(ids).toContain(seen!.oldestAtVenue);
    expect(seen!.rows.filter((r) => r.to === "16:00" || r.until === "2026-12-31")).toHaveLength(3);
    // Nothing was left behind by the rolled-back transaction.
    expect(await db.select().from(staffAvailability).where(eq(staffAvailability.userId, userId))).toHaveLength(0);
  });
});
