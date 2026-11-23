import { describe, it, expect, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { menuItem, organisation, user, userOrganisation } from "../db/schema.js";
import { migrations } from "./index.js";

/** Migration 0006 (menu items belong to the organisation): idempotent, applied by hand before the deploy. Gated on TENANT_IT=1. */
const RUN = process.env.TENANT_IT === "1";

describe("migration 0006", () => {
  it("is registered after 0003, leaving 0004 and 0005 to the other workers", () => {
    const ids = migrations.map((m) => m.id);
    expect(ids).toContain("0006_menu_item_organisation");
    expect(ids.indexOf("0006_menu_item_organisation")).toBeGreaterThan(ids.indexOf("0003_apple_sign_in"));
  });
});

describe.skipIf(!RUN)("migration 0006 (real DB)", () => {
  const tag = `mig6-${Date.now().toString(36)}`;
  const users: number[] = [];
  const orgs: number[] = [];
  const items: string[] = [];

  afterAll(async () => {
    if (items.length) await db.delete(menuItem).where(inArray(menuItem.menuItemId, items));
    if (users.length) await db.delete(userOrganisation).where(inArray(userOrganisation.userId, users));
    if (orgs.length) await db.delete(organisation).where(inArray(organisation.organisationId, orgs));
    if (users.length) await db.delete(user).where(inArray(user.userId, users));
  });

  const run = async () => {
    const m = migrations.find((x) => x.id === "0006_menu_item_organisation")!;
    for (const s of m.statements) await db.execute(sql.raw(s));
  };

  it("runs twice, leaves a nullable indexed column, and backfills each creator's earliest membership only where NULL", async () => {
    await run();
    const mkUser = async (n: string) => (await db.insert(user).values({ userName: `M6 ${n}`, userEmail: `${tag}-${n}@it.test` }).returning({ id: user.userId }))[0].id;
    const multi = await mkUser("multi");
    const none = await mkUser("none");
    users.push(multi, none);
    for (const n of ["first", "second"]) {
      const [{ id }] = await db.insert(organisation).values({ organisationName: `${tag}-${n}`, joinKey: `${tag}-${n}`.slice(0, 25), createdBy: multi }).returning({ id: organisation.organisationId });
      orgs.push(id);
    }
    await db.insert(userOrganisation).values({ userId: multi, organisationId: orgs[0], role: "member" });
    await db.insert(userOrganisation).values({ userId: multi, organisationId: orgs[1], role: "admin" });

    // Rows exactly as the previous server writes them: no organisation column.
    const mk = async (userId: number, name: string) => {
      const [{ id }] = await db.insert(menuItem).values({ userId, name: `${tag} ${name}`, category: "mains", sellingPrice: "5.00" }).returning({ id: menuItem.menuItemId });
      items.push(id);
      return id;
    };
    const fromMulti = await mk(multi, "multi");
    const fromNone = await mk(none, "none");
    const alreadySet = await mk(multi, "set");
    await db.update(menuItem).set({ organisationId: orgs[1] }).where(eq(menuItem.menuItemId, alreadySet));

    await run();
    await run();

    const org = async (id: string) => (await db.select({ o: menuItem.organisationId }).from(menuItem).where(eq(menuItem.menuItemId, id)))[0].o;
    expect(await org(fromMulti)).toBe(orgs[0]);
    expect(await org(fromNone)).toBeNull();
    expect(await org(alreadySet)).toBe(orgs[1]);

    const idx = (await db.execute(sql`SELECT indexname FROM pg_indexes WHERE tablename = 'menu_item' AND indexname = 'idx_menu_item_organisation'`)) as unknown as unknown[];
    expect(idx).toHaveLength(1);
    const col = (await db.execute(sql`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'menu_item' AND column_name = 'organisation_id'`)) as unknown as Array<{ is_nullable: string }>;
    expect(col.map((c) => c.is_nullable)).toEqual(["YES"]);
  });
});
