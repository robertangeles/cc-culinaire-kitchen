/**
 * @module services/stockTakeCountService
 *
 * Category state machine and line-item counting for the stock take workflow.
 *
 * Category state machine:
 *   NOT_STARTED → IN_PROGRESS → SUBMITTED → APPROVED | FLAGGED
 *   FLAGGED → IN_PROGRESS (recount)
 *
 * Exports: claimCategory, submitCategory, saveLineItem, getCategoryLines,
 *          getPreviousCountLines
 */

import { eq, and, inArray, sql, desc, getTableColumns } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  stockTakeSession,
  stockTakeCategory,
  stockTakeLine,
  stockLevel,
  ingredient,
  locationIngredient,
  user,
} from "../db/schema.js";
import { convertToBase } from "./unitConversionService.js";
import {
  varianceQty as calcVarianceQty,
  variancePct as calcVariancePct,
} from "./stockMath.js";
import {
  NotFoundError,
  InvalidStateError,
  ValidationError,
  ConflictError,
} from "./stockTakeErrors.js";

// ─── Category state machine ──────────────────────────────────────

/**
 * Claim a category for counting. Transitions NOT_STARTED → IN_PROGRESS.
 * Callers must validate that the sessionId belongs to the caller's organisation before invoking.
 */
export async function claimCategory(
  sessionId: string,
  categoryName: string,
  userId: number,
) {
  const [cat] = await db
    .select()
    .from(stockTakeCategory)
    .where(
      and(
        eq(stockTakeCategory.sessionId, sessionId),
        eq(stockTakeCategory.categoryName, categoryName),
      ),
    );

  if (!cat) throw new NotFoundError(`Category "${categoryName}" not found in session`);

  // Allow claiming if NOT_STARTED, or if already claimed by same user and IN_PROGRESS
  if (cat.categoryStatus === "IN_PROGRESS" && cat.claimedByUserId === userId) {
    return cat; // Already claimed by this user, idempotent
  }

  if (cat.categoryStatus !== "NOT_STARTED" && cat.categoryStatus !== "FLAGGED") {
    throw new InvalidStateError(
      `Cannot claim category: current status is ${cat.categoryStatus}`,
    );
  }

  const [updated] = await db
    .update(stockTakeCategory)
    .set({
      categoryStatus: "IN_PROGRESS",
      claimedByUserId: userId,
      updatedDttm: new Date(),
    })
    .where(
      and(
        eq(stockTakeCategory.categoryId, cat.categoryId),
        inArray(stockTakeCategory.categoryStatus, ["NOT_STARTED", "FLAGGED"]),
      ),
    )
    .returning();

  if (!updated) throw new ConflictError(`Category "${categoryName}" was claimed concurrently; retry`);
  return updated;
}

/**
 * Submit a category for review. Transitions IN_PROGRESS → SUBMITTED.
 * Callers must validate that the sessionId belongs to the caller's organisation before invoking.
 */
export async function submitCategory(sessionId: string, categoryName: string) {
  const [cat] = await db
    .select()
    .from(stockTakeCategory)
    .where(
      and(
        eq(stockTakeCategory.sessionId, sessionId),
        eq(stockTakeCategory.categoryName, categoryName),
      ),
    );

  if (!cat) throw new NotFoundError(`Category "${categoryName}" not found`);

  if (cat.categoryStatus === "SUBMITTED") return cat; // Idempotent

  if (cat.categoryStatus !== "IN_PROGRESS") {
    throw new InvalidStateError(
      `Cannot submit: category is ${cat.categoryStatus}, expected IN_PROGRESS`,
    );
  }

  const [updated] = await db
    .update(stockTakeCategory)
    .set({
      categoryStatus: "SUBMITTED",
      submittedDttm: new Date(),
      updatedDttm: new Date(),
    })
    .where(and(eq(stockTakeCategory.categoryId, cat.categoryId), eq(stockTakeCategory.categoryStatus, "IN_PROGRESS")))
    .returning();

  if (!updated) throw new ConflictError(`Category "${categoryName}" was modified concurrently; retry`);

  // Check if ALL categories are now SUBMITTED → auto-advance session
  await checkAndAdvanceSession(sessionId);

  return updated;
}

