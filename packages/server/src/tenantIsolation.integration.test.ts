import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import { getMenuItem } from "./services/menuIntelligenceService.js";
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

  it("getMenuItem is owner-scoped (user-first isolation)", async () => {
    expect(await getMenuItem(menuA, userB)).toBeNull();
    expect(await getMenuItem(menuA, userA)).not.toBeNull();
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
