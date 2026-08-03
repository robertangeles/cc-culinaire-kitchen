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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- shape reference
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

  // A join chain of any length/order (leftJoin/innerJoin, mixed, any count)
  // before .where() — real Drizzle allows chaining joins freely, and
  // selectLinesWithIngredient() chains innerJoin + multiple leftJoins.
  // Reads the CURRENT row set without advancing callIdx, same as the
  // original single-leftJoin behavior this replaces.
  const makeJoinable = (): any => ({
    where: vi.fn(async () => rowsByCall[callIdx] ?? []),
    leftJoin: vi.fn(() => makeJoinable()),
    innerJoin: vi.fn(() => makeJoinable()),
  });

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => {
        const idx = callIdx;
        callIdx = Math.min(callIdx + 1, rowsByCall.length - 1);
        return rowsByCall[idx] ?? [];
      }),
      leftJoin: vi.fn(() => makeJoinable()),
      innerJoin: vi.fn(() => makeJoinable()),
    })),
  }));

  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => rowsByCall[callIdx] ?? []),
      // wacService.recompute ensures a location_ingredient row exists via
      // INSERT ... ON CONFLICT DO NOTHING before recomputing WAC. It only runs
      // when a receipt actually moved stock, so tests whose lines all arrive at
      // qty 0 never reached it — and the mock silently lacked the method until
      // a test received real quantities.
      onConflictDoNothing: vi.fn(async () => undefined),
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

  // startSession acquires a per-PO pg_advisory_xact_lock before its checks —
  // the mock doesn't model real locking, just needs the call to resolve.
  const execute = vi.fn(async () => [{ pg_advisory_xact_lock: undefined }]);

  return { select, insert, update, delete: del, execute };
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
  locationIngredient: { ingredientId: "ingredient_id", storeLocationId: "store_location_id", parLevel: "par_level" },
  stockLevel: { ingredientId: "ingredient_id", storeLocationId: "store_location_id", currentQty: "current_qty" },
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