// ─── Line item counting ──────────────────────────────────────────

/**
 * Save a stock take line item (upsert — update if ingredient already counted in this category).
 * Converts the entered quantity to the ingredient's base unit.
 * Callers must validate that the categoryId belongs to the caller's organisation before invoking.
 */
export async function saveLineItem(
  categoryId: string,
  ingredientId: string,
  rawQty: number,
  countedUnit: string,
  userId: number,
) {
  // Validate qty
  if (rawQty < 0) throw new ValidationError("Quantity cannot be negative");
  if (rawQty > 99999) throw new ValidationError("Quantity cannot exceed 99,999");

  // Convert to base unit
  const { baseQty, baseUnit } = await convertToBase(ingredientId, rawQty, countedUnit);

  // Expected = the current book on-hand (stock_level) at this location, in base
  // units. A cycle count reconciles the physical count against the book.
  const expectedQty = await getExpectedOnHand(ingredientId, categoryId);

  const varianceQtyVal = expectedQty !== null ? calcVarianceQty(baseQty, expectedQty) : null;
  const variancePctVal =
    expectedQty !== null
      ? calcVariancePct(varianceQtyVal!, expectedQty)
      : null;

  // Atomic upsert — eliminates select-then-insert race for concurrent saves on same item
  const [row] = await db
    .insert(stockTakeLine)
    .values({
      categoryId,
      ingredientId,
      countedQty: String(baseQty),
      countedUnit: baseUnit,
      rawQty: String(rawQty),
      expectedQty: expectedQty !== null ? String(expectedQty) : null,
      varianceQty: varianceQtyVal !== null ? String(varianceQtyVal) : null,
      variancePct: variancePctVal !== null ? String(variancePctVal) : null,
      countedByUserId: userId,
    })
    .onConflictDoUpdate({
      target: [stockTakeLine.categoryId, stockTakeLine.ingredientId],
      set: {
        countedQty: sql`excluded.counted_qty`,
        countedUnit: sql`excluded.counted_unit`,
        rawQty: sql`excluded.raw_qty`,
        expectedQty: sql`excluded.expected_qty`,
        varianceQty: sql`excluded.variance_qty`,
        variancePct: sql`excluded.variance_pct`,
        countedByUserId: sql`excluded.counted_by_user_id`,
        countedDttm: new Date(),
        updatedDttm: new Date(),
      },
    })
    .returning();

  return row;
}

/** Get line items for a category — enriched with ingredient + user names. */
export async function getCategoryLines(categoryId: string) {
  return db
    .select({
      ...getTableColumns(stockTakeLine),
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
      baseUnit: ingredient.baseUnit,
      countedByUserName: user.userName,
      // Cost per base (counting) unit at this location — drives the variance $
      // value in review (variance × unitCost, computed at display, never stored).
      // WAC first (actual cost of stock on hand), then location/catalog fallback.
      unitCost: sql<
        string | null
      >`coalesce(${locationIngredient.weightedAverageCost}, ${locationIngredient.unitCost}, ${ingredient.preferredUnitCost})`,
    })
    .from(stockTakeLine)
    .innerJoin(ingredient, eq(ingredient.ingredientId, stockTakeLine.ingredientId))
    .innerJoin(user, eq(user.userId, stockTakeLine.countedByUserId))
    .innerJoin(stockTakeCategory, eq(stockTakeCategory.categoryId, stockTakeLine.categoryId))
    .innerJoin(stockTakeSession, eq(stockTakeSession.sessionId, stockTakeCategory.sessionId))
    .leftJoin(
      locationIngredient,
      and(
        eq(locationIngredient.ingredientId, stockTakeLine.ingredientId),
        eq(locationIngredient.storeLocationId, stockTakeSession.storeLocationId),
      ),
    )
    .where(eq(stockTakeLine.categoryId, categoryId));
}

