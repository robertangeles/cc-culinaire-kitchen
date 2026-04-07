/**
 * @module services/recipePersistenceService
 *
 * CRUD operations for persisted recipes. Handles saving generated recipes,
 * listing user's recipes, public gallery queries, and recipe management.
 */

import pino from "pino";
import { db } from "../db/index.js";
import { recipe, recipeRating, recipeVersion, user, kitchenProfile } from "../db/schema.js";
import { eq, and, or, sql, desc, max } from "drizzle-orm";

const logger = pino({ name: "recipePersistence" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SaveRecipeParams {
  userId?: number;
  domain: string;
  title: string;
  description?: string;
  recipeData: Record<string, unknown>;
  editorialContent?: string;
  imageUrl?: string;
  imagePrompt?: string;
  kitchenContext?: string;
  requestParams?: Record<string, unknown>;
}

export interface RecipeListItem {
  recipeId: string;
  title: string;
  description: string | null;
  domain: string;
  imageUrl: string | null;
  isPublicInd: boolean;
  viewCount: number;
  createdDttm: Date;
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

/**
 * Generate a URL-safe slug from a recipe title.
 * e.g., "Wok-Fried Pork with Black Bean" → "wok-fried-pork-with-black-bean"
 * Deduplicates by appending -2, -3, etc. if slug already exists.
 */
async function generateSlug(title: string): Promise<string> {
  const base = title
    .toLowerCase()
    .replace(/['']/g, "")           // remove apostrophes
    .replace(/[^a-z0-9]+/g, "-")    // non-alphanumeric → dash
    .replace(/^-+|-+$/g, "")        // trim leading/trailing dashes
    .slice(0, 200);                  // cap length

  // Check for collision
  let slug = base;
  let suffix = 1;
  while (true) {
    const existing = await db
      .select({ recipeId: recipe.recipeId })
      .from(recipe)
      .where(eq(recipe.slug, slug))
      .limit(1);
    if (existing.length === 0) break;
    suffix++;
    slug = `${base}-${suffix}`;
  }

  return slug;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Save a generated recipe to the database.
 * Returns the new recipe's UUID and slug.
 */
export async function saveRecipe(params: SaveRecipeParams): Promise<{ recipeId: string; slug: string }> {
  const slug = await generateSlug(params.title);

  // Guest recipes are automatically public (go to The Kitchen Shelf)
  const isGuest = !params.userId;

  const [saved] = await db
    .insert(recipe)
    .values({
      slug,
      userId: params.userId ?? null,
      domain: params.domain,
      title: params.title,
      description: params.description ?? null,
      recipeData: params.recipeData,
      editorialContent: params.editorialContent ?? null,
      imageUrl: params.imageUrl ?? null,
      imagePrompt: params.imagePrompt ?? null,
      kitchenContext: params.kitchenContext ?? null,
      requestParams: params.requestParams ?? null,
      isPublicInd: isGuest,
    })
    .returning({ recipeId: recipe.recipeId, slug: recipe.slug });

  // Create version 1 snapshot
  try {
    await db.insert(recipeVersion).values({
      recipeId: saved.recipeId,
      versionNumber: 1,
      recipeData: params.recipeData,
      editorialContent: params.editorialContent ?? null,
      changeDescription: "Original AI generation",
      changedBy: params.userId ?? null,
      changeType: "original",
    });
  } catch (vErr) {
    logger.warn({ recipeId: saved.recipeId, err: vErr }, "Failed to create initial recipe version");
  }

  logger.info({ recipeId: saved.recipeId, slug: saved.slug, title: params.title }, "Recipe saved");
  return { recipeId: saved.recipeId, slug: saved.slug! };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Get a single recipe by slug or UUID.
 * Increments view count for public views.
 */
export async function getRecipe(idOrSlug: string, incrementView = false) {
  // Try slug first, fall back to UUID
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

  const [rec] = await db
    .select()
    .from(recipe)
    .where(
      isUuid
        ? eq(recipe.recipeId, idOrSlug)
        : eq(recipe.slug, idOrSlug),
    )
    .limit(1);

  if (!rec) return null;

  if (incrementView) {
    await db
      .update(recipe)
      .set({ viewCount: sql`${recipe.viewCount} + 1` })
      .where(eq(recipe.recipeId, rec.recipeId));
  }

  // Fetch creator info if recipe has a userId
  let creator: {
    userName: string;
    userPhotoPath: string | null;
    userBio: string | null;
    userFacebook: string | null;
    userInstagram: string | null;
    userTiktok: string | null;
    userPinterest: string | null;
    userLinkedin: string | null;
    restaurantName: string | null;
  } | null = null;

  if (rec.userId) {
    const [u] = await db
      .select({
        userName: user.userName,
        userPhotoPath: user.userPhotoPath,
        userBio: user.userBio,
        userFacebook: user.userFacebook,
        userInstagram: user.userInstagram,
        userTiktok: user.userTiktok,
        userPinterest: user.userPinterest,
        userLinkedin: user.userLinkedin,
      })
      .from(user)
      .where(eq(user.userId, rec.userId))
      .limit(1);

    // Also fetch restaurant name from kitchen_profile
    const [kp] = await db
      .select({ restaurantName: kitchenProfile.restaurantName })
      .from(kitchenProfile)
      .where(eq(kitchenProfile.userId, rec.userId))
      .limit(1);

    if (u) {
      creator = {
        ...u,
        restaurantName: kp?.restaurantName ?? null,
      };
    }
  }

  return { ...rec, creator };
}

/**
 * List recipes for a specific user (My Recipes).
 */
export async function listUserRecipes(userId: number, page = 1, limit = 20) {
  const offset = (page - 1) * limit;

  const recipes = await db
    .select({
      recipeId: recipe.recipeId,
      slug: recipe.slug,
      title: recipe.title,
      description: recipe.description,
      domain: recipe.domain,
      imageUrl: recipe.imageUrl,
      isPublicInd: recipe.isPublicInd,
      viewCount: recipe.viewCount,
      createdDttm: recipe.createdDttm,
      averageRating: sql<number>`COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM recipe_rating WHERE recipe_id = ${recipe.recipeId}), 0)`.as("average_rating"),
      ratingCount: sql<number>`COALESCE((SELECT COUNT(*)::int FROM recipe_rating WHERE recipe_id = ${recipe.recipeId}), 0)`.as("rating_count"),
    })
    .from(recipe)
    .where(and(eq(recipe.userId, userId), eq(recipe.archivedInd, false)))
    .orderBy(desc(recipe.createdDttm))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recipe)
    .where(and(eq(recipe.userId, userId), eq(recipe.archivedInd, false)));

  return { recipes, total: count, page, limit };
}

/**
 * List public recipes for the gallery (paginated, filterable).
 */
export async function listGalleryRecipes(
  page = 1,
  limit = 20,
  filters?: { domain?: string; difficulty?: string; search?: string },
) {
  const offset = (page - 1) * limit;

  const conditions = [eq(recipe.isPublicInd, true), eq(recipe.archivedInd, false)];
  if (filters?.domain) {
    conditions.push(eq(recipe.domain, filters.domain));
  }
  if (filters?.search) {
    const term = `%${filters.search}%`;
    conditions.push(
      or(
        sql`${recipe.title} ILIKE ${term}`,
        sql`${recipe.description} ILIKE ${term}`,
        sql`${recipe.recipeData}::text ILIKE ${term}`,
      )!,
    );
  }

  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

  const recipes = await db
    .select({
      recipeId: recipe.recipeId,
      slug: recipe.slug,
      title: recipe.title,
      description: recipe.description,
      domain: recipe.domain,
      imageUrl: recipe.imageUrl,
      viewCount: recipe.viewCount,
      recipeData: recipe.recipeData,
      createdDttm: recipe.createdDttm,
      averageRating: sql<number>`COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM recipe_rating WHERE recipe_id = ${recipe.recipeId}), 0)`.as("average_rating"),
      ratingCount: sql<number>`COALESCE((SELECT COUNT(*)::int FROM recipe_rating WHERE recipe_id = ${recipe.recipeId}), 0)`.as("rating_count"),
    })
    .from(recipe)
    .where(whereClause)
    .orderBy(desc(recipe.createdDttm))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recipe)
    .where(whereClause!);

  return { recipes, total: count, page, limit };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Update recipe fields (toggle public, edit title, update image).
 * Only the recipe owner can update.
 */
export async function updateRecipe(
  recipeId: string,
  userId: number,
  updates: {
    title?: string;
    isPublicInd?: boolean;
    imageUrl?: string;
    editorialContent?: string;
  },
) {
  // First try matching by userId (owner). If recipe was created by this user,
  // allow the update. If userId doesn't match (e.g. recipe created as guest
  // before login), fall back to matching by recipeId only for isPublicInd toggle.
  let result = await db
    .update(recipe)
    .set({ ...updates, updatedDttm: new Date() })
    .where(and(eq(recipe.recipeId, recipeId), eq(recipe.userId, userId)))
    .returning({ recipeId: recipe.recipeId });

  // Fallback: if only toggling isPublicInd and owner check failed,
  // allow update by recipeId alone (the user has the ID from generation)
  if (result.length === 0 && updates.isPublicInd !== undefined && Object.keys(updates).length === 1) {
    result = await db
      .update(recipe)
      .set({ isPublicInd: updates.isPublicInd, updatedDttm: new Date() })
      .where(eq(recipe.recipeId, recipeId))
      .returning({ recipeId: recipe.recipeId });
  }

  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a recipe. Only the recipe owner can delete.
 */
export async function deleteRecipe(recipeId: string, userId: number): Promise<boolean> {
  const result = await db
    .delete(recipe)
    .where(and(eq(recipe.recipeId, recipeId), eq(recipe.userId, userId)))
    .returning({ recipeId: recipe.recipeId });

  if (result.length > 0) {
    logger.info({ recipeId }, "Recipe deleted");
  }
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

/**
 * Archive a recipe (soft delete). Can be done by:
 * - Admin: any recipe
 * - Owner: their own recipe
 */
export async function archiveRecipe(
  recipeId: string,
  userId: number,
  isAdmin: boolean,
): Promise<boolean> {
  const condition = isAdmin
    ? eq(recipe.recipeId, recipeId)
    : and(eq(recipe.recipeId, recipeId), eq(recipe.userId, userId));

  const result = await db
    .update(recipe)
    .set({
      archivedInd: true,
      archivedAtDttm: new Date(),
      isPublicInd: false, // remove from gallery
      updatedDttm: new Date(),
    })
    .where(condition)
    .returning({ recipeId: recipe.recipeId });

  if (result.length > 0) {
    logger.info({ recipeId, isAdmin }, "Recipe archived");
  }
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Recipe content update with versioning
// ---------------------------------------------------------------------------

/**
 * Full recipe content update with automatic version snapshotting.
 * Snapshots the current state, then applies the update.
 * Only the recipe owner can update.
 */
export async function updateRecipeContent(
  recipeId: string,
  userId: number,
  updates: {
    recipeData?: Record<string, unknown>;
    title?: string;
    description?: string;
    editorialContent?: string;
    changeDescription?: string;
    changeType?: string;
  },
): Promise<{ recipe: any; versionNumber: number } | null> {
  // Verify ownership
  const [existing] = await db
    .select()
    .from(recipe)
    .where(and(eq(recipe.recipeId, recipeId), eq(recipe.userId, userId)))
    .limit(1);

  if (!existing) return null;

  // Get current max version number
  const [maxRow] = await db
    .select({ maxVer: max(recipeVersion.versionNumber) })
    .from(recipeVersion)
    .where(eq(recipeVersion.recipeId, recipeId));

  const currentMax = maxRow?.maxVer ?? 0;
  const newVersionNumber = currentMax + 1;

  // Snapshot current state into recipe_version
  await db.insert(recipeVersion).values({
    recipeId,
    versionNumber: newVersionNumber,
    recipeData: existing.recipeData as Record<string, unknown>,
    editorialContent: existing.editorialContent ?? null,
    changeDescription: updates.changeDescription ?? "Manual edit",
    changedBy: userId,
    changeType: updates.changeType ?? "manual",
  });

  // Build the update set
  const updateSet: Record<string, unknown> = { updatedDttm: new Date() };
  if (updates.recipeData) updateSet.recipeData = updates.recipeData;
  if (updates.title) updateSet.title = updates.title;
  if (updates.description !== undefined) updateSet.description = updates.description;
  if (updates.editorialContent !== undefined) updateSet.editorialContent = updates.editorialContent;

  // Update the recipe table
  const [updated] = await db
    .update(recipe)
    .set(updateSet)
    .where(eq(recipe.recipeId, recipeId))
    .returning();

  logger.info({ recipeId, versionNumber: newVersionNumber, changeType: updates.changeType ?? "manual" }, "Recipe content updated with version");

  return { recipe: updated, versionNumber: newVersionNumber };
}

// ---------------------------------------------------------------------------
// Version management
// ---------------------------------------------------------------------------

/**
 * List all versions for a recipe. Only the owner can view versions.
 */
export async function getRecipeVersions(
  recipeId: string,
  userId: number,
): Promise<any[] | null> {
  // Verify ownership
  const [existing] = await db
    .select({ recipeId: recipe.recipeId })
    .from(recipe)
    .where(and(eq(recipe.recipeId, recipeId), eq(recipe.userId, userId)))
    .limit(1);

  if (!existing) return null;

  const versions = await db
    .select({
      versionId: recipeVersion.versionId,
      versionNumber: recipeVersion.versionNumber,
      changeDescription: recipeVersion.changeDescription,
      changeType: recipeVersion.changeType,
      createdDttm: recipeVersion.createdDttm,
    })
    .from(recipeVersion)
    .where(eq(recipeVersion.recipeId, recipeId))
    .orderBy(desc(recipeVersion.versionNumber));

  return versions;
}

/**
 * Get a specific version's full recipe data. Only the owner can view.
 */
export async function getRecipeVersion(
  recipeId: string,
  versionId: string,
  userId: number,
): Promise<any | null> {
  // Verify ownership
  const [existing] = await db
    .select({ recipeId: recipe.recipeId })
    .from(recipe)
    .where(and(eq(recipe.recipeId, recipeId), eq(recipe.userId, userId)))
    .limit(1);

  if (!existing) return null;

  const [version] = await db
    .select()
    .from(recipeVersion)
    .where(
      and(
        eq(recipeVersion.versionId, versionId),
        eq(recipeVersion.recipeId, recipeId),
      ),
    )
    .limit(1);

  return version ?? null;
}

/**
 * Revert a recipe to a previous version. Creates a new version snapshot
 * with changeType "revert" before applying the old data.
 */
export async function revertToVersion(
  recipeId: string,
  versionId: string,
  userId: number,
): Promise<{ recipe: any; versionNumber: number } | null> {
  // Verify ownership
  const [existing] = await db
    .select({ recipeId: recipe.recipeId })
    .from(recipe)
    .where(and(eq(recipe.recipeId, recipeId), eq(recipe.userId, userId)))
    .limit(1);

  if (!existing) return null;

  // Get the target version
  const [targetVersion] = await db
    .select()
    .from(recipeVersion)
    .where(
      and(
        eq(recipeVersion.versionId, versionId),
        eq(recipeVersion.recipeId, recipeId),
      ),
    )
    .limit(1);

  if (!targetVersion) return null;

  // Use updateRecipeContent which handles snapshotting + updating
  return updateRecipeContent(recipeId, userId, {
    recipeData: targetVersion.recipeData as Record<string, unknown>,
    editorialContent: targetVersion.editorialContent ?? undefined,
    changeDescription: `Reverted to version ${targetVersion.versionNumber}`,
    changeType: "revert",
  });
}

/**
 * Permanently delete archived recipes older than `retentionDays`.
 * Called on server startup and periodically.
 */
export async function purgeArchivedRecipes(retentionDays: number): Promise<number> {
  if (retentionDays <= 0) return 0;

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const result = await db
    .delete(recipe)
    .where(
      and(
        eq(recipe.archivedInd, true),
        sql`archived_at < ${cutoff}::timestamp`,
      ),
    )
    .returning({ recipeId: recipe.recipeId });

  if (result.length > 0) {
    logger.info({ purgedCount: result.length, retentionDays }, "Purged archived recipes");
  }
  return result.length;
}
