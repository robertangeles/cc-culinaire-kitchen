/**
 * @module services/thresholdService
 *
 * Spend threshold logic for purchase order approval routing.
 * Below threshold → PO sent directly to supplier.
 * Above threshold → PO routed to HQ for approval.
 *
 * Resolution order: location override → org default → null (no threshold, always direct).
 */

import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  spendThreshold,
  organisation,
  purchaseOrder,
  purchaseOrderLine,
  ingredientSupplier,
  ingredient,
} from "../db/schema.js";
import pino from "pino";

const logger = pino({ name: "thresholdService" });

export type ThresholdRouting = "DIRECT" | "HQ_APPROVAL";

export interface ThresholdResult {
  routing: ThresholdRouting;
  totalValue: number;
  thresholdAmount: number | null;
}

/**
 * Get the effective spend threshold for a location.
 * Checks location-specific override first, then org default.
 * Returns null if no threshold is configured (all POs go direct).
 */
async function getThreshold(
  orgId: number,
  locationId: string,
): Promise<number | null> {
  // Check location-specific override
  const [locationOverride] = await db
    .select()
    .from(spendThreshold)
    .where(
      and(
        eq(spendThreshold.organisationId, orgId),
        eq(spendThreshold.storeLocationId, locationId),
      ),
    );

  if (locationOverride) {
    return Number(locationOverride.thresholdAmount);
  }

  // Fall back to org default
  const [org] = await db
    .select({ defaultSpendThreshold: organisation.defaultSpendThreshold })
    .from(organisation)
    .where(eq(organisation.organisationId, orgId));

  if (org?.defaultSpendThreshold) {
    return Number(org.defaultSpendThreshold);
  }

  return null;
}

/**
 * Calculate PO total value SERVER-SIDE from DB prices.
 * Never trust client-submitted values for threshold calculation.
 */
async function calculatePOTotal(poId: string): Promise<number> {
  const lines = await db
    .select({
      orderedQty: purchaseOrderLine.orderedQty,
      unitCost: purchaseOrderLine.unitCost,
      ingredientId: purchaseOrderLine.ingredientId,
    })
    .from(purchaseOrderLine)
    .where(eq(purchaseOrderLine.poId, poId));

  let total = 0;
  for (const line of lines) {
    // Use PO line unit cost if available, otherwise fall back to ingredient cost
    const cost = line.unitCost ? Number(line.unitCost) : 0;
    const qty = Number(line.orderedQty);
    total += qty * cost;
  }

  return Math.round(total * 100) / 100; // round to 2 decimal places
}

/**
 * Determine the approval routing for a PO based on its total value
 * and the effective spend threshold.
 */
export async function determineRouting(
  poId: string,
  orgId: number,
  locationId: string,
): Promise<ThresholdResult> {
  const totalValue = await calculatePOTotal(poId);
  const thresholdAmount = await getThreshold(orgId, locationId);

  // No threshold configured → always direct
  if (thresholdAmount === null) {
    logger.info({ poId, totalValue }, "No spend threshold configured — routing direct");
    return { routing: "DIRECT", totalValue, thresholdAmount: null };
  }

  const routing: ThresholdRouting = totalValue >= thresholdAmount ? "HQ_APPROVAL" : "DIRECT";

  logger.info(
    { poId, totalValue, thresholdAmount, routing },
    "PO routing determined",
  );

  return { routing, totalValue, thresholdAmount };
}

/**
 * Set the org-wide default spend threshold.
 */
export async function setOrgDefault(
  orgId: number,
  amount: number,
): Promise<void> {
  await db
    .update(organisation)
    .set({ defaultSpendThreshold: String(amount), updatedDttm: new Date() })
    .where(eq(organisation.organisationId, orgId));
}

/**
 * Set or update a location-specific spend threshold override.
 */
export async function setLocationOverride(
  orgId: number,
  locationId: string,
  amount: number,
  userId: number,
): Promise<void> {
  // Upsert: try update first, insert if not found
  const [existing] = await db
    .select()
    .from(spendThreshold)
    .where(
      and(
        eq(spendThreshold.organisationId, orgId),
        eq(spendThreshold.storeLocationId, locationId),
      ),
    );

  if (existing) {
    await db
      .update(spendThreshold)
      .set({ thresholdAmount: String(amount), updatedAt: new Date() })
      .where(eq(spendThreshold.thresholdId, existing.thresholdId));
  } else {
    await db.insert(spendThreshold).values({
      organisationId: orgId,
      storeLocationId: locationId,
      thresholdAmount: String(amount),
      createdByUserId: userId,
    });
  }
}

/**
 * Remove a location-specific override (reverts to org default).
 */
export async function removeLocationOverride(
  orgId: number,
  locationId: string,
): Promise<void> {
  await db
    .delete(spendThreshold)
    .where(
      and(
        eq(spendThreshold.organisationId, orgId),
        eq(spendThreshold.storeLocationId, locationId),
      ),
    );
}

/**
 * Get all thresholds for an org (org default + all location overrides).
 */
export async function getOrgThresholds(orgId: number) {
  const [org] = await db
    .select({ defaultSpendThreshold: organisation.defaultSpendThreshold })
    .from(organisation)
    .where(eq(organisation.organisationId, orgId));

  const locationOverrides = await db
    .select()
    .from(spendThreshold)
    .where(eq(spendThreshold.organisationId, orgId));

  return {
    orgDefault: org?.defaultSpendThreshold ? Number(org.defaultSpendThreshold) : null,
    locationOverrides: locationOverrides.map((t) => ({
      thresholdId: t.thresholdId,
      storeLocationId: t.storeLocationId,
      thresholdAmount: Number(t.thresholdAmount),
    })),
  };
}
