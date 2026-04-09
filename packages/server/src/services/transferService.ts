/**
 * @module services/transferService
 *
 * Inter-location stock transfer workflow:
 *   INITIATED → SENT → RECEIVED | DISCREPANCY
 *   INITIATED → CANCELLED
 *
 * Stock deducted from source on SENT, added to destination on RECEIVED.
 * FIFO batches created at destination with original arrival date.
 */

import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  inventoryTransfer,
  inventoryTransferLine,
  stockLevel,
  ingredient,
  storeLocation,
  user,
  fifoBatch,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransferLineInput {
  ingredientId: string;
  sentQty: number;
  sentUnit: string;
  fifoBatchId?: string;
}

interface ReceivedLineInput {
  lineId: string;
  receivedQty: number;
}

interface ListOpts {
  status?: string;
  storeLocationId?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Stock helpers (mirrors consumptionLogService pattern)
// ---------------------------------------------------------------------------

async function deductStockLevel(
  storeLocationId: string,
  ingredientId: string,
  deductQty: number,
  retryCount = 0,
): Promise<void> {
  const existing = await db
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.storeLocationId, storeLocationId),
        eq(stockLevel.ingredientId, ingredientId),
      ),
    );

  if (existing.length === 0) {
    await db.insert(stockLevel).values({
      storeLocationId,
      ingredientId,
      currentQty: String(-deductQty),
      version: 0,
    });
    return;
  }

  const current = existing[0];
  const newQty = Number(current.currentQty) - deductQty;
  const result = await db
    .update(stockLevel)
    .set({
      currentQty: String(newQty),
      version: current.version + 1,
      updatedDttm: new Date(),
    })
    .where(
      and(
        eq(stockLevel.stockLevelId, current.stockLevelId),
        eq(stockLevel.version, current.version),
      ),
    )
    .returning();

  if (result.length === 0 && retryCount < 2) {
    await deductStockLevel(storeLocationId, ingredientId, deductQty, retryCount + 1);
  }
}

async function addStockLevel(
  storeLocationId: string,
  ingredientId: string,
  addQty: number,
  retryCount = 0,
): Promise<void> {
  const existing = await db
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.storeLocationId, storeLocationId),
        eq(stockLevel.ingredientId, ingredientId),
      ),
    );

  if (existing.length === 0) {
    await db.insert(stockLevel).values({
      storeLocationId,
      ingredientId,
      currentQty: String(addQty),
      version: 0,
    });
    return;
  }

  const current = existing[0];
  const newQty = Number(current.currentQty) + addQty;
  const result = await db
    .update(stockLevel)
    .set({
      currentQty: String(newQty),
      version: current.version + 1,
      updatedDttm: new Date(),
    })
    .where(
      and(
        eq(stockLevel.stockLevelId, current.stockLevelId),
        eq(stockLevel.version, current.version),
      ),
    )
    .returning();

  if (result.length === 0 && retryCount < 2) {
    await addStockLevel(storeLocationId, ingredientId, addQty, retryCount + 1);
  }
}

// ---------------------------------------------------------------------------
// 1. initiateTransfer
// ---------------------------------------------------------------------------

export async function initiateTransfer(
  orgId: number,
  fromLocId: string,
  toLocId: string,
  userId: number,
  lines: TransferLineInput[],
  notes?: string,
) {
  if (fromLocId === toLocId) {
    throw new Error("Source and destination locations must be different");
  }
  if (!lines.length) {
    throw new Error("At least one line item is required");
  }

  // Validate all ingredients belong to org
  const ingredientIds = lines.map((l) => l.ingredientId);
  const ingredients = await db
    .select({ id: ingredient.ingredientId })
    .from(ingredient)
    .where(
      and(
        inArray(ingredient.ingredientId, ingredientIds),
        eq(ingredient.organisationId, orgId),
      ),
    );

  if (ingredients.length !== new Set(ingredientIds).size) {
    throw new Error("One or more ingredients not found in this organisation");
  }

  const [transfer] = await db
    .insert(inventoryTransfer)
    .values({
      organisationId: orgId,
      fromLocationId: fromLocId,
      toLocationId: toLocId,
      status: "INITIATED",
      initiatedByUserId: userId,
      notes: notes ?? null,
    })
    .returning();

  const lineRows = await Promise.all(
    lines.map((line) =>
      db
        .insert(inventoryTransferLine)
        .values({
          transferId: transfer.transferId,
          ingredientId: line.ingredientId,
          sentQty: String(line.sentQty),
          sentUnit: line.sentUnit,
          fifoBatchId: line.fifoBatchId ?? null,
          lineStatus: "PENDING",
        })
        .returning()
        .then((r) => r[0]),
    ),
  );

  return { ...transfer, lines: lineRows };
}

// ---------------------------------------------------------------------------
// 2. confirmSent
// ---------------------------------------------------------------------------

