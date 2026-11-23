/**
 * @module services/catalogRequestService
 *
 * Handles unknown item requests from staff during stock takes.
 * Staff can add items not in the master catalogue — these are flagged
 * for HQ review. On approval, the item joins the master catalogue.
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { AppError } from "../utils/appError.js";
import {
  pendingCatalogRequest,
  ingredient,
  locationIngredient,
} from "../db/schema.js";

/**
 * Create a new catalog item request from a location. `requestId`, when the client made one, makes a resend safe:
 * the request already stored under it comes back with `replay: true`. An id held by another person's request is
 * 409 CONFLICT.
 */
export async function requestNewItem(
  organisationId: number,
  storeLocationId: string,
  userId: number,
  data: {
    itemName: string;
    itemType?: string;
    category?: string;
    baseUnit?: string;
    countedQty?: number;
  },
  requestId?: string,
) {
  const [request] = await db
    .insert(pendingCatalogRequest)
    .values({
      requestId,
      organisationId,
      storeLocationId,
      requestedByUserId: userId,
      itemName: data.itemName,
      itemType: data.itemType ?? "KITCHEN_INGREDIENT",
      category: data.category,
      baseUnit: data.baseUnit,
      countedQty: data.countedQty?.toString(),
      status: "PENDING",
    })
    .onConflictDoNothing({ target: pendingCatalogRequest.requestId })
    .returning();
  if (request) return { request, replay: false };

  const [stored] = await db.select().from(pendingCatalogRequest).where(eq(pendingCatalogRequest.requestId, requestId!));
  if (!stored || stored.organisationId !== organisationId || stored.requestedByUserId !== userId) {
    throw new AppError(409, "CONFLICT", "That id is already used by another request");
  }
  return { request: stored, replay: true };
}

/** List pending requests for HQ review */
export async function listPendingRequests(organisationId: number) {
  return db
    .select()
    .from(pendingCatalogRequest)
    .where(
      and(
        eq(pendingCatalogRequest.organisationId, organisationId),
        eq(pendingCatalogRequest.status, "PENDING"),
      ),
    )
    .orderBy(desc(pendingCatalogRequest.createdDttm));
}

/** Approve a request — create the ingredient in the master catalogue */
export async function approveRequest(
  requestId: string,
  organisationId: number,
  adminUserId: number,
  catalogData?: {
    ingredientCategory?: string;
    baseUnit?: string;
    itemType?: string;
  },
) {
  // Fetch the request
  const [request] = await db
    .select()
    .from(pendingCatalogRequest)
    .where(
      and(
        eq(pendingCatalogRequest.requestId, requestId),
        eq(pendingCatalogRequest.organisationId, organisationId),
      ),
    );

  if (!request) throw new Error("Request not found");
  if (request.status !== "PENDING") throw new Error("Request already reviewed");

  // Create the ingredient in the master catalogue
  const [newIngredient] = await db
    .insert(ingredient)
    .values({
      organisationId,
      ingredientName: request.itemName,
      ingredientCategory: catalogData?.ingredientCategory ?? request.category ?? "other",
      baseUnit: catalogData?.baseUnit ?? request.baseUnit ?? "each",
      itemType: catalogData?.itemType ?? request.itemType ?? "KITCHEN_INGREDIENT",
    })
    .returning();

  // Activate at the requesting location
  await db
    .insert(locationIngredient)
    .values({
      ingredientId: newIngredient.ingredientId,
      storeLocationId: request.storeLocationId,
      activeInd: true,
    })
    .onConflictDoNothing();

  // Mark request as approved
  await db
    .update(pendingCatalogRequest)
    .set({
      status: "APPROVED",
      reviewedByUserId: adminUserId,
      createdIngredientId: newIngredient.ingredientId,
      updatedDttm: new Date(),
    })
    .where(eq(pendingCatalogRequest.requestId, requestId));

  return { request: { ...request, status: "APPROVED" }, ingredient: newIngredient };
}

/** Reject a request with a reason */
export async function rejectRequest(
  requestId: string,
  organisationId: number,
  adminUserId: number,
  reason: string,
) {
  const [request] = await db
    .select()
    .from(pendingCatalogRequest)
    .where(
      and(
        eq(pendingCatalogRequest.requestId, requestId),
        eq(pendingCatalogRequest.organisationId, organisationId),
      ),
    );

  if (!request) throw new Error("Request not found");
  if (request.status !== "PENDING") throw new Error("Request already reviewed");

  const [updated] = await db
    .update(pendingCatalogRequest)
    .set({
      status: "REJECTED",
      reviewedByUserId: adminUserId,
      reviewNotes: reason,
      updatedDttm: new Date(),
    })
    .where(eq(pendingCatalogRequest.requestId, requestId))
    .returning();

  return updated;
}
