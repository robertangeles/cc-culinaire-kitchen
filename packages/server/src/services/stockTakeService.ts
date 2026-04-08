/**
 * @module services/stockTakeService
 *
 * Service layer for the stock take workflow — session lifecycle,
 * category state machine, line item counting, and variance calculation.
 *
 * Session state machine:
 *   OPEN → PENDING_REVIEW → APPROVED | FLAGGED
 *   FLAGGED → OPEN (reopened) → PENDING_REVIEW
 *   APPROVED → ARCHIVED
 *
 * Category state machine:
 *   NOT_STARTED → IN_PROGRESS → SUBMITTED → APPROVED | FLAGGED
 *   FLAGGED → IN_PROGRESS (recount)
 */

import { eq, and, ne, sql, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  stockTakeSession,
  stockTakeCategory,
  stockTakeLine,
  stockLevel,
  ingredient,
  locationIngredient,
} from "../db/schema.js";
import { convertToBase } from "./unitConversionService.js";

// ─── Constants ────────────────────────────────────────────────────

/** Default ingredient categories that populate a new stock take session. */
const DEFAULT_CATEGORIES = [
  "proteins",
  "produce",
  "dairy",
  "dry_goods",
  "beverages",
  "spirits",
  "frozen",
  "bakery",
  "condiments",
  "other",
];

// Valid state transitions
const SESSION_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["PENDING_REVIEW"],
  PENDING_REVIEW: ["APPROVED", "FLAGGED"],
  FLAGGED: ["OPEN"],
  APPROVED: ["ARCHIVED"],
};

const CATEGORY_TRANSITIONS: Record<string, string[]> = {
  NOT_STARTED: ["IN_PROGRESS"],
  IN_PROGRESS: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "FLAGGED"],
  FLAGGED: ["IN_PROGRESS"],
};

// ─── Session lifecycle ────────────────────────────────────────────

/**
 * Open a new stock take session at a location.
 * Fails if there's already an active (non-ARCHIVED) session.
 */
/**
 * Open a new stock take session at a location.
 * @param categories - which categories to count. If empty/omitted, defaults to all.
 *   Supports cycle counts (e.g., ["proteins", "dairy"]) and full counts.
 */
export async function openSession(
  storeLocationId: string,
  organisationId: number,
  userId: number,
  categories?: string[],
) {
  // Check for existing active session
  const existing = await db
    .select({ sessionId: stockTakeSession.sessionId })
    .from(stockTakeSession)
    .where(
      and(
        eq(stockTakeSession.storeLocationId, storeLocationId),
        ne(stockTakeSession.sessionStatus, "ARCHIVED"),
        ne(stockTakeSession.sessionStatus, "APPROVED"),
      ),
    );

  if (existing.length > 0) {
    throw new ConflictError("A stock take session is already active at this location");
  }

  // Create session
  const [session] = await db
    .insert(stockTakeSession)
    .values({
      storeLocationId,
      organisationId,
      openedByUserId: userId,
      sessionStatus: "OPEN",
    })
    .returning();

  // Create category rows — selected categories or all defaults
  const selectedCategories = categories && categories.length > 0
    ? categories.filter((c) => DEFAULT_CATEGORIES.includes(c))
    : DEFAULT_CATEGORIES;

  const categoryValues = selectedCategories.map((name) => ({
    sessionId: session.sessionId,
    categoryName: name,
    categoryStatus: "NOT_STARTED" as const,
  }));

  await db.insert(stockTakeCategory).values(categoryValues);

  // Return session with categories
  const createdCategories = await db
    .select()
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, session.sessionId));

  return { ...session, categories: createdCategories };
}

/** Get the active session for a location (non-ARCHIVED, non-APPROVED). */
export async function getActiveSession(storeLocationId: string) {
  const rows = await db
    .select()
    .from(stockTakeSession)
    .where(
      and(
        eq(stockTakeSession.storeLocationId, storeLocationId),
        ne(stockTakeSession.sessionStatus, "ARCHIVED"),
        ne(stockTakeSession.sessionStatus, "APPROVED"),
      ),
    );

  if (rows.length === 0) return null;

  const session = rows[0];
  const categories = await db
    .select()
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, session.sessionId));

  return { ...session, categories };
}

