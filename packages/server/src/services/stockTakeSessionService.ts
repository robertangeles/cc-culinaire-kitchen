/**
 * @module services/stockTakeSessionService
 *
 * Session lifecycle, HQ review actions, and dashboard queries for the stock
 * take workflow.
 *
 * Session state machine:
 *   OPEN → PENDING_REVIEW → APPROVED | FLAGGED
 *   FLAGGED → PENDING_REVIEW (re-submit via submitSessionForReview)
 *   APPROVED → ARCHIVED
 *
 * Every query is scoped by organisationId (via storeLocation FK) so a guessed
 * session ID from another tenant reads as 404, not 403.
 *
 * Exports: openSession, openOpeningCount, getActiveSession, getSessionDetail,
 *          submitSessionForReview, approveSession, flagSession,
 *          getLocationDashboard, getOrgDashboardSummary,
 *          getPendingReviewSessions, getApprovedSessions
 */

import { eq, and, ne, sql, desc, inArray, notInArray, getTableColumns } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/index.js";
import {
  stockTakeSession,
  stockTakeCategory,
  stockTakeLine,
  stockLevel,
  ingredient,
  locationIngredient,
  user,
  storeLocation,
} from "../db/schema.js";
import { recordOpsEvent } from "./brainCaptureService.js";