// These tests don't exercise unit conversion — stub the resolver as identity
// (base qty = entered qty) so the receiving logic under test is unchanged.
vi.mock("./unitConversionService.js", () => ({
  resolveToBase: vi.fn(async (_id: string, qty: number) => ({ baseQty: qty, baseUnit: "base" })),
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

    // The pre-lock race left POs SENT with a sibling session still ACTIVE
    // (cancelSession resets the PO unconditionally). That combination used to
    // throw "already in progress" with no path to the session at all.
    it("resumes an ACTIVE session on a PO still marked SENT instead of throwing", async () => {
      const po = { poId: "po-1", status: "SENT", organisationId: 7 };
      const orphan = { sessionId: "session-orphan", poId: "po-1", status: "ACTIVE" };
      const lines = [{ receivingLineId: "rl-1", ingredientName: "Belicard" }];

      withTxRows([[po], [orphan], lines]);

      const { startSession } = await import("./receivingService.js");
      const result = await startSession("po-1", "loc-1", 42);

      expect(result.session).toEqual(orphan);
      expect(result.lines).toEqual(lines);
      // Resuming must not mint a second session or log a spurious create.
      expect(auditLogMock).not.toHaveBeenCalled();
    });

    it("rejects a PO in a terminal status when no ACTIVE session exists", async () => {
      const po = { poId: "po-1", status: "RECEIVED", organisationId: 7 };

      withTxRows([[po], []]);

      const { startSession } = await import("./receivingService.js");
      await expect(startSession("po-1", "loc-1", 42)).rejects.toThrow(
        "Cannot start receiving on PO with status RECEIVED",
      );
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
          [po],                 // SELECT po (org guard, now before lines)
          [],                   // SELECT lines (none — empty receipt)
          [rejectedDisc],       // SELECT discrepancies (one rejection)
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
        [po],
        [],
        [rejectedDisc],
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
        [po],
        [],     // no lines
        [],     // no discrepancies — perfect delivery
      ]);

      const { confirmReceipt } = await import("./receivingService.js");
      const result = await confirmReceipt("s-3");

      expect(notifyMock).not.toHaveBeenCalled();
      expect(result.isPerfectDelivery).toBe(true);
    });

    // Regression: ISSUE-001 — a price-change-only receipt was labelled "Partial"
    // Found by /qa on 2026-08-02
    // Report: .gstack/qa-reports/qa-report-localhost-2026-08-02.md
    //
    // PARTIAL_RECEIVED means goods are MISSING. The status was derived from
    // "any discrepancy exists", so a PRICE_VARIANCE on a delivery that turned up
    // complete flipped the order to Partial — telling the buyer to chase a
    // supplier for stock already on the shelf. Quantity is the source of truth.
    it("stays RECEIVED when the only discrepancy is a price change (full qty arrived)", async () => {
      const session = { sessionId: "s-5", poId: "po-5", status: "ACTIVE", storeLocationId: "loc-1", receivedByUserId: 42, completedAt: null };
      const po = { poId: "po-5", organisationId: 7, supplierId: "sup-1", poNumber: "PO-105" };
      const line = {
        receivingLineId: "rl-5", poLineId: "pl-5", ingredientId: "ing-5",
        orderedQty: "2", receivedQty: "2", orderedUnit: "bag",
        actualUnitCost: "21.00", status: "PRICE_VARIANCE",
      };
      const priceDisc = { receivingLineId: "rl-5", sessionId: "s-5", type: "PRICE_VARIANCE" };

      withTxRows([[session], [po], [line], [priceDisc]]);

      const { confirmReceipt } = await import("./receivingService.js");
      const result = await confirmReceipt("s-5", 7);

      expect(result.poStatus).toBe("RECEIVED");
      // Still a discrepancy worth reporting — it just is not a partial receipt.
      expect(result.discrepancyCount).toBe(1);
      expect(result.isPerfectDelivery).toBe(false);
    });

    it("is PARTIAL_RECEIVED when less arrived than was ordered", async () => {
      const session = { sessionId: "s-6", poId: "po-6", status: "ACTIVE", storeLocationId: "loc-1", receivedByUserId: 42, completedAt: null };
      const po = { poId: "po-6", organisationId: 7, supplierId: "sup-1", poNumber: "PO-106" };
      const line = {
        receivingLineId: "rl-6", poLineId: "pl-6", ingredientId: "ing-6",
        orderedQty: "3", receivedQty: "2", orderedUnit: "kg",
        actualUnitCost: "12.00", status: "SHORT",
      };
      const shortDisc = { receivingLineId: "rl-6", sessionId: "s-6", type: "SHORT" };

      withTxRows([[session], [po], [line], [shortDisc]]);

      const { confirmReceipt } = await import("./receivingService.js");
      const result = await confirmReceipt("s-6", 7);

      expect(result.poStatus).toBe("PARTIAL_RECEIVED");
    });

    it("is PARTIAL_RECEIVED when a line was rejected outright", async () => {
      const session = { sessionId: "s-7", poId: "po-7", status: "ACTIVE", storeLocationId: "loc-1", receivedByUserId: 42, completedAt: null };
      const po = { poId: "po-7", organisationId: 7, supplierId: "sup-1", poNumber: "PO-107" };
      const line = {
        receivingLineId: "rl-7", poLineId: "pl-7", ingredientId: "ing-7",
        orderedQty: "5", receivedQty: "0", orderedUnit: "kg",
        actualUnitCost: "12.00", status: "REJECTED",
      };
      const rejDisc = { receivingLineId: "rl-7", sessionId: "s-7", type: "REJECTED" };

      withTxRows([[session], [po], [line], [rejDisc]]);

      const { confirmReceipt } = await import("./receivingService.js");
      const result = await confirmReceipt("s-7", 7);

      expect(result.poStatus).toBe("PARTIAL_RECEIVED");
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
        [po],            // org guard now runs before the line/poLine fetch
        [line],
        [poLine],
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