/** Get session detail by ID with categories and line counts. */
export async function getSessionDetail(sessionId: string, organisationId: number) {
  const [session] = await db
    .select()
    .from(stockTakeSession)
    .where(
      and(
        eq(stockTakeSession.sessionId, sessionId),
        eq(stockTakeSession.organisationId, organisationId),
      ),
    );

  if (!session) return null;

  const categories = await db
    .select()
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, sessionId));

  // Get line counts per category
  const categoriesWithCounts = await Promise.all(
    categories.map(async (cat) => {
      const lines = await db
        .select()
        .from(stockTakeLine)
        .where(eq(stockTakeLine.categoryId, cat.categoryId));
      return { ...cat, lineCount: lines.length, lines };
    }),
  );

  return { ...session, categories: categoriesWithCounts };
}

// ─── Category state machine ──────────────────────────────────────

/** Claim a category for counting. Transitions NOT_STARTED → IN_PROGRESS. */
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

  if (cat.categoryStatus === "NOT_STARTED" || cat.categoryStatus === "FLAGGED") {
    const [updated] = await db
      .update(stockTakeCategory)
      .set({
        categoryStatus: "IN_PROGRESS",
        claimedByUserId: userId,
        updatedDttm: new Date(),
      })
      .where(eq(stockTakeCategory.categoryId, cat.categoryId))
      .returning();
    return updated;
  }

  throw new InvalidStateError(
    `Category "${categoryName}" is already ${cat.categoryStatus}`,
  );
}

/** Submit a category for review. Transitions IN_PROGRESS → SUBMITTED. */
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
    .where(eq(stockTakeCategory.categoryId, cat.categoryId))
    .returning();

  // Check if ALL categories are now SUBMITTED → auto-advance session
  await checkAndAdvanceSession(sessionId);

  return updated;
}

/**
 * Check if all CLAIMED categories are submitted and advance session to PENDING_REVIEW.
 * NOT_STARTED categories are excluded — supports partial/cycle counts where
 * only some categories are counted per session.
 * At least one category must be submitted for the session to advance.
 */
async function checkAndAdvanceSession(sessionId: string) {
  const categories = await db
    .select()
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, sessionId));

  const claimed = categories.filter((c) => c.categoryStatus !== "NOT_STARTED");
  const allClaimedDone = claimed.length > 0 && claimed.every(
    (c) => c.categoryStatus === "SUBMITTED" || c.categoryStatus === "APPROVED",
  );

  if (allClaimedDone) {
    await db
      .update(stockTakeSession)
      .set({
        sessionStatus: "PENDING_REVIEW",
        submittedDttm: new Date(),
        updatedDttm: new Date(),
      })
      .where(eq(stockTakeSession.sessionId, sessionId));
  }
}

// ─── HQ review actions ───────────────────────────────────────────

/** Approve a session. Updates all SUBMITTED categories to APPROVED and updates stock levels. */
export async function approveSession(sessionId: string, userId: number) {
  const [session] = await db
    .select()
    .from(stockTakeSession)
    .where(eq(stockTakeSession.sessionId, sessionId));

  if (!session) throw new NotFoundError("Session not found");

  if (session.sessionStatus === "APPROVED") return session; // Idempotent

  if (session.sessionStatus !== "PENDING_REVIEW") {
    throw new InvalidStateError(
      `Cannot approve: session is ${session.sessionStatus}, expected PENDING_REVIEW`,
    );
  }

  // Approve all SUBMITTED categories
  await db
    .update(stockTakeCategory)
    .set({ categoryStatus: "APPROVED", updatedDttm: new Date() })
    .where(
      and(
        eq(stockTakeCategory.sessionId, sessionId),
        eq(stockTakeCategory.categoryStatus, "SUBMITTED"),
      ),
    );

  // Update session status
  const [updated] = await db
    .update(stockTakeSession)
    .set({
      sessionStatus: "APPROVED",
      approvedByUserId: userId,
      closedDttm: new Date(),
      updatedDttm: new Date(),
    })
    .where(eq(stockTakeSession.sessionId, sessionId))
    .returning();

  // Update stock levels from approved counts
  await updateStockLevelsFromSession(sessionId, session.storeLocationId);

  return updated;
}