export async function confirmSent(
  transferId: string,
  orgId: number,
  userId: number,
) {
  const [transfer] = await db
    .select()
    .from(inventoryTransfer)
    .where(
      and(
        eq(inventoryTransfer.transferId, transferId),
        eq(inventoryTransfer.organisationId, orgId),
      ),
    );

  if (!transfer) throw new Error("Transfer not found");
  if (transfer.status !== "INITIATED") {
    throw new Error(`Cannot send a transfer with status ${transfer.status}`);
  }

  // Get lines
  const lines = await db
    .select()
    .from(inventoryTransferLine)
    .where(eq(inventoryTransferLine.transferId, transferId));

  // Deduct stock from source location
  for (const line of lines) {
    await deductStockLevel(
      transfer.fromLocationId,
      line.ingredientId,
      Number(line.sentQty),
    );
  }

  // Update transfer status
  const [updated] = await db
    .update(inventoryTransfer)
    .set({
      status: "SENT",
      sentByUserId: userId,
      sentDttm: new Date(),
      updatedDttm: new Date(),
    })
    .where(eq(inventoryTransfer.transferId, transferId))
    .returning();

  return updated;
}

// ---------------------------------------------------------------------------
// 3. confirmReceived
// ---------------------------------------------------------------------------

export async function confirmReceived(
  transferId: string,
  orgId: number,
  userId: number,
  receivedLines: ReceivedLineInput[],
) {
  const [transfer] = await db
    .select()
    .from(inventoryTransfer)
    .where(
      and(
        eq(inventoryTransfer.transferId, transferId),
        eq(inventoryTransfer.organisationId, orgId),
      ),
    );

  if (!transfer) throw new Error("Transfer not found");
  if (transfer.status !== "SENT") {
    throw new Error(`Cannot receive a transfer with status ${transfer.status}`);
  }

  const lines = await db
    .select()
    .from(inventoryTransferLine)
    .where(eq(inventoryTransferLine.transferId, transferId));

  const receivedMap = new Map(receivedLines.map((r) => [r.lineId, r.receivedQty]));
  let hasDiscrepancy = false;

  for (const line of lines) {
    const receivedQty = receivedMap.get(line.lineId) ?? Number(line.sentQty);
    const sentQty = Number(line.sentQty);

    if (Math.abs(receivedQty - sentQty) > 0.001) {
      hasDiscrepancy = true;
    }

    // Add stock at destination
    await addStockLevel(transfer.toLocationId, line.ingredientId, receivedQty);

    // Create FIFO batch at destination
    // Look up source batch for arrival date if exists
    let arrivalDate = new Date();
    if (line.fifoBatchId) {
      const [srcBatch] = await db
        .select()
        .from(fifoBatch)
        .where(eq(fifoBatch.batchId, line.fifoBatchId));
      if (srcBatch) {
        arrivalDate = srcBatch.arrivalDate;
      }
    }

    await db.insert(fifoBatch).values({
      storeLocationId: transfer.toLocationId,
      ingredientId: line.ingredientId,
      arrivalDate,
      quantityRemaining: String(receivedQty),
      originalQuantity: String(receivedQty),
      sourceTransferId: transferId,
    });

    // Update the line
    const lineStatus = Math.abs(receivedQty - sentQty) > 0.001 ? "DISCREPANCY" : "RECEIVED";
    await db
      .update(inventoryTransferLine)
      .set({
        receivedQty: String(receivedQty),
        lineStatus,
        updatedDttm: new Date(),
      })
      .where(eq(inventoryTransferLine.lineId, line.lineId));
  }

  const finalStatus = hasDiscrepancy ? "DISCREPANCY" : "RECEIVED";
  const [updated] = await db
    .update(inventoryTransfer)
    .set({
      status: finalStatus,
      receivedByUserId: userId,
      receivedDttm: new Date(),
      updatedDttm: new Date(),
    })
    .where(eq(inventoryTransfer.transferId, transferId))
    .returning();

  return updated;
}

// ---------------------------------------------------------------------------
// 4. cancelTransfer
// ---------------------------------------------------------------------------

export async function cancelTransfer(
  transferId: string,
  orgId: number,
  _userId: number,
) {
  const [transfer] = await db
    .select()
    .from(inventoryTransfer)
    .where(
      and(
        eq(inventoryTransfer.transferId, transferId),
        eq(inventoryTransfer.organisationId, orgId),
      ),
    );

  if (!transfer) throw new Error("Transfer not found");
  if (transfer.status !== "INITIATED") {
    throw new Error("Only INITIATED transfers can be cancelled");
  }

  const [updated] = await db
    .update(inventoryTransfer)
    .set({
      status: "CANCELLED",
      updatedDttm: new Date(),
    })
    .where(eq(inventoryTransfer.transferId, transferId))
    .returning();

  // Mark lines cancelled
  await db
    .update(inventoryTransferLine)
    .set({ lineStatus: "CANCELLED", updatedDttm: new Date() })
    .where(eq(inventoryTransferLine.transferId, transferId));

  return updated;
}

