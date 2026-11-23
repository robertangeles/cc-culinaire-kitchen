import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "./utils/envShim.js";

// Load .env before the first query. Every other real-DB suite in this repo does
// this; these four did not, so they threw "DATABASE_URL environment variable is
// required" anywhere DATABASE_URL was not already exported — i.e. everywhere
// except the dedicated CI Postgres job. The result was 63 tests, including the
// entire tenant-isolation boundary suite, that no developer could run before
// pushing. Safe in CI too: dotenv never overrides an already-set variable, and
// applyEnvPrefix copies the same value CI already provides.
//
// `db` is a lazy proxy that connects on first use, not on import, so running
// this after the import statements is early enough.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
applyEnvPrefix();
import { eq, inArray } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  organisation,
  user,
  userOrganisation,
  ingredient,
  supplier,
  storeLocation,
  menuItem,
  sale,
  conversation,
  message,
} from "./db/schema.js";
import {
  listIngredients,
  getIngredient,
  getSupplierInOrg,
  createIngredient,
  createSupplier,
} from "./services/ingredientService.js";
import { getMenuItem, getMenuItems, updateMenuItem, deleteMenuItem } from "./services/menuIntelligenceService.js";
import { recordSale, voidSale } from "./services/saleService.js";
import { saveMessages } from "./services/conversationService.js";
import { getLocationInOrg } from "./services/locationContextService.js";

/**
 * Real-database tenant-isolation boundary suite.
 *
 * Unlike the mocked unit tests, this seeds TWO organisations + TWO users into a
 * live Postgres and asserts the isolation guarantee directly on the real service
 * queries: a caller from org/user B can never read org/user A's data, and a
 * cross-owner write is refused. Proves the fixes from the 2026-07 tenant-
 * isolation remediation against an actual database — the layer the mocked suite
 * cannot exercise.
 *
 * Gated on TENANT_IT=1 so it is skipped by the DB-less main CI job and run only
 * by the dedicated Postgres integration job (and locally against a dev DB).
 * Self-cleaning: afterAll deletes exactly the rows it seeded, so it is safe to
 * run against a shared database.
 */
const RUN = process.env.TENANT_IT === "1";