/** Flag specific categories for recount. Session goes to FLAGGED, categories to FLAGGED. */
export async function flagSession(
  sessionId: string,
  flaggedCategories: string[],
  reason: string,
) {
  const [session] = await db
    .select()
    .from(stockTakeSession)
    .where(eq(stockTakeSession.sessionId, sessionId));

  if (!session) throw new NotFoundError("Session not found");
  if (session.sessionStatus !== "PENDING_REVIEW") {
    throw new InvalidStateError(
      `Cannot flag: session is ${session.sessionStatus}, expected PENDING_REVIEW`,
    );
  }

  // Flag specified categories
  for (const catName of flaggedCategories) {
    await db
      .update(stockTakeCategory)
      .set({
        categoryStatus: "FLAGGED",
        flagReason: reason,
        updatedDttm: new Date(),
      })
      .where(
        and(
          eq(stockTakeCategory.sessionId, sessionId),
          eq(stockTakeCategory.categoryName, catName),
        ),
      );
  }

  // Approve non-flagged SUBMITTED categories
  const allCategories = await db
    .select()
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, sessionId));

  for (const cat of allCategories) {
    if (
      cat.categoryStatus === "SUBMITTED" &&
      !flaggedCategories.includes(cat.categoryName)
    ) {
      await db
        .update(stockTakeCategory)
        .set({ categoryStatus: "APPROVED", updatedDttm: new Date() })
        .where(eq(stockTakeCategory.categoryId, cat.categoryId));
    }
  }

  // Update session
  const [updated] = await db
    .update(stockTakeSession)
    .set({
      sessionStatus: "FLAGGED",
      flagReason: reason,
      updatedDttm: new Date(),
    })
    .where(eq(stockTakeSession.sessionId, sessionId))
    .returning();

  return updated;
}

// ─── Line item counting ──────────────────────────────────────────

/**
 * Save a stock take line item (upsert — update if ingredient already counted in this category).
 * Converts the entered quantity to the ingredient's base unit.
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

  // Calculate expected qty from previous stock take (for variance)
  const expectedQty = await getPreviousCount(ingredientId, categoryId);

  const varianceQty = expectedQty !== null ? baseQty - expectedQty : null;
  const variancePct =
    expectedQty !== null && expectedQty !== 0
      ? ((baseQty - expectedQty) / expectedQty) * 100
      : null;

  // Upsert: insert or update if this ingredient was already counted in this category
  const existing = await db
    .select()
    .from(stockTakeLine)
    .where(
      and(
        eq(stockTakeLine.categoryId, categoryId),
        eq(stockTakeLine.ingredientId, ingredientId),
      ),
    );

  if (existing.length > 0) {
    const [updated] = await db
      .update(stockTakeLine)
      .set({
        countedQty: String(baseQty),
        countedUnit: baseUnit,
        rawQty: String(rawQty),
        expectedQty: expectedQty !== null ? String(expectedQty) : null,
        varianceQty: varianceQty !== null ? String(varianceQty) : null,
        variancePct: variancePct !== null ? String(variancePct) : null,
        countedByUserId: userId,
        countedDttm: new Date(),
        updatedDttm: new Date(),
      })
      .where(eq(stockTakeLine.lineId, existing[0].lineId))
      .returning();
    return updated;
  }

  const [row] = await db
    .insert(stockTakeLine)
    .values({
      categoryId,
      ingredientId,
      countedQty: String(baseQty),
      countedUnit: baseUnit,
      rawQty: String(rawQty),
      expectedQty: expectedQty !== null ? String(expectedQty) : null,
      varianceQty: varianceQty !== null ? String(varianceQty) : null,
      variancePct: variancePct !== null ? String(variancePct) : null,
      countedByUserId: userId,
    })
    .returning();

  return row;
}

/** Get line items for a category. */
export async function getCategoryLines(categoryId: string) {
  return db
    .select()
    .from(stockTakeLine)
    .where(eq(stockTakeLine.categoryId, categoryId));
}

/**
 * Get the previous approved count for an ingredient (for variance calculation).
 * Looks at the most recent APPROVED session at the same location.
 */
