import { describe, it, expect, beforeAll } from "vitest";

/**
 * Regression guard for the cross-tenant catalog leak.
 *
 * The default (unfiltered) ingredient list once dropped its org filter because
 * chained `.where()` on a `$dynamic()` query REPLACES the prior clause rather
 * than ANDing it — so `isNull(deletedAt)` overwrote `eq(organisationId, ...)`
 * and the query returned every tenant's catalog. This asserts the COMPILED SQL
 * for every option combination still binds organisation_id.
 *
 * No db mock here: we import the real service and compile the query with
 * `.toSQL()` (offline — never connects, never runs).
 */
beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:5432/testdb";
});

describe("listIngredients — tenant isolation (SQL guard)", () => {
  it("filters by organisation_id in every option combination", async () => {
    const { listIngredients } = await import("./ingredientService.js");
    const ORG = 42;
    const combos = [
      undefined,
      { category: "proteins" },
      { search: "salmon" },
      { itemType: "KITCHEN_INGREDIENT" },
      { includeSoftDeleted: true },
      { category: "produce", search: "leek", itemType: "SUPPLY", includeSoftDeleted: true },
    ];

    for (const opts of combos) {
      const { sql, params } = (listIngredients(ORG, opts) as { toSQL: () => { sql: string; params: unknown[] } }).toSQL();
      expect(sql, `org filter missing for opts=${JSON.stringify(opts)}`).toMatch(/"organisation_id"\s*=\s*\$\d/);
      expect(params).toContain(ORG);
    }
  });
});