describe.skipIf(!RUN)("tenant isolation — real DB", () => {
  const tag = `tenantit_${Date.now()}`;
  let userA: number;
  let userB: number;
  let orgA: number;
  let orgB: number;
  let ingA: string;
  let supA: string;
  let locA: string;
  let menuA: number;
  const convA = `${tag}-conv`;

  beforeAll(async () => {
    [{ userId: userA }] = await db
      .insert(user)
      .values({ userName: "IT A", userEmail: `${tag}-a@it.test` })
      .returning({ userId: user.userId });
    [{ userId: userB }] = await db
      .insert(user)
      .values({ userName: "IT B", userEmail: `${tag}-b@it.test` })
      .returning({ userId: user.userId });

    [{ id: orgA }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-A`, joinKey: `${tag}-ka`, createdBy: userA })
      .returning({ id: organisation.organisationId });
    [{ id: orgB }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-B`, joinKey: `${tag}-kb`, createdBy: userB })
      .returning({ id: organisation.organisationId });

    await db.insert(userOrganisation).values([
      { userId: userA, organisationId: orgA, role: "admin" },
      { userId: userB, organisationId: orgB, role: "admin" },
    ]);

    ingA = (await createIngredient(orgA, {
      ingredientName: `${tag}-ing`,
      ingredientCategory: "produce",
      baseUnit: "kg",
    })).ingredientId;
    supA = (await createSupplier(orgA, { supplierName: `${tag}-sup` })).supplierId;

    [{ id: locA }] = await db
      .insert(storeLocation)
      .values({ organisationId: orgA, locationName: `${tag}-loc`, storeKey: `${tag}-sk`, createdBy: userA })
      .returning({ id: storeLocation.storeLocationId });

    [{ id: menuA }] = await db
      .insert(menuItem)
      .values({ userId: userA, name: `${tag}-menu`, category: "mains", sellingPrice: "10.00" })
      .returning({ id: menuItem.menuItemId });

    await db
      .insert(conversation)
      .values({ conversationId: convA, conversationTitle: `${tag}-c`, userId: userA });
  });

  afterAll(async () => {
    // Children first (FK-safe), then parents. Only the rows this suite created.
    await db.delete(message).where(eq(message.conversationId, convA));
    await db.delete(conversation).where(eq(conversation.conversationId, convA));
    if (menuA) await db.delete(menuItem).where(eq(menuItem.menuItemId, menuA));
    if (locA) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locA));
    if (supA) await db.delete(supplier).where(eq(supplier.supplierId, supA));
    if (ingA) await db.delete(ingredient).where(eq(ingredient.ingredientId, ingA));
    if (orgA && orgB) {
      await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
      await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    }
    if (userA && userB) await db.delete(user).where(inArray(user.userId, [userA, userB]));
  });

  it("listIngredients scopes to the caller's org", async () => {
    const bRows = (await listIngredients(orgB)) as Array<{ ingredientId: string }>;
    expect(bRows.some((r) => r.ingredientId === ingA)).toBe(false); // org B cannot see org A's ingredient
    const aRows = (await listIngredients(orgA)) as Array<{ ingredientId: string }>;
    expect(aRows.some((r) => r.ingredientId === ingA)).toBe(true); // org A sees its own
  });

  it("getIngredient is org-scoped", async () => {
    expect(await getIngredient(ingA, orgB)).toBeNull();
    expect(await getIngredient(ingA, orgA)).not.toBeNull();
  });

  it("getSupplierInOrg is org-scoped", async () => {
    expect(await getSupplierInOrg(supA, orgB)).toBeNull();
    expect(await getSupplierInOrg(supA, orgA)).not.toBeNull();
  });

  it("getLocationInOrg is org-scoped", async () => {
    expect(await getLocationInOrg(locA, orgB)).toBe(false);
    expect(await getLocationInOrg(locA, orgA)).toBe(true);
  });

  // `menuA` above has no organisation (a row an older server wrote), so it only proves the creator-only fallback.
  // This item carries organisation_id, which is the path every new item takes.
  it("an item that belongs to organisation A cannot be read, changed, sold or voided from organisation B, member or admin", async () => {
    const [item] = await db
      .insert(menuItem)
      .values({ userId: userA, organisationId: orgA, name: `${tag}-org-menu`, category: "mains", sellingPrice: "10.00" })
      .returning({ id: menuItem.menuItemId });
    let saleId: string | undefined;
    try {
      const scopeA = { userId: userA, organisationId: orgA, isOrgAdmin: true };
      const made = await recordSale(orgA, userA, { menuItemId: item.id, qtySold: 1, locationId: locA });
      saleId = made.saleId;

      for (const isOrgAdmin of [false, true]) {
        const scopeB = { userId: userB, organisationId: orgB, isOrgAdmin };
        expect(await getMenuItem(item.id, scopeB)).toBeNull();
        expect((await getMenuItems(scopeB)).map((i) => i.menuItemId)).not.toContain(item.id);
        await expect(updateMenuItem(item.id, scopeB, { name: "hijacked" })).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
        await expect(deleteMenuItem(item.id, scopeB)).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
        await expect(recordSale(orgB, userB, { menuItemId: item.id, qtySold: 1, locationId: locA })).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
        await expect(voidSale(scopeB as typeof scopeB & { organisationId: number }, saleId, { sub: userB, roles: [], permissions: [] })).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
      }

      // Nothing moved, and organisation A itself still reads and changes it.
      const [row] = await db.select({ name: menuItem.name, sold: menuItem.unitsSold }).from(menuItem).where(eq(menuItem.menuItemId, item.id));
      expect(row).toEqual({ name: `${tag}-org-menu`, sold: 1 });
      const [saleRow] = await db.select({ voidedAt: sale.voidedAt }).from(sale).where(eq(sale.saleId, saleId));
      expect(saleRow.voidedAt).toBeNull();
      expect(await getMenuItem(item.id, scopeA)).not.toBeNull();
      await updateMenuItem(item.id, scopeA, { name: `${tag}-org-menu-2` });
      expect((await getMenuItem(item.id, scopeA))?.name).toBe(`${tag}-org-menu-2`);
    } finally {
      if (saleId) await db.delete(sale).where(eq(sale.saleId, saleId));
      await db.delete(menuItem).where(eq(menuItem.menuItemId, item.id));
    }
  });

  it("getMenuItem is organisation-scoped (another organisation's admin cannot see it)", async () => {
    expect(await getMenuItem(menuA, { userId: userB, organisationId: orgB, isOrgAdmin: true })).toBeNull();
    expect(await getMenuItem(menuA, { userId: userA, organisationId: orgA, isOrgAdmin: true })).not.toBeNull();
  });

  it("saveMessages refuses a cross-owner write and inserts nothing", async () => {
    const msg = [{ messageId: `${tag}-m`, messageRole: "user", messageBody: "x", messageSequence: 0 }];
    expect(await saveMessages(convA, { userId: userB }, msg)).toBe(false);
    const rows = await db
      .select({ id: message.messageId })
      .from(message)
      .where(eq(message.conversationId, convA));
    expect(rows.length).toBe(0); // nothing was written on the cross-owner attempt
    expect(await saveMessages(convA, { userId: userA }, [])).toBe(true); // owner allowed
  });
});
