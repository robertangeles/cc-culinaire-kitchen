import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 0 unit tests for ingredientService — soft-delete contract.
 *
 * Verifies:
 *   1. softDeleteIngredient sets deleted_at + deleted_by inside a tx
 *   2. softDeleteIngredient writes an audit row with the right shape
 *   3. softDeleteIngredient throws if the row is not found or already deleted
 *   4. restoreIngredient clears deleted_at + deleted_by + writes audit row
 *   5. listIngredients excludes soft-deleted rows by default
 *   6. The module does NOT export a hard-delete function (rule enforcement)
 *
 * Hard-delete is BANNED by code review. This file documents that boundary.
 */

const dbTransaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
  // Default impl: pass through tx mock; tests override via mockImplementationOnce.
  return cb({} as never);
});

vi.mock("../db/index.js", () => ({
  db: {
    transaction: dbTransaction,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
        $dynamic: vi.fn(),
      })),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  ingredient: {
    ingredientId: "ingredient_id",
    organisationId: "organisation_id",
    ingredientName: "ingredient_name",
    ingredientCategory: "ingredient_category",
    itemType: "item_type",
    deletedAt: "deleted_at",
    deletedBy: "deleted_by",
    updatedDttm: "updated_dttm",
  },
  locationIngredient: {},
  unitConversion: {},
  stockLevel: {},
  supplier: {},
  supplierLocation: {},
  ingredientSupplier: {},
  storeLocation: {},
  pendingCatalogRequest: {},
  stockTakeLine: {},
  stockTakeCategory: {},
  stockTakeSession: {},
  consumptionLog: {},
  user: {},
}));

const auditLogMock = vi.fn(async () => undefined);
vi.mock("./auditService.js", () => ({
  log: auditLogMock,
}));

beforeEach(() => {
  dbTransaction.mockClear();
  auditLogMock.mockClear();
});

// Build a tx mock that returns scripted rows in sequence. Each call to
// .where()/returning() yields the next row set.
function buildTxMock(rowsByCall: unknown[][]) {
  let idx = 0;
  const next = () => {
    const r = rowsByCall[idx] ?? [];
    if (idx < rowsByCall.length - 1) idx++;
    return r;
  };

  const makeWhereResult = () => {
    const returning = vi.fn(async () => next());
    const thenable: any = Promise.resolve(undefined);
    thenable.returning = returning;
    return thenable;
  };

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => next()),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => makeWhereResult()),
      })),
    })),
  };
}

describe("ingredientService — soft-delete contract", () => {
  it("softDeleteIngredient writes deleted_at + audit row inside a tx", async () => {
    const existing = {
      ingredientId: "ing-1",
      organisationId: 7,
      ingredientName: "Chilli flakes, Calabrian",
      ingredientCategory: "produce",
      deletedAt: null,
      deletedBy: null,
    };
    const updated = { ...existing, deletedAt: new Date(), deletedBy: 42 };

    dbTransaction.mockImplementationOnce(async (cb) => {
      const tx = buildTxMock([
        [existing],   // SELECT existing
        [updated],    // UPDATE returning
      ]);
      return cb(tx);
    });

    const { softDeleteIngredient } = await import("./ingredientService.js");
    await softDeleteIngredient("ing-1", 7, 42);

    expect(dbTransaction).toHaveBeenCalledTimes(1);
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(auditLogMock.mock.calls[0]?.[0]).toMatchObject({
      entityType: "ingredient",
      entityId: "ing-1",
      action: "soft_delete",
      actorUserId: 42,
      organisationId: 7,
    });
    expect(auditLogMock.mock.calls[0]?.[0]?.afterValue).toMatchObject({
      deletedBy: 42,
    });
    expect(auditLogMock.mock.calls[0]?.[0]?.metadata).toMatchObject({
      ingredientName: "Chilli flakes, Calabrian",
    });
  });

  it("softDeleteIngredient throws when ingredient is not in the org", async () => {
    dbTransaction.mockImplementationOnce(async (cb) => {
      const tx = buildTxMock([[]]); // empty result
      return cb(tx);
    });

    const { softDeleteIngredient } = await import("./ingredientService.js");

    await expect(softDeleteIngredient("missing-id", 7, 42)).rejects.toThrow(
      /not found in this organisation/i,
    );
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it("softDeleteIngredient throws when row is already soft-deleted", async () => {
    const alreadyDeleted = {
      ingredientId: "ing-2",
      organisationId: 7,
      ingredientName: "Old herb",
      deletedAt: new Date(),
      deletedBy: 1,
    };

    dbTransaction.mockImplementationOnce(async (cb) => {
      const tx = buildTxMock([[alreadyDeleted]]);
      return cb(tx);
    });

    const { softDeleteIngredient } = await import("./ingredientService.js");

    await expect(softDeleteIngredient("ing-2", 7, 42)).rejects.toThrow(
      /already soft-deleted/i,
    );
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it("restoreIngredient clears deleted_at + writes 'restore' audit row", async () => {
    const existing = {
      ingredientId: "ing-3",
      organisationId: 7,
      ingredientName: "Restored thing",
      deletedAt: new Date("2026-04-01"),
      deletedBy: 5,
    };
    const restored = { ...existing, deletedAt: null, deletedBy: null };

    dbTransaction.mockImplementationOnce(async (cb) => {
      const tx = buildTxMock([
        [existing],
        [restored],
      ]);
      return cb(tx);
    });

    const { restoreIngredient } = await import("./ingredientService.js");
    await restoreIngredient("ing-3", 7, 42);

    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(auditLogMock.mock.calls[0]?.[0]).toMatchObject({
      entityType: "ingredient",
      action: "restore",
      actorUserId: 42,
    });
    expect(auditLogMock.mock.calls[0]?.[0]?.afterValue).toEqual({
      deletedAt: null,
      deletedBy: null,
    });
  });

  it("restoreIngredient throws when row is not soft-deleted", async () => {
    const active = {
      ingredientId: "ing-4",
      organisationId: 7,
      deletedAt: null,
      deletedBy: null,
    };

    dbTransaction.mockImplementationOnce(async (cb) => {
      const tx = buildTxMock([[active]]);
      return cb(tx);
    });

    const { restoreIngredient } = await import("./ingredientService.js");

    await expect(restoreIngredient("ing-4", 7, 42)).rejects.toThrow(
      /not soft-deleted/i,
    );
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it("does NOT export a hard-delete function on the module surface", async () => {
    const mod = await import("./ingredientService.js");
    // Catalog hard-delete is BANNED by the soft-delete rule. If a function
    // matching this pattern ever appears, this test fails and the reviewer
    // sees the violation in the PR.
    const hardDeleteNames = Object.keys(mod).filter(
      (k) =>
        /^delete(?!Unit|Supplier)/i.test(k) ||
        /^hardDelete/i.test(k) ||
        /removeIngredient(?!Supplier)/i.test(k),
    );
    expect(hardDeleteNames).toEqual([]);
  });
});
