/**
 * @module services/thresholdService
 *
 * Spend threshold logic for purchase order approval routing.
 * Below threshold → PO sent directly to supplier.
 * Above threshold → PO routed to HQ for approval.
 *
 * Resolution order: location override → org default → null (no threshold, always direct).
 */

import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  spendThreshold,
  organisation,
  purchaseOrderLine,
  storeLocation,
} from "../db/schema.js";
import * as auditService from "./auditService.js";
import type { DbOrTx } from "./auditService.js";
import { AppError } from "../utils/appError.js";
import { sumPOLineTotal, shouldRouteToHQ, isUnpriced } from "./poMath.js";
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
async function calculatePOTotal(poId: string): Promise<{ total: number; hasUnpricedLine: boolean }> {
  const lines = await db
    .select({
      orderedQty: purchaseOrderLine.orderedQty,
      unitCost: purchaseOrderLine.unitCost,
      ingredientId: purchaseOrderLine.ingredientId,
    })
    .from(purchaseOrderLine)
    .where(eq(purchaseOrderLine.poId, poId));

  return {
    total: sumPOLineTotal(
      lines.map((line) => ({
        orderedQty: Number(line.orderedQty),
        unitCost: line.unitCost ? Number(line.unitCost) : 0,
      })),
    ),
    hasUnpricedLine: lines.some((line) => isUnpriced(line.unitCost)),
  };
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
  const { total: totalValue, hasUnpricedLine } = await calculatePOTotal(poId);
  const thresholdAmount = await getThreshold(orgId, locationId);

  // No threshold configured → always direct
  if (thresholdAmount === null) {
    logger.info({ poId, totalValue }, "No spend threshold configured — routing direct");
    return { routing: "DIRECT", totalValue, thresholdAmount: null };
  }

  const routing: ThresholdRouting = shouldRouteToHQ(totalValue, thresholdAmount, hasUnpricedLine) ? "HQ_APPROVAL" : "DIRECT";

  logger.info(
    { poId, totalValue, thresholdAmount, hasUnpricedLine, routing },
    "PO routing determined",
  );

  return { routing, totalValue, thresholdAmount };
}

/** The highest spend threshold anyone can set: above it, approval routing would in practice be switched off. */
export const MAX_SPEND_THRESHOLD = 1_000_000;

/** One audit row per threshold change: the org default is keyed by the organisation, an override by its location. */
function logThresholdChange(
  tx: DbOrTx,
  orgId: number,
  userId: number,
  entityId: string,
  before: number | null,
  after: number | null,
) {
  return auditService.log(
    {
      entityType: "spend_threshold",
      entityId,
      action: "update",
      actorUserId: userId,
      organisationId: orgId,
      beforeValue: { amount: before },
      afterValue: { amount: after },
    },
    tx,
  );
}

/**
 * Set the org-wide default spend threshold.
 */
export async function setOrgDefault(
  orgId: number,
  amount: number,
  userId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [org] = await tx
      .select({ defaultSpendThreshold: organisation.defaultSpendThreshold })
      .from(organisation)
      .where(eq(organisation.organisationId, orgId))
      .for("update");
    await tx
      .update(organisation)
      .set({ defaultSpendThreshold: String(amount), updatedDttm: new Date() })
      .where(eq(organisation.organisationId, orgId));
    const before = org?.defaultSpendThreshold != null ? Number(org.defaultSpendThreshold) : null;
    await logThresholdChange(tx, orgId, userId, String(orgId), before, amount);
  });
}

/**
 * Set or update a location-specific spend threshold override. The location must be the organisation's own.
 */
export async function setLocationOverride(
  orgId: number,
  locationId: string,
  amount: number,
  userId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [location] = await tx
      .select({ id: storeLocation.storeLocationId })
      .from(storeLocation)
      .where(and(eq(storeLocation.storeLocationId, locationId), eq(storeLocation.organisationId, orgId)));
    if (!location) throw new AppError(404, "NOT_FOUND", "Location not found");

    // Upsert: try update first, insert if not found
    const [existing] = await tx
      .select()
      .from(spendThreshold)
      .where(
        and(
          eq(spendThreshold.organisationId, orgId),
          eq(spendThreshold.storeLocationId, locationId),
        ),
      )
      .for("update");

    if (existing) {
      await tx
        .update(spendThreshold)
        .set({ thresholdAmount: String(amount), updatedAt: new Date() })
        .where(eq(spendThreshold.thresholdId, existing.thresholdId));
    } else {
      await tx.insert(spendThreshold).values({
        organisationId: orgId,
        storeLocationId: locationId,
        thresholdAmount: String(amount),
        createdByUserId: userId,
      });
    }
    await logThresholdChange(tx, orgId, userId, locationId, existing ? Number(existing.thresholdAmount) : null, amount);
  });
}

/**
 * Remove a location-specific override (reverts to org default).
 */
export async function removeLocationOverride(
  orgId: number,
  locationId: string,
  userId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(spendThreshold)
      .where(
        and(
          eq(spendThreshold.organisationId, orgId),
          eq(spendThreshold.storeLocationId, locationId),
        ),
      )
      .returning({ thresholdAmount: spendThreshold.thresholdAmount });
    if (removed) await logThresholdChange(tx, orgId, userId, locationId, Number(removed.thresholdAmount), null);
  });
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
