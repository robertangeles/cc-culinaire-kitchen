import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for receivingService — Phase 0 of the catalog-spine initiative.
 *
 * These verify the new transaction + audit + post-commit-notification design:
 *   1. Every public method wraps writes in db.transaction()
 *   2. auditService.log is called inside the tx with the correct shape
 *   3. notifyHQAdmins is called AFTER the tx commits (not inside it)
 *   4. notification failures do NOT roll back the receipt
 *
 * Full integration tests (real DB, real FIFO batches, real stock) are deferred
 * to a follow-up — they need a test DB harness this repo doesn't have yet.
 */

// ── Shared mock state ─────────────────────────────────────────────────

interface FluentMock {
  calls: unknown[][];
  rows: unknown[];
}

const txHistory: { wasCalled: boolean; callbackResult: unknown } = {
  wasCalled: false,
  callbackResult: undefined,
};

// We need a chainable mock that simulates Drizzle's tx — every chain returns
// a thenable that yields rows[0..n]. Each call records its args for assertions.
function makeQueryMock(rowsByCall: unknown[][] = [[]]) {
  let callIdx = 0;
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => {
        const idx = callIdx;
        callIdx = Math.min(callIdx + 1, rowsByCall.length - 1);
        return rowsByCall[idx] ?? [];
      }),
      leftJoin: vi.fn(() => ({
        where: vi.fn(async () => rowsByCall[callIdx] ?? []),
      })),
    })),
  }));

  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => rowsByCall[callIdx] ?? []),
    })),
  }));

  // .where() returns a thenable so callers can either `await it` (resolves
  // to undefined) or chain `.returning()` after it for the rows.
  const makeWhereResult = () => {
    const returning = vi.fn(async () => rowsByCall[callIdx] ?? []);
    const thenable: any = Promise.resolve(undefined);
    thenable.returning = returning;
    return thenable;
  };
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => makeWhereResult()),
    })),
  }));

  const del = vi.fn(() => ({
    where: vi.fn(async () => undefined),
  }));

  return { select, insert, update, delete: del };
}

const dbTransaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
  txHistory.wasCalled = true;
  // Build a tx mock that returns the rows the test scenario configured.
  const tx = makeQueryMock([
    // sequential row sets — extended per test below
  ]);
  const result = await cb(tx);
  txHistory.callbackResult = result;
  return result;
});

// ── Module mocks ──────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    transaction: dbTransaction,
    // Outside-tx select used in some paths — return empty by default.
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  receivingSession: { sessionId: "session_id", poId: "po_id", status: "status", receivedByUserId: "received_by_user_id", storeLocationId: "store_location_id", completedAt: "completed_at" },
  receivingLine: { receivingLineId: "receiving_line_id", sessionId: "session_id", poLineId: "po_line_id", ingredientId: "ingredient_id", orderedQty: "ordered_qty", receivedQty: "received_qty", actualUnitCost: "actual_unit_cost", status: "status" },
  receivingDiscrepancy: { discrepancyId: "discrepancy_id", receivingLineId: "receiving_line_id", sessionId: "session_id" },
  discrepancyPhoto: {},
  purchaseOrder: { poId: "po_id", status: "status", organisationId: "organisation_id", supplierId: "supplier_id", poNumber: "po_number" },
  purchaseOrderLine: { lineId: "line_id", ingredientId: "ingredient_id", orderedQty: "ordered_qty", orderedUnit: "ordered_unit", unitCost: "unit_cost", poId: "po_id" },
  ingredient: { ingredientId: "ingredient_id", ingredientName: "ingredient_name", ingredientCategory: "ingredient_category", baseUnit: "base_unit" },
  supplier: {},
}));

const auditLogMock = vi.fn(async () => undefined);
vi.mock("./auditService.js", () => ({
  log: auditLogMock,
}));

const fifoCreateBatchMock = vi.fn(async () => ({ batchId: "batch-1" }));
vi.mock("./fifoService.js", () => ({
  createBatch: fifoCreateBatchMock,
}));

const addStockMock = vi.fn(async () => undefined);
vi.mock("./stockService.js", () => ({
  addStock: addStockMock,
}));