/**
 * Get the previous count lines for "Copy Last Count" pre-fill.
 * Returns all line items from the most recent APPROVED session at a location.
 */
export async function getPreviousCountLines(
  storeLocationId: string,
  categoryName: string,
) {
  // Find most recent APPROVED session
  const prevSessions = await db
    .select({ sessionId: stockTakeSession.sessionId })
    .from(stockTakeSession)
    .where(
      and(
        eq(stockTakeSession.storeLocationId, storeLocationId),
        eq(stockTakeSession.sessionStatus, "APPROVED"),
      ),
    )
    .orderBy(desc(stockTakeSession.closedDttm))
    .limit(1);

  if (prevSessions.length === 0) return [];

  // Find the category in that session
  const [prevCat] = await db
    .select()
    .from(stockTakeCategory)
    .where(
      and(
        eq(stockTakeCategory.sessionId, prevSessions[0].sessionId),
        eq(stockTakeCategory.categoryName, categoryName),
      ),
    );

  if (!prevCat) return [];

  // Return all lines — enriched with ingredient + user names
  return db
    .select({
      ...getTableColumns(stockTakeLine),
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
      baseUnit: ingredient.baseUnit,
      countedByUserName: user.userName,
    })
    .from(stockTakeLine)
    .innerJoin(ingredient, eq(ingredient.ingredientId, stockTakeLine.ingredientId))
    .innerJoin(user, eq(user.userId, stockTakeLine.countedByUserId))
    .where(eq(stockTakeLine.categoryId, prevCat.categoryId));
}

// ─── Private helpers ─────────────────────────────────────────────

/**
 * The book on-hand a count is measured against: the current `stock_level` for
 * this ingredient at the session's location, in the item's base unit. A cycle
 * count reconciles physical reality against this perpetual "expected"
 * (variance = counted − book), which is the industry-standard cycle-count
 * variance — NOT count-vs-last-count, which shows nothing on a first count and
 * ignores receiving/usage between counts. Returns null only when the item has no
 * `stock_level` row at this location (genuinely nothing to compare → blank).
 */
async function getExpectedOnHand(
  ingredientId: string,
  currentCategoryId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ currentQty: stockLevel.currentQty })
    .from(stockTakeCategory)
    .innerJoin(stockTakeSession, eq(stockTakeSession.sessionId, stockTakeCategory.sessionId))
    .innerJoin(
      stockLevel,
      and(
        eq(stockLevel.storeLocationId, stockTakeSession.storeLocationId),
        eq(stockLevel.ingredientId, ingredientId),
      ),
    )
    .where(eq(stockTakeCategory.categoryId, currentCategoryId));
  return row ? Number(row.currentQty) : null;
}

/** Auto-check: if all claimed categories are SUBMITTED, advance session to PENDING_REVIEW. */
async function checkAndAdvanceSession(sessionId: string) {
  const [counts] = await db
    .select({
      claimed: sql<number>`count(*) filter (where ${stockTakeCategory.categoryStatus} != 'NOT_STARTED')`,
      blocking: sql<number>`count(*) filter (where ${stockTakeCategory.categoryStatus} not in ('NOT_STARTED', 'SUBMITTED', 'APPROVED'))`,
    })
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, sessionId));

  const allClaimedDone = counts && Number(counts.claimed) > 0 && Number(counts.blocking) === 0;

  if (allClaimedDone) {
    // ponytail: count service owns a session-domain write; move to sessionService if circular-import constraint is ever lifted
    // Status predicate makes concurrent submits idempotent — 0 rows affected = already advanced, ok
    await db
      .update(stockTakeSession)
      .set({
        sessionStatus: "PENDING_REVIEW",
        submittedDttm: new Date(),
        updatedDttm: new Date(),
      })
      .where(and(eq(stockTakeSession.sessionId, sessionId), eq(stockTakeSession.sessionStatus, "OPEN")));
  }
}
