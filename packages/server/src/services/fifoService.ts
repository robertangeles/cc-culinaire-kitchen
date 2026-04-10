/**
 * @module services/fifoService
 *
 * Shared FIFO batch creation logic.
 * Extracted from purchaseOrderService and transferService to avoid
 * duplicating batch creation across receiving, transfers, and stock adjustments.
 */

import { db } from "../db/index.js";
import { fifoBatch } from "../db/schema.js";

export interface CreateBatchParams {
  storeLocationId: string;
  ingredientId: string;
  quantity: number;
  unitCost?: number | string | null;
  /** PO line that originated this batch */
  sourcePoLineId?: string | null;
  /** Transfer that originated this batch */
  sourceTransferId?: string | null;
  /** Arrival date — defaults to now(). Transfers may pass the original batch date. */
  arrivalDate?: Date;
  /** Expiry date if applicable */
  expiryDate?: Date | null;
}

/**
 * Create a FIFO batch for received goods.
 * Returns the created batch row.
 */
export async function createBatch(params: CreateBatchParams) {
  const {
    storeLocationId,
    ingredientId,
    quantity,
    unitCost,
    sourcePoLineId,
    sourceTransferId,
    arrivalDate = new Date(),
    expiryDate,
  } = params;

  const costValue = unitCost != null ? String(unitCost) : undefined;

  const [batch] = await db
    .insert(fifoBatch)
    .values({
      storeLocationId,
      ingredientId,
      arrivalDate,
      quantityRemaining: String(quantity),
      originalQuantity: String(quantity),
      unitCost: costValue,
      sourcePoLineId: sourcePoLineId ?? undefined,
      sourceTransferId: sourceTransferId ?? undefined,
      expiryDate: expiryDate ?? undefined,
      isDepleted: false,
    })
    .returning();

  return batch;
}