async function getPreviousCount(
  ingredientId: string,
  currentCategoryId: string,
): Promise<number | null> {
  // Find which session/location this category belongs to
  const [cat] = await db
    .select({ sessionId: stockTakeCategory.sessionId })
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.categoryId, currentCategoryId));

  if (!cat) return null;

  const [session] = await db
    .select({ storeLocationId: stockTakeSession.storeLocationId })
    .from(stockTakeSession)
    .where(eq(stockTakeSession.sessionId, cat.sessionId));

  if (!session) return null;

  // Find the most recent APPROVED session at this location (not current one)
  const prevSessions = await db
    .select({ sessionId: stockTakeSession.sessionId })
    .from(stockTakeSession)
    .where(
      and(
        eq(stockTakeSession.storeLocationId, session.storeLocationId),
        eq(stockTakeSession.sessionStatus, "APPROVED"),
        ne(stockTakeSession.sessionId, cat.sessionId),
      ),
    )
    .orderBy(desc(stockTakeSession.closedDttm))
    .limit(1);

  if (prevSessions.length === 0) return null;

  // Find the line for this ingredient in the previous session
  const prevCategories = await db
    .select({ categoryId: stockTakeCategory.categoryId })
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, prevSessions[0].sessionId));

  for (const prevCat of prevCategories) {
    const [line] = await db
      .select({ countedQty: stockTakeLine.countedQty })
      .from(stockTakeLine)
      .where(
        and(
          eq(stockTakeLine.categoryId, prevCat.categoryId),
          eq(stockTakeLine.ingredientId, ingredientId),
        ),
      );
    if (line) return Number(line.countedQty);
  }

  return null;
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

  // Return all lines
  return db
    .select()
    .from(stockTakeLine)
    .where(eq(stockTakeLine.categoryId, prevCat.categoryId));
}

// ─── Stock level updates ─────────────────────────────────────────

/** Update stock levels from an approved session's counted quantities. */
async function updateStockLevelsFromSession(
  sessionId: string,
  storeLocationId: string,
) {
  // Get all lines from all categories in this session
  const categories = await db
    .select()
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, sessionId));

  for (const cat of categories) {
    const lines = await db
      .select()
      .from(stockTakeLine)
      .where(eq(stockTakeLine.categoryId, cat.categoryId));

    for (const line of lines) {
      await upsertStockLevel(
        storeLocationId,
        line.ingredientId,
        Number(line.countedQty),
        line.countedByUserId,
      );
    }
  }
}

/**
 * Upsert a stock level with optimistic locking.
 * On version conflict, retries once with fresh data.
 */
async function upsertStockLevel(
  storeLocationId: string,
  ingredientId: string,
  qty: number,
  userId: number,
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
    // Insert new stock level
    await db.insert(stockLevel).values({
      storeLocationId,
      ingredientId,
      currentQty: String(qty),
      lastCountedDttm: new Date(),
      lastCountedByUserId: userId,
      version: 0,
    });
    return;
  }

  // Update with optimistic lock
  const current = existing[0];
  const result = await db
    .update(stockLevel)
    .set({
      currentQty: String(qty),
      lastCountedDttm: new Date(),
      lastCountedByUserId: userId,
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
    // Version conflict — retry with fresh data
    await upsertStockLevel(storeLocationId, ingredientId, qty, userId, retryCount + 1);
  }
}

// ─── Location dashboard data ─────────────────────────────────────

/** Get dashboard data for a location: stock levels, last count info. */
export async function getLocationDashboard(
  storeLocationId: string,
  organisationId: number,
) {
  // Current stock levels with ingredient info
  const levels = await db
    .select({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
      baseUnit: ingredient.baseUnit,
      currentQty: stockLevel.currentQty,
      lastCountedDttm: stockLevel.lastCountedDttm,
      parLevel: locationIngredient.parLevel,
      activeInd: locationIngredient.activeInd,
    })
    .from(stockLevel)
    .innerJoin(ingredient, eq(ingredient.ingredientId, stockLevel.ingredientId))
    .leftJoin(
      locationIngredient,
      and(
        eq(locationIngredient.ingredientId, stockLevel.ingredientId),
        eq(locationIngredient.storeLocationId, storeLocationId),
      ),
    )
    .where(
      and(
        eq(stockLevel.storeLocationId, storeLocationId),
        eq(ingredient.organisationId, organisationId),
      ),
    );

  // Active session info
  const activeSession = await getActiveSession(storeLocationId);

  // Last completed session
  const [lastCompleted] = await db
    .select()
    .from(stockTakeSession)
    .where(
      and(
        eq(stockTakeSession.storeLocationId, storeLocationId),
        eq(stockTakeSession.sessionStatus, "APPROVED"),
      ),
    )
    .orderBy(desc(stockTakeSession.closedDttm))
    .limit(1);

  return {
    stockLevels: levels,
    activeSession,
    lastCompletedSession: lastCompleted ?? null,
  };
}

// ─── Error classes ────────────────────────────────────────────────

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