import {
  ConflictError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from "./stockTakeErrors.js";

/** Aliased user table for secondary JOINs (e.g. approver vs opener). */
const approverUser = alias(user, "approver");

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

// ─── Session lifecycle ────────────────────────────────────────────

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
  // ponytail: TOCTOU — two concurrent opens can both pass this check before either inserts.
  // Upgrade path: UNIQUE INDEX ON stock_take_session(store_location_id) WHERE session_status NOT IN ('ARCHIVED','APPROVED').
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

  // Guard: require opening inventory before regular stock takes; also validates org ownership
  const [loc] = await db
    .select({ inventoryActive: storeLocation.inventoryActive })
    .from(storeLocation)
    .where(and(eq(storeLocation.storeLocationId, storeLocationId), eq(storeLocation.organisationId, organisationId)));

  if (!loc) throw new NotFoundError("Location not found");
  if (!loc.inventoryActive) {
    throw new ValidationError(
      "Complete opening inventory before starting a regular stock take. Go to Setup to begin your opening count.",
    );
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

  // Return session with categories (enriched with user names)
  const createdCategories = await enrichCategoriesWithUserNames(session.sessionId);

  return { ...session, categories: createdCategories };
}

/** Open a dedicated Opening Inventory session — auto-approves on completion */
export async function openOpeningCount(
  storeLocationId: string,
  organisationId: number,
  userId: number,
) {
  // Guard: location must belong to this org (prevents IDOR error oracle via guessed locId)
  const [loc] = await db
    .select({ storeLocationId: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(
      and(
        eq(storeLocation.storeLocationId, storeLocationId),
        eq(storeLocation.organisationId, organisationId),
      ),
    );
  if (!loc) throw new NotFoundError("Location not found");

  // Guard: no prior OPENING session (completed or in-progress)
  const existing = await db
    .select({ sessionId: stockTakeSession.sessionId, sessionStatus: stockTakeSession.sessionStatus })
    .from(stockTakeSession)
    .where(
      and(
        eq(stockTakeSession.storeLocationId, storeLocationId),
        eq(stockTakeSession.sessionType, "OPENING"),
        eq(stockTakeSession.organisationId, organisationId),
      ),
    );

  const completed = existing.find((s) => s.sessionStatus === "APPROVED");
  if (completed) {
    throw new ConflictError("Opening inventory has already been completed for this location.");
  }

  const inProgress = existing.find((s) => s.sessionStatus === "OPEN" || s.sessionStatus === "PENDING_REVIEW");
  if (inProgress) {
    throw new ConflictError("An opening inventory session is already in progress.");
  }

  // Guard: location must have activated items
  const activeItems = await db
    .select({ ingredientId: locationIngredient.ingredientId, category: ingredient.ingredientCategory })
    .from(locationIngredient)
    .innerJoin(ingredient, eq(ingredient.ingredientId, locationIngredient.ingredientId))
    .where(
      and(
        eq(locationIngredient.storeLocationId, storeLocationId),
        eq(locationIngredient.activeInd, true),
        eq(ingredient.organisationId, organisationId),
      ),
    );

  if (!activeItems.length) {
    throw new ValidationError("Activate items from the catalogue before starting an opening count.");
  }

  // Guard: no active regular session
  const activeRegular = await db
    .select({ sessionId: stockTakeSession.sessionId })
    .from(stockTakeSession)
    .where(
      and(
        eq(stockTakeSession.storeLocationId, storeLocationId),
        eq(stockTakeSession.sessionStatus, "OPEN"),
      ),
    );

  if (activeRegular.length) {
    throw new ConflictError("Close the active stock take session before starting an opening count.");
  }

  // Create OPENING session
  const [session] = await db
    .insert(stockTakeSession)
    .values({
      storeLocationId,
      organisationId,
      sessionStatus: "OPEN",
      sessionType: "OPENING",
      openedByUserId: userId,
    })
    .returning();

  // Create category rows for all categories that have activated items
  const categorySet = new Set(activeItems.map((i) => i.category));
  const categoryRows = Array.from(categorySet).map((cat) => ({
    sessionId: session.sessionId,
    categoryName: cat,
    categoryStatus: "NOT_STARTED" as const,
  }));

  if (categoryRows.length) {
    await db.insert(stockTakeCategory).values(categoryRows);
  }

  // Fetch enriched session
  const categories = await db
    .select()
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, session.sessionId));

  return { ...session, categories };
}

/** Get the active session for a location (non-ARCHIVED, non-APPROVED). */
export async function getActiveSession(storeLocationId: string) {
  const rows = await db
    .select({
      ...getTableColumns(stockTakeSession),
      openedByUserName: user.userName,
      approvedByUserName: approverUser.userName,
      locationName: storeLocation.locationName,
    })
    .from(stockTakeSession)
    .innerJoin(user, eq(user.userId, stockTakeSession.openedByUserId))
    .innerJoin(storeLocation, eq(storeLocation.storeLocationId, stockTakeSession.storeLocationId))
    .leftJoin(approverUser, eq(approverUser.userId, stockTakeSession.approvedByUserId))
    .where(
      and(
        eq(stockTakeSession.storeLocationId, storeLocationId),
        ne(stockTakeSession.sessionStatus, "ARCHIVED"),
        ne(stockTakeSession.sessionStatus, "APPROVED"),
      ),
    );

  if (rows.length === 0) return null;

  const session = rows[0];
  const categories = await enrichCategoriesWithUserNames(session.sessionId);

  return { ...session, categories };
}

/** Get session detail by ID with categories and line counts. */
export async function getSessionDetail(sessionId: string, organisationId: number) {
  const [session] = await db
    .select({
      ...getTableColumns(stockTakeSession),
      openedByUserName: user.userName,
      approvedByUserName: approverUser.userName,
      locationName: storeLocation.locationName,
    })
    .from(stockTakeSession)
    .innerJoin(user, eq(user.userId, stockTakeSession.openedByUserId))
    .innerJoin(storeLocation, eq(storeLocation.storeLocationId, stockTakeSession.storeLocationId))
    .leftJoin(approverUser, eq(approverUser.userId, stockTakeSession.approvedByUserId))
    .where(
      and(
        eq(stockTakeSession.sessionId, sessionId),
        eq(stockTakeSession.organisationId, organisationId),
      ),
    );

  if (!session) return null;

  const categories = await enrichCategoriesWithUserNames(sessionId);

  // Batch-fetch all lines in one query instead of N per-category round trips
  const categoryIds = categories.map((c) => c.categoryId);
  const allLines =
    categoryIds.length > 0
      ? await db
          .select({
            ...getTableColumns(stockTakeLine),
            ingredientName: ingredient.ingredientName,
            ingredientCategory: ingredient.ingredientCategory,
            baseUnit: ingredient.baseUnit,
            countedByUserName: user.userName,
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
          .where(inArray(stockTakeLine.categoryId, categoryIds))
      : [];

  const linesByCategory = new Map<string, typeof allLines>();
  for (const line of allLines) {
    const arr = linesByCategory.get(line.categoryId) ?? [];
    arr.push(line);
    linesByCategory.set(line.categoryId, arr);
  }

  const categoriesWithCounts = categories.map((cat) => {
    const lines = linesByCategory.get(cat.categoryId) ?? [];
    return { ...cat, lineCount: lines.length, lines };
  });

  return { ...session, categories: categoriesWithCounts };
}

// ─── Session submission ──────────────────────────────────────────

/**
 * Manually submit a session for HQ review.
 * Requires at least one category to be SUBMITTED. Unclaimed (NOT_STARTED)
 * categories are left as-is — this supports partial/cycle counts.
 */
export async function submitSessionForReview(sessionId: string, orgId: number) {
  const [session] = await db
    .select()
    .from(stockTakeSession)
    .where(and(eq(stockTakeSession.sessionId, sessionId), eq(stockTakeSession.organisationId, orgId)));

  if (!session) throw new NotFoundError("Session not found");
  if (session.sessionStatus !== "OPEN" && session.sessionStatus !== "FLAGGED") {
    throw new InvalidStateError(
      `Cannot submit for review: session is ${session.sessionStatus}`,
    );
  }

  const categories = await db
    .select()
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, sessionId));

  // Must have at least one submitted category
  const submitted = categories.filter(
    (c) => c.categoryStatus === "SUBMITTED" || c.categoryStatus === "APPROVED",
  );
  if (submitted.length === 0) {
    throw new ValidationError("At least one category must be submitted before sending for review");
  }

  // Check no categories are still IN_PROGRESS (must submit or abandon)
  const inProgress = categories.filter((c) => c.categoryStatus === "IN_PROGRESS");
  if (inProgress.length > 0) {
    throw new ValidationError(
      `${inProgress.length} categor${inProgress.length === 1 ? "y is" : "ies are"} still in progress. Submit or abandon them first.`,
    );
  }

  // OPENING sessions auto-approve atomically — skip PENDING_REVIEW to avoid stuck state if approve throws
  if (session.sessionType === "OPENING") {
    await autoApproveOpeningSession(sessionId, session.storeLocationId);
    const [approved] = await db
      .select()
      .from(stockTakeSession)
      .where(eq(stockTakeSession.sessionId, sessionId));
    return approved;
  }

  const [updated] = await db
    .update(stockTakeSession)
    .set({
      sessionStatus: "PENDING_REVIEW",
      submittedDttm: new Date(),
      updatedDttm: new Date(),
    })
    .where(
      and(
        eq(stockTakeSession.sessionId, sessionId),
        inArray(stockTakeSession.sessionStatus, ["OPEN", "FLAGGED"]),
      ),
    )
    .returning();

  if (!updated) throw new ConflictError("Session was modified concurrently; retry");
  return updated;
}

// ─── HQ review actions ───────────────────────────────────────────

/** Approve a session. Updates all SUBMITTED categories to APPROVED and updates stock levels. */
export async function approveSession(sessionId: string, userId: number, orgId: number) {
  const [session] = await db
    .select()
    .from(stockTakeSession)
    .where(and(eq(stockTakeSession.sessionId, sessionId), eq(stockTakeSession.organisationId, orgId)));

  if (!session) throw new NotFoundError("Session not found");
  if (session.sessionStatus === "APPROVED") return session; // Idempotent — checked before transaction so retry is safe
  if (session.sessionStatus !== "PENDING_REVIEW") {
    throw new InvalidStateError(
      `Cannot approve: session is ${session.sessionStatus}, expected PENDING_REVIEW`,
    );
  }

  const updated = await db.transaction(async (tx) => {
    // Approve all SUBMITTED categories
    await tx
      .update(stockTakeCategory)
      .set({ categoryStatus: "APPROVED", updatedDttm: new Date() })
      .where(
        and(
          eq(stockTakeCategory.sessionId, sessionId),
          eq(stockTakeCategory.categoryStatus, "SUBMITTED"),
        ),
      );

    // Batch-upsert stock levels: single JOIN query + one INSERT ON CONFLICT (replaces N+1 loop)
    const lines = await tx
      .select({
        ingredientId: stockTakeLine.ingredientId,
        countedQty: stockTakeLine.countedQty,
        countedByUserId: stockTakeLine.countedByUserId,
      })
      .from(stockTakeLine)
      .innerJoin(stockTakeCategory, eq(stockTakeCategory.categoryId, stockTakeLine.categoryId))
      .where(eq(stockTakeCategory.sessionId, sessionId));

    if (lines.length > 0) {
      // Deduplicate by ingredientId — same ingredient can appear in multiple categories; SUM quantities
      const byIngredient = new Map<string, { ingredientId: string; countedQty: string; countedByUserId: number }>();
      for (const line of lines) {
        const existing = byIngredient.get(line.ingredientId);
        if (existing) {
          existing.countedQty = String(Number(existing.countedQty) + Number(line.countedQty));
        } else {
          byIngredient.set(line.ingredientId, { ...line });
        }
      }
      await tx
        .insert(stockLevel)
        .values(
          [...byIngredient.values()].map((line) => ({
            storeLocationId: session.storeLocationId,
            ingredientId: line.ingredientId,
            currentQty: String(Number(line.countedQty)),
            lastCountedDttm: new Date(),
            lastCountedByUserId: line.countedByUserId,
            version: 0,
          })),
        )
        .onConflictDoUpdate({
          target: [stockLevel.storeLocationId, stockLevel.ingredientId],
          set: {
            currentQty: sql`excluded.current_qty`,
            lastCountedDttm: sql`excluded.last_counted_dttm`,
            lastCountedByUserId: sql`excluded.last_counted_by_user_id`,
            updatedDttm: new Date(),
            version: sql`${stockLevel.version} + 1`,
          },
        });
    }

    // Approve session last — idempotent guard above ensures a failed retry can re-enter.
    // Status predicate prevents a concurrent approve from double-writing after we entered the tx.
    const result = await tx
      .update(stockTakeSession)
      .set({
        sessionStatus: "APPROVED",
        approvedByUserId: userId,
        closedDttm: new Date(),
        updatedDttm: new Date(),
      })
      .where(and(eq(stockTakeSession.sessionId, sessionId), eq(stockTakeSession.sessionStatus, "PENDING_REVIEW")))
      .returning();

    if (result.length === 0) throw new InvalidStateError("Session was modified concurrently; retry");
    return result[0];
  });

  // Brain org memory (spec T12): fire after commit — not inside the transaction
  void recordOpsEvent({
    userId,
    sourceType: "stock",
    scope: "org",
    organisationId: session.organisationId,
    sourceRef: sessionId,
    title: "Stock count approved",
    locationDescription: session.storeLocationId ?? null,
  });

  return updated;
}

/** Flag specific categories for recount. Session goes to FLAGGED, categories to FLAGGED. */
export async function flagSession(
  sessionId: string,
  flaggedCategories: string[],
  reason: string,
  orgId: number,
) {
  const [session] = await db
    .select()
    .from(stockTakeSession)
    .where(and(eq(stockTakeSession.sessionId, sessionId), eq(stockTakeSession.organisationId, orgId)));

  if (!session) throw new NotFoundError("Session not found");
  if (session.sessionStatus !== "PENDING_REVIEW") {
    throw new InvalidStateError(
      `Cannot flag: session is ${session.sessionStatus}, expected PENDING_REVIEW`,
    );
  }
  if (flaggedCategories.length === 0) {
    throw new ValidationError("At least one category must be flagged");
  }

  // Validate all flagged category names exist in this session — unknown names silently produce a dead FLAGGED state
  const sessionCategories = await db
    .select({ categoryName: stockTakeCategory.categoryName })
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, sessionId));
  const validNames = new Set(sessionCategories.map((c) => c.categoryName));
  const unknown = flaggedCategories.filter((name) => !validNames.has(name));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown categories: ${unknown.join(", ")}`);
  }

  const updated = await db.transaction(async (tx) => {
    // Flag specified categories — one batch UPDATE instead of N per-row updates
    await tx
      .update(stockTakeCategory)
      .set({ categoryStatus: "FLAGGED", flagReason: reason, updatedDttm: new Date() })
      .where(
        and(
          eq(stockTakeCategory.sessionId, sessionId),
          inArray(stockTakeCategory.categoryName, flaggedCategories),
        ),
      );

    // Approve non-flagged SUBMITTED categories — one batch UPDATE
    await tx
      .update(stockTakeCategory)
      .set({ categoryStatus: "APPROVED", updatedDttm: new Date() })
      .where(
        and(
          eq(stockTakeCategory.sessionId, sessionId),
          eq(stockTakeCategory.categoryStatus, "SUBMITTED"),
          notInArray(stockTakeCategory.categoryName, flaggedCategories),
        ),
      );

    // Update session — status predicate prevents overwriting a concurrently-approved session
    const [result] = await tx
      .update(stockTakeSession)
      .set({
        sessionStatus: "FLAGGED",
        flagReason: reason,
        updatedDttm: new Date(),
      })
      .where(and(eq(stockTakeSession.sessionId, sessionId), eq(stockTakeSession.sessionStatus, "PENDING_REVIEW")))
      .returning();

    if (!result) throw new ConflictError("Session was approved concurrently; retry");
    return result;
  });

  return updated;
}

// ─── Location dashboard data ─────────────────────────────────────

/** Get dashboard data for a location: stock levels, last count info. */
export async function getLocationDashboard(
  storeLocationId: string,
  organisationId: number,
) {
  // Verify location belongs to this org (prevents cross-org data exposure via req.params.locId)
  const [locVerify] = await db
    .select({ storeLocationId: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(
      and(
        eq(storeLocation.storeLocationId, storeLocationId),
        eq(storeLocation.organisationId, organisationId),
      ),
    );
  if (!locVerify) throw new NotFoundError("Location not found");

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

  // Setup progress for onboarding checklist
  const [locationInfo] = await db
    .select({
      inventoryActive: storeLocation.inventoryActive,
      classification: storeLocation.classification,
    })
    .from(storeLocation)
    .where(eq(storeLocation.storeLocationId, storeLocationId));

  const activationCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(locationIngredient)
    .where(
      and(
        eq(locationIngredient.storeLocationId, storeLocationId),
        eq(locationIngredient.activeInd, true),
      ),
    );

  const hasParLevels = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(locationIngredient)
    .where(
      and(
        eq(locationIngredient.storeLocationId, storeLocationId),
        eq(locationIngredient.activeInd, true),
        sql`par_level IS NOT NULL AND par_level > 0`,
      ),
    );

  const setupProgress = {
    locationCreated: true,
    itemsActivated: (activationCount[0]?.count ?? 0) > 0,
    itemsActivatedCount: activationCount[0]?.count ?? 0,
    parLevelsSet: (hasParLevels[0]?.count ?? 0) > 0,
    parLevelsCount: hasParLevels[0]?.count ?? 0,
    openingCountCompleted: locationInfo?.inventoryActive ?? false,
    inventoryActive: locationInfo?.inventoryActive ?? false,
  };

  return {
    stockLevels: levels,
    activeSession,
    lastCompletedSession: lastCompleted ?? null,
    setupProgress,
  };
}

/** Get org-wide dashboard summary — one row per location with stock counts + value. */
export async function getOrgDashboardSummary(organisationId: number) {
  // Get all locations in org
  const locations = await db
    .select({
      storeLocationId: storeLocation.storeLocationId,
      locationName: storeLocation.locationName,
      inventoryActive: storeLocation.inventoryActive,
    })
    .from(storeLocation)
    .where(eq(storeLocation.organisationId, organisationId));

  if (locations.length === 0) return [];

  const locationIds = locations.map((l) => l.storeLocationId);

  // Batch-fetch stock levels for all locations (replaces N per-location queries)
  const allLevels = await db
    .select({
      storeLocationId: stockLevel.storeLocationId,
      currentQty: stockLevel.currentQty,
      parLevel: locationIngredient.parLevel,
      unitCost: locationIngredient.unitCost,
      orgUnitCost: ingredient.unitCost,
    })
    .from(stockLevel)
    .innerJoin(ingredient, eq(ingredient.ingredientId, stockLevel.ingredientId))
    .leftJoin(
      locationIngredient,
      and(
        eq(locationIngredient.ingredientId, stockLevel.ingredientId),
        eq(locationIngredient.storeLocationId, stockLevel.storeLocationId),
      ),
    )
    .where(
      and(
        inArray(stockLevel.storeLocationId, locationIds),
        eq(ingredient.organisationId, organisationId),
      ),
    );

  // Batch-fetch last approved session per location (replaces N per-location queries)
  // ponytail: bounded at 100 per location; use DISTINCT ON when unbounded history becomes a concern
  const approvedSessions = await db
    .select({
      storeLocationId: stockTakeSession.storeLocationId,
      closedDttm: stockTakeSession.closedDttm,
    })
    .from(stockTakeSession)
    .where(
      and(
        inArray(stockTakeSession.storeLocationId, locationIds),
        eq(stockTakeSession.sessionStatus, "APPROVED"),
      ),
    )
    .orderBy(desc(stockTakeSession.closedDttm))
    .limit(locationIds.length * 100);

  const lastSessionByLocation = new Map<string, Date | null>();
  for (const s of approvedSessions) {
    if (!lastSessionByLocation.has(s.storeLocationId)) {
      lastSessionByLocation.set(s.storeLocationId, s.closedDttm);
    }
  }

  const levelsByLocation = new Map<string, typeof allLevels>();
  for (const lvl of allLevels) {
    const arr = levelsByLocation.get(lvl.storeLocationId) ?? [];
    arr.push(lvl);
    levelsByLocation.set(lvl.storeLocationId, arr);
  }

  return locations.map((loc) => {
    const levels = levelsByLocation.get(loc.storeLocationId) ?? [];
    let totalItems = levels.length;
    let lowStock = 0;
    let critical = 0;
    let inventoryValue = 0;

      for (const l of levels) {
        const qty = Number(l.currentQty || 0);
        const par = Number(l.parLevel || 0);
        const cost = Number(l.unitCost || l.orgUnitCost || 0);
        inventoryValue += qty * cost;
        if (par > 0) {
          const ratio = qty / par;
          if (ratio <= 0.25) critical++;
          else if (ratio <= 0.75) lowStock++;
        }
      }

      return {
        ...loc,
        inventoryActive: loc.inventoryActive,
        totalItems,
        lowStock,
        critical,
        inventoryValue,
        lastCountDttm: lastSessionByLocation.get(loc.storeLocationId) ?? null,
      };
    });
}

// ─── Cross-location review queries ──────────────────────────────

/**
 * Get all sessions pending HQ review across an org.
 * Returns compact summaries with location + opener names.
 */
export async function getPendingReviewSessions(organisationId: number) {
  const sessions = await db
    .select({
      sessionId: stockTakeSession.sessionId,
      storeLocationId: stockTakeSession.storeLocationId,
      locationName: storeLocation.locationName,
      sessionStatus: stockTakeSession.sessionStatus,
      openedByUserId: stockTakeSession.openedByUserId,
      openedByUserName: user.userName,
      openedDttm: stockTakeSession.openedDttm,
      submittedDttm: stockTakeSession.submittedDttm,
      flagReason: stockTakeSession.flagReason,
    })
    .from(stockTakeSession)
    .innerJoin(storeLocation, eq(storeLocation.storeLocationId, stockTakeSession.storeLocationId))
    .innerJoin(user, eq(user.userId, stockTakeSession.openedByUserId))
    .where(
      and(
        eq(stockTakeSession.organisationId, organisationId),
        inArray(stockTakeSession.sessionStatus, ["PENDING_REVIEW", "FLAGGED"]),
      ),
    )
    .orderBy(desc(stockTakeSession.submittedDttm));

  if (sessions.length === 0) return [];
  const catsBySession = await enrichCategoriesForSessions(sessions.map((s) => s.sessionId));
  return sessions.map((s) => {
    const cats = catsBySession.get(s.sessionId) ?? [];
    return {
      ...s,
      categoryCount: cats.length,
      submittedCount: cats.filter(
        (c) => c.categoryStatus === "SUBMITTED" || c.categoryStatus === "APPROVED",
      ).length,
      categories: cats,
    };
  });
}

/**
 * Approved (closed) stock-take sessions for the History view — HQ-only, read-only.
 * Mirrors getPendingReviewSessions but for status APPROVED, newest first by close
 * time, and adds who approved it + when.
 */
export async function getApprovedSessions(organisationId: number) {
  const sessions = await db
    .select({
      sessionId: stockTakeSession.sessionId,
      storeLocationId: stockTakeSession.storeLocationId,
      locationName: storeLocation.locationName,
      sessionStatus: stockTakeSession.sessionStatus,
      openedByUserId: stockTakeSession.openedByUserId,
      openedByUserName: user.userName,
      openedDttm: stockTakeSession.openedDttm,
      submittedDttm: stockTakeSession.submittedDttm,
      flagReason: stockTakeSession.flagReason,
      approvedByUserName: approverUser.userName,
      closedDttm: stockTakeSession.closedDttm,
    })
    .from(stockTakeSession)
    .innerJoin(storeLocation, eq(storeLocation.storeLocationId, stockTakeSession.storeLocationId))
    .innerJoin(user, eq(user.userId, stockTakeSession.openedByUserId))
    .leftJoin(approverUser, eq(approverUser.userId, stockTakeSession.approvedByUserId))
    .where(
      and(
        eq(stockTakeSession.organisationId, organisationId),
        eq(stockTakeSession.sessionStatus, "APPROVED"),
      ),
    )
    .orderBy(desc(stockTakeSession.closedDttm));

  if (sessions.length === 0) return [];
  const catsBySession = await enrichCategoriesForSessions(sessions.map((s) => s.sessionId));
  return sessions.map((s) => {
    const cats = catsBySession.get(s.sessionId) ?? [];
    return {
      ...s,
      categoryCount: cats.length,
      submittedCount: cats.filter(
        (c) => c.categoryStatus === "SUBMITTED" || c.categoryStatus === "APPROVED",
      ).length,
      categories: cats,
    };
  });
}

// ─── Private helpers ─────────────────────────────────────────────

async function enrichCategoriesWithUserNames(sessionId: string) {
  const map = await enrichCategoriesForSessions([sessionId]);
  return map.get(sessionId) ?? [];
}

/** Batch-enrich categories for multiple sessions. Returns a Map keyed by sessionId. */
async function enrichCategoriesForSessions(sessionIds: string[]) {
  const rows = await db
    .select({
      ...getTableColumns(stockTakeCategory),
      claimedByUserName: user.userName,
    })
    .from(stockTakeCategory)
    .leftJoin(user, eq(user.userId, stockTakeCategory.claimedByUserId))
    .where(inArray(stockTakeCategory.sessionId, sessionIds));

  const map = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = map.get(row.sessionId);
    if (existing) existing.push(row);
    else map.set(row.sessionId, [row]);
  }
  return map;
}

/** Auto-approve an opening session: create stock levels + mark location active */
async function autoApproveOpeningSession(sessionId: string, storeLocationId: string) {
  await db.transaction(async (tx) => {
    // 1. Approve all SUBMITTED categories
    await tx
      .update(stockTakeCategory)
      .set({ categoryStatus: "APPROVED", updatedDttm: new Date() })
      .where(
        and(
          eq(stockTakeCategory.sessionId, sessionId),
          eq(stockTakeCategory.categoryStatus, "SUBMITTED"),
        ),
      );

    // 2. Update session to APPROVED (submittedDttm set here — OPENING skips PENDING_REVIEW)
    // Status predicate prevents a concurrent re-submit from overwriting closedDttm on an already-approved session.
    const [approvedSession] = await tx
      .update(stockTakeSession)
      .set({
        sessionStatus: "APPROVED",
        submittedDttm: new Date(),
        closedDttm: new Date(),
        updatedDttm: new Date(),
      })
      .where(and(eq(stockTakeSession.sessionId, sessionId), eq(stockTakeSession.sessionStatus, "OPEN")))
      .returning();

    if (!approvedSession) return; // Concurrent submit already approved — idempotent, skip stock level writes

    // 3. Create/update stock levels from counted lines
    const lines = await tx
      .select({
        ingredientId: stockTakeLine.ingredientId,
        countedQty: stockTakeLine.countedQty,
        countedByUserId: stockTakeLine.countedByUserId,
      })
      .from(stockTakeLine)
      .innerJoin(stockTakeCategory, eq(stockTakeCategory.categoryId, stockTakeLine.categoryId))
      .where(eq(stockTakeCategory.sessionId, sessionId));

    if (lines.length > 0) {
      // Deduplicate by ingredientId — same ingredient can appear in multiple categories; SUM quantities
      const byIngredient = new Map<string, { ingredientId: string; countedQty: string; countedByUserId: number }>();
      for (const line of lines) {
        const existing = byIngredient.get(line.ingredientId);
        if (existing) {
          existing.countedQty = String(Number(existing.countedQty) + Number(line.countedQty));
        } else {
          byIngredient.set(line.ingredientId, { ...line });
        }
      }
      await tx
        .insert(stockLevel)
        .values(
          [...byIngredient.values()].map((line) => ({
            storeLocationId,
            ingredientId: line.ingredientId,
            currentQty: line.countedQty,
            lastCountedDttm: new Date(),
            lastCountedByUserId: line.countedByUserId,
            version: 0,
          })),
        )
        .onConflictDoUpdate({
          target: [stockLevel.storeLocationId, stockLevel.ingredientId],
          set: {
            currentQty: sql`excluded.current_qty`,
            lastCountedDttm: sql`excluded.last_counted_dttm`,
            lastCountedByUserId: sql`excluded.last_counted_by_user_id`,
            updatedDttm: new Date(),
          },
        });
    }

    // 4. Mark location as inventory-active
    await tx
      .update(storeLocation)
      .set({ inventoryActive: true, updatedDttm: new Date() })
      .where(eq(storeLocation.storeLocationId, storeLocationId));
  });
}

