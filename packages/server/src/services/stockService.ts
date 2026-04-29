/**
 * @module services/stockService
 *
 * Shared stock level operations with optimistic locking.
 * Extracted from transferService to avoid duplicating the retry pattern
 * across transfers, receiving, and consumption.
 */

import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import type { DbOrTx } from "./auditService.js";
import { stockLevel } from "../db/schema.js";

const MAX_RETRIES = 2;

/**
 * Add quantity to a stock level using optimistic locking.
 * Retries up to MAX_RETRIES times on version conflict.
 *
 * Pass `tx` from a surrounding `db.transaction()` to make the read+update
 * atomic with other operations in the same logical event (e.g. receiving).
 */
export async function addStock(
  storeLocationId: string,
  ingredientId: string,
  addQty: number,
  tx: DbOrTx = db,
  retryCount = 0,
): Promise<void> {
  const [current] = await tx
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.storeLocationId, storeLocationId),
        eq(stockLevel.ingredientId, ingredientId),
      ),
    );

  if (!current) {
    // No stock level row yet — create one
    await tx.insert(stockLevel).values({
      storeLocationId,
      ingredientId,
      currentQty: String(addQty),
      version: 0,
    });
    return;
  }

  const currentQty = Number(current.currentQty);
  const newQty = currentQty + addQty;

  const result = await tx
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

  if (result.length === 0 && retryCount < MAX_RETRIES) {
    await addStock(storeLocationId, ingredientId, addQty, tx, retryCount + 1);
  } else if (result.length === 0) {
    throw new Error(
      `Stock level update conflict after ${MAX_RETRIES} retries for ingredient ${ingredientId} at location ${storeLocationId}`,
    );
  }
}

/**
 * Deduct quantity from a stock level using optimistic locking.
 * Retries up to MAX_RETRIES times on version conflict.
 *
 * Pass `tx` from a surrounding `db.transaction()` to make the read+update
 * atomic with other operations in the same logical event.
 */
export async function deductStock(
  storeLocationId: string,
  ingredientId: string,
  deductQty: number,
  tx: DbOrTx = db,
  retryCount = 0,
): Promise<void> {
  const [current] = await tx
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.storeLocationId, storeLocationId),
        eq(stockLevel.ingredientId, ingredientId),
      ),
    );

  if (!current) {
    throw new Error(
      `No stock level found for ingredient ${ingredientId} at location ${storeLocationId}`,
    );
  }

  const currentQty = Number(current.currentQty);
  const newQty = currentQty - deductQty;

  const result = await tx
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

  if (result.length === 0 && retryCount < MAX_RETRIES) {
    await deductStock(storeLocationId, ingredientId, deductQty, tx, retryCount + 1);
  } else if (result.length === 0) {
    throw new Error(
      `Stock level update conflict after ${MAX_RETRIES} retries for ingredient ${ingredientId} at location ${storeLocationId}`,
    );
  }
}
