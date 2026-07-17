import { describe, it, expect } from "vitest";
import type { DbOrTx } from "./auditService.js";
import { seedDefaultAreas, DEFAULT_AREA_NAMES } from "./storageAreaService.js";

/**
 * Unit test for the row-shaping in seedDefaultAreas — the part that can silently
 * rot (a typo'd default name, a swapped org/location id, a broken walk order).
 * The DB write itself is covered by the real-DB integration suite / CI.
 */
describe("seedDefaultAreas", () => {
  it("seeds the default areas in walk order, scoped to the location and org", async () => {
    let inserted: Array<Record<string, unknown>> = [];
    // Minimal fake executor: capture what .insert(...).values(rows) receives.
    const fakeTx = {
      insert: () => ({
        values: (rows: Array<Record<string, unknown>>) => {
          inserted = rows;
          return Promise.resolve();
        },
      }),
    } as unknown as DbOrTx;

    await seedDefaultAreas("loc-1", 7, fakeTx);

    expect(inserted.map((r) => r.areaName)).toEqual([...DEFAULT_AREA_NAMES]);
    expect(inserted.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(
      inserted.every((r) => r.storeLocationId === "loc-1" && r.organisationId === 7),
    ).toBe(true);
  });
});