// ---------------------------------------------------------------------------
// 5. listTransfers
// ---------------------------------------------------------------------------

export async function listTransfers(orgId: number, opts?: ListOpts) {
  const fromLoc = db
    .select({
      storeLocationId: storeLocation.storeLocationId,
      locationName: storeLocation.locationName,
    })
    .from(storeLocation)
    .as("from_loc");

  const toLoc = db
    .select({
      storeLocationId: storeLocation.storeLocationId,
      locationName: storeLocation.locationName,
    })
    .from(storeLocation)
    .as("to_loc");

  const conditions = [eq(inventoryTransfer.organisationId, orgId)];

  if (opts?.status) {
    conditions.push(eq(inventoryTransfer.status, opts.status));
  }
  if (opts?.storeLocationId) {
    conditions.push(
      sql`(${inventoryTransfer.fromLocationId} = ${opts.storeLocationId} OR ${inventoryTransfer.toLocationId} = ${opts.storeLocationId})`,
    );
  }

  const rows = await db
    .select({
      transferId: inventoryTransfer.transferId,
      organisationId: inventoryTransfer.organisationId,
      fromLocationId: inventoryTransfer.fromLocationId,
      toLocationId: inventoryTransfer.toLocationId,
      status: inventoryTransfer.status,
      notes: inventoryTransfer.notes,
      sentDttm: inventoryTransfer.sentDttm,
      receivedDttm: inventoryTransfer.receivedDttm,
      createdDttm: inventoryTransfer.createdDttm,
      fromLocationName: fromLoc.locationName,
      toLocationName: toLoc.locationName,
      initiatorName: user.userName,
      lineCount: sql<number>`(SELECT count(*) FROM inventory_transfer_line WHERE transfer_id = ${inventoryTransfer.transferId})::int`,
    })
    .from(inventoryTransfer)
    .leftJoin(fromLoc, eq(inventoryTransfer.fromLocationId, fromLoc.storeLocationId))
    .leftJoin(toLoc, eq(inventoryTransfer.toLocationId, toLoc.storeLocationId))
    .leftJoin(user, eq(inventoryTransfer.initiatedByUserId, user.userId))
    .where(and(...conditions))
    .orderBy(desc(inventoryTransfer.createdDttm))
    .limit(opts?.limit ?? 50);

  return rows;
}

// ---------------------------------------------------------------------------
// 6. getTransferDetail
// ---------------------------------------------------------------------------

export async function getTransferDetail(transferId: string, orgId: number) {
  const fromLoc = db
    .select({
      storeLocationId: storeLocation.storeLocationId,
      locationName: storeLocation.locationName,
    })
    .from(storeLocation)
    .as("from_loc");

  const toLoc = db
    .select({
      storeLocationId: storeLocation.storeLocationId,
      locationName: storeLocation.locationName,
    })
    .from(storeLocation)
    .as("to_loc");

  const [transfer] = await db
    .select({
      transferId: inventoryTransfer.transferId,
      organisationId: inventoryTransfer.organisationId,
      fromLocationId: inventoryTransfer.fromLocationId,
      toLocationId: inventoryTransfer.toLocationId,
      status: inventoryTransfer.status,
      notes: inventoryTransfer.notes,
      sentDttm: inventoryTransfer.sentDttm,
      receivedDttm: inventoryTransfer.receivedDttm,
      createdDttm: inventoryTransfer.createdDttm,
      updatedDttm: inventoryTransfer.updatedDttm,
      initiatedByUserId: inventoryTransfer.initiatedByUserId,
      sentByUserId: inventoryTransfer.sentByUserId,
      receivedByUserId: inventoryTransfer.receivedByUserId,
      fromLocationName: fromLoc.locationName,
      toLocationName: toLoc.locationName,
    })
    .from(inventoryTransfer)
    .leftJoin(fromLoc, eq(inventoryTransfer.fromLocationId, fromLoc.storeLocationId))
    .leftJoin(toLoc, eq(inventoryTransfer.toLocationId, toLoc.storeLocationId))
    .where(
      and(
        eq(inventoryTransfer.transferId, transferId),
        eq(inventoryTransfer.organisationId, orgId),
      ),
    );

  if (!transfer) return null;

  const lines = await db
    .select({
      lineId: inventoryTransferLine.lineId,
      ingredientId: inventoryTransferLine.ingredientId,
      sentQty: inventoryTransferLine.sentQty,
      sentUnit: inventoryTransferLine.sentUnit,
      receivedQty: inventoryTransferLine.receivedQty,
      lineStatus: inventoryTransferLine.lineStatus,
      fifoBatchId: inventoryTransferLine.fifoBatchId,
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
      baseUnit: ingredient.baseUnit,
    })
    .from(inventoryTransferLine)
    .leftJoin(ingredient, eq(inventoryTransferLine.ingredientId, ingredient.ingredientId))
    .where(eq(inventoryTransferLine.transferId, transferId));

  return { ...transfer, lines };
}