const notifyMock = vi.fn(async () => undefined);
vi.mock("./notificationService.js", () => ({
  notifyHQAdmins: notifyMock,
}));

vi.mock("../utils/stateTransition.js", () => ({
  validateTransition: vi.fn(),
  RECEIVING_SESSION_TRANSITIONS: {},
}));

// ── Helpers ───────────────────────────────────────────────────────────

beforeEach(() => {
  txHistory.wasCalled = false;
  txHistory.callbackResult = undefined;
  dbTransaction.mockClear();
  auditLogMock.mockClear();
  fifoCreateBatchMock.mockClear();
  addStockMock.mockClear();
  notifyMock.mockClear();
});

// Set up dbTransaction to feed scripted rows to the tx mock.
function withTxRows(rowsByCall: unknown[][]) {
  dbTransaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => {
    txHistory.wasCalled = true;
    const tx = makeQueryMock(rowsByCall);
    const result = await cb(tx);
    txHistory.callbackResult = result;
    return result;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("receivingService — transaction + audit invariants", () => {
  describe("startSession", () => {
    it("wraps writes in db.transaction and writes a 'create' audit row", async () => {
      const po = { poId: "po-1", status: "SENT", organisationId: 7 };
      const session = { sessionId: "session-1", poId: "po-1", storeLocationId: "loc-1", receivedByUserId: 42, status: "ACTIVE" };

      withTxRows([
        [po],         // SELECT purchaseOrder
        [],           // SELECT existing session (none)
        [session],    // INSERT session returning
        [],           // SELECT po lines (no lines)
      ]);

      const { startSession } = await import("./receivingService.js");
      await startSession("po-1", "loc-1", 42);

      expect(dbTransaction).toHaveBeenCalledTimes(1);
      expect(auditLogMock).toHaveBeenCalledTimes(1);

      const [auditCall] = auditLogMock.mock.calls;
      expect(auditCall[0]).toMatchObject({
        entityType: "receiving_session",
        action: "create",
        actorUserId: 42,
        organisationId: 7,
      });
    });
  });

  describe("cancelSession", () => {
    it("wraps cancel in db.transaction and writes a 'cancel' audit row", async () => {
      const session = { sessionId: "session-1", poId: "po-1", status: "ACTIVE", receivedByUserId: 42 };
      const po = { poId: "po-1", organisationId: 7 };

      withTxRows([
        [session],   // SELECT session
        [po],        // SELECT po (for org scoping)
      ]);

      const { cancelSession } = await import("./receivingService.js");
      await cancelSession("session-1");

      expect(dbTransaction).toHaveBeenCalledTimes(1);
      expect(auditLogMock).toHaveBeenCalledTimes(1);

      const [auditCall] = auditLogMock.mock.calls;
      expect(auditCall[0]).toMatchObject({
        entityType: "receiving_session",
        entityId: "session-1",
        action: "cancel",
        actorUserId: 42,
        organisationId: 7,
      });
    });
  });

  describe("confirmReceipt", () => {
    it("calls notifyHQAdmins AFTER the transaction commits, not inside it", async () => {
      // Track call order: tx ends, THEN notify fires.
      const callOrder: string[] = [];

      const session = { sessionId: "s-1", poId: "po-1", status: "ACTIVE", storeLocationId: "loc-1", receivedByUserId: 42, completedAt: null };
      const po = { poId: "po-1", organisationId: 7, supplierId: "sup-1", poNumber: "PO-100" };
      const rejectedDisc = {
        receivingLineId: "rl-1",
        sessionId: "s-1",
        type: "REJECTED",
      };

      dbTransaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => {
        callOrder.push("tx-start");
        const tx = makeQueryMock([
          [session],            // SELECT session
          [],                   // SELECT lines (none — empty receipt)
          [rejectedDisc],       // SELECT discrepancies (one rejection)
          [po],                 // SELECT po
        ]);
        const result = await cb(tx);
        callOrder.push("tx-end");
        return result;
      });

      notifyMock.mockImplementationOnce(async () => {
        callOrder.push("notify");
      });

      const { confirmReceipt } = await import("./receivingService.js");
      const result = await confirmReceipt("s-1");

      // Ordering invariant: notify after tx commits.
      expect(callOrder).toEqual(["tx-start", "tx-end", "notify"]);

      // Audit row written for the completion.
      expect(auditLogMock).toHaveBeenCalledTimes(1);
      expect(auditLogMock.mock.calls[0]?.[0]).toMatchObject({
        entityType: "receiving_session",
        entityId: "s-1",
        action: "complete",
        actorUserId: 42,
        organisationId: 7,
      });

      // Result shape preserved for callers.
      expect(result).toMatchObject({
        sessionId: "s-1",
        poId: "po-1",
        discrepancyCount: 1,
        isPerfectDelivery: false,
      });
    });

    it("does NOT roll back the receipt when notifyHQAdmins throws", async () => {
      const session = { sessionId: "s-2", poId: "po-2", status: "ACTIVE", storeLocationId: "loc-1", receivedByUserId: 42, completedAt: null };
      const po = { poId: "po-2", organisationId: 7, supplierId: "sup-1", poNumber: "PO-200" };
      const rejectedDisc = { receivingLineId: "rl-2", sessionId: "s-2", type: "REJECTED" };

      withTxRows([
        [session],
        [],
        [rejectedDisc],
        [po],
      ]);

      notifyMock.mockRejectedValueOnce(new Error("smtp dead"));

      const { confirmReceipt } = await import("./receivingService.js");

      // Should NOT throw — receipt is committed; notification is best-effort.
      await expect(confirmReceipt("s-2")).resolves.toMatchObject({
        sessionId: "s-2",
        discrepancyCount: 1,
      });

      // Audit was still written inside the tx.
      expect(auditLogMock).toHaveBeenCalledTimes(1);
    });

    it("does NOT call notifyHQAdmins when there are no significant discrepancies", async () => {
      const session = { sessionId: "s-3", poId: "po-3", status: "ACTIVE", storeLocationId: "loc-1", receivedByUserId: 42, completedAt: null };
      const po = { poId: "po-3", organisationId: 7, supplierId: "sup-1", poNumber: "PO-300" };

      withTxRows([
        [session],
        [],     // no lines
        [],     // no discrepancies — perfect delivery
        [po],
      ]);

      const { confirmReceipt } = await import("./receivingService.js");
      const result = await confirmReceipt("s-3");

      expect(notifyMock).not.toHaveBeenCalled();
      expect(result.isPerfectDelivery).toBe(true);
    });
  });

  describe("actionLine", () => {
    it("wraps line updates in db.transaction and writes an 'update' audit row", async () => {
      const session = { sessionId: "s-4", status: "ACTIVE", poId: "po-4", receivedByUserId: 42 };
      const line = { receivingLineId: "rl-4", sessionId: "s-4", status: "RECEIVED", receivedQty: "10", actualUnitCost: "5.00", poLineId: "pl-4", orderedQty: "10", ingredientId: "ing-4" };
      const poLine = { lineId: "pl-4", unitCost: "5.00" };
      const po = { poId: "po-4", organisationId: 7, supplierId: "sup-1" };
      const updatedLine = { ...line, status: "REJECTED", receivedQty: "0" };
      const inserted = { discrepancyId: "d-1" };

      withTxRows([
        [session],
        [line],
        [poLine],
        [po],
        [updatedLine],   // UPDATE returning
        [inserted],      // INSERT discrepancy returning
      ]);

      const { actionLine } = await import("./receivingService.js");
      await actionLine("rl-4", "s-4", {
        status: "REJECTED",
        rejectionReason: "damaged",
      });

      expect(dbTransaction).toHaveBeenCalledTimes(1);
      expect(auditLogMock).toHaveBeenCalledTimes(1);
      expect(auditLogMock.mock.calls[0]?.[0]).toMatchObject({
        entityType: "receiving_line",
        entityId: "rl-4",
        action: "update",
        actorUserId: 42,
        organisationId: 7,
      });
    });
  });
});