// ---------------------------------------------------------------------------
// 7. listPendingTransfers
// ---------------------------------------------------------------------------

export async function listPendingTransfers(locationId: string) {
  const fromLoc = db
    .select({
      storeLocationId: storeLocation.storeLocationId,
      locationName: storeLocation.locationName,
    })
    .from(storeLocation)
    .as("from_loc");

  const rows = await db
    .select({
      transferId: inventoryTransfer.transferId,
      fromLocationId: inventoryTransfer.fromLocationId,
      toLocationId: inventoryTransfer.toLocationId,
      status: inventoryTransfer.status,
      notes: inventoryTransfer.notes,
      sentDttm: inventoryTransfer.sentDttm,
      createdDttm: inventoryTransfer.createdDttm,
      fromLocationName: fromLoc.locationName,
      initiatorName: user.userName,
      lineCount: sql<number>`(SELECT count(*) FROM inventory_transfer_line WHERE transfer_id = ${inventoryTransfer.transferId})::int`,
    })
    .from(inventoryTransfer)
    .leftJoin(fromLoc, eq(inventoryTransfer.fromLocationId, fromLoc.storeLocationId))
    .leftJoin(user, eq(inventoryTransfer.initiatedByUserId, user.userId))
    .where(
      and(
        eq(inventoryTransfer.toLocationId, locationId),
        eq(inventoryTransfer.status, "SENT"),
      ),
    )
    .orderBy(desc(inventoryTransfer.sentDttm));

  return rows;
}

// ---------------------------------------------------------------------------
// 8. updateTransfer — replace lines + notes on an INITIATED transfer
// ---------------------------------------------------------------------------

export async function updateTransfer(
  transferId: string,
  orgId: number,
  data: {
    lines: Array<{ ingredientId: string; sentQty: number; sentUnit: string }>;
    notes?: string;
  },
) {
  const [transfer] = await db
    .select()
    .from(inventoryTransfer)
    .where(
      and(
        eq(inventoryTransfer.transferId, transferId),
        eq(inventoryTransfer.organisationId, orgId),
      ),
    );

  if (!transfer) throw new Error("not found");
  if (transfer.status !== "INITIATED") throw new Error("Transfer is no longer editable");

  // Delete existing lines and replace with new ones
  await db
    .delete(inventoryTransferLine)
    .where(eq(inventoryTransferLine.transferId, transferId));

  for (const line of data.lines) {
    await db
      .insert(inventoryTransferLine)
      .values({
        transferId,
        ingredientId: line.ingredientId,
        sentQty: String(line.sentQty),
        sentUnit: line.sentUnit,
        lineStatus: "PENDING",
      });
  }

  // Update notes
  await db
    .update(inventoryTransfer)
    .set({
      notes: data.notes ?? null,
      updatedDttm: new Date(),
    })
    .where(eq(inventoryTransfer.transferId, transferId));

  return { updated: true, lineCount: data.lines.length };
}

// ---------------------------------------------------------------------------
// 9. addLinesToTransfer — add items to an INITIATED transfer
// ---------------------------------------------------------------------------

export async function addLinesToTransfer(
  transferId: string,
  orgId: number,
  lines: Array<{ ingredientId: string; sentQty: number; sentUnit: string }>,
) {
  const [transfer] = await db
    .select()
    .from(inventoryTransfer)
    .where(
      and(
        eq(inventoryTransfer.transferId, transferId),
        eq(inventoryTransfer.organisationId, orgId),
      ),
    );

  if (!transfer) throw new Error("not found");
  if (transfer.status !== "INITIATED") throw new Error("Transfer is no longer editable");

  // Duplicate check — reject items already in this transfer
  const existingLines = await db
    .select({ ingredientId: inventoryTransferLine.ingredientId })
    .from(inventoryTransferLine)
    .where(eq(inventoryTransferLine.transferId, transferId));
  const existingIds = new Set(existingLines.map((l) => l.ingredientId));
  const duplicates = lines.filter((l) => existingIds.has(l.ingredientId));
  if (duplicates.length > 0) {
    throw new Error("Item already exists in this transfer");
  }

  for (const line of lines) {
    await db
      .insert(inventoryTransferLine)
      .values({
        transferId,
        ingredientId: line.ingredientId,
        sentQty: String(line.sentQty),
        sentUnit: line.sentUnit,
        lineStatus: "PENDING",
      });
  }

  return { added: lines.length };
}
