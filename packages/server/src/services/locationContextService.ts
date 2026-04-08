/**
 * @module services/locationContextService
 *
 * Resolves a user's store location context: assigned locations,
 * selected location, admin bypass, and per-module memory.
 *
 * Used by Kitchen Ops modules to scope data by location.
 */

import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  user,
  userOrganisation,
  userStoreLocation,
  userLocationPreference,
  storeLocation,
} from "../db/schema.js";
import {
  getUserStoreLocations,
  getOrgStoreLocations,
} from "./storeLocationService.js";

export interface LocationContext {
  /** All locations the user has access to (assigned + admin access) */
  locations: Array<{
    storeLocationId: string;
    organisationId: number;
    locationName: string;
    classification: string;
    colorAccent: string | null;
    photoPath: string | null;
  }>;
  /** Currently selected location (resolved from DB preference) */
  selectedLocationId: string | null;
  /** Whether the user is an org admin (implicit access to all locations) */
  isOrgAdmin: boolean;
  /** Whether the user has at least one location (or is admin) */
  hasLocationAccess: boolean;
}

/**
 * Resolve a user's full location context.
 * Org admins get all org locations; regular staff get their assignments.
 */
export async function getUserLocationContext(
  userId: number
): Promise<LocationContext> {
  // Get user's org memberships
  const memberships = await db
    .select({
      organisationId: userOrganisation.organisationId,
      role: userOrganisation.role,
    })
    .from(userOrganisation)
    .where(eq(userOrganisation.userId, userId));

  if (memberships.length === 0) {
    return {
      locations: [],
      selectedLocationId: null,
      isOrgAdmin: false,
      hasLocationAccess: false,
    };
  }

  const isOrgAdmin = memberships.some((m) => m.role === "admin");
  const primaryOrgId = memberships[0].organisationId;

  // Get locations based on role
  let locations;
  if (isOrgAdmin) {
    // Admin sees all org locations
    const allLocations = await getOrgStoreLocations(primaryOrgId);
    locations = allLocations.map((loc) => ({
      storeLocationId: loc.storeLocationId,
      organisationId: loc.organisationId,
      locationName: loc.locationName,
      classification: loc.classification,
      colorAccent: loc.colorAccent,
      photoPath: loc.photoPath,
    }));
  } else {
    // Staff sees only assigned locations
    const assigned = await getUserStoreLocations(userId);
    locations = assigned.map((loc) => ({
      storeLocationId: loc.storeLocationId,
      organisationId: loc.organisationId,
      locationName: loc.locationName,
      classification: loc.classification,
      colorAccent: loc.colorAccent,
      photoPath: loc.photoPath,
    }));
  }

  // Get selected location from user record
  const userRows = await db
    .select({ selectedLocationId: user.selectedLocationId })
    .from(user)
    .where(eq(user.userId, userId));

  let selectedLocationId = userRows[0]?.selectedLocationId ?? null;

  // Validate selected location is still accessible
  if (
    selectedLocationId &&
    !locations.some((l) => l.storeLocationId === selectedLocationId)
  ) {
    // Stale selection — auto-fallback to first location
    selectedLocationId = locations[0]?.storeLocationId ?? null;
    if (selectedLocationId) {
      await db
        .update(user)
        .set({ selectedLocationId })
        .where(eq(user.userId, userId));
    }
  }

  // If no selection but has locations, auto-select HQ or first
  if (!selectedLocationId && locations.length > 0) {
    const hq = locations.find((l) => l.classification === "hq");
    selectedLocationId = hq?.storeLocationId ?? locations[0].storeLocationId;
    await db
      .update(user)
      .set({ selectedLocationId })
      .where(eq(user.userId, userId));
  }

  return {
    locations,
    selectedLocationId,
    isOrgAdmin,
    hasLocationAccess: isOrgAdmin || locations.length > 0,
  };
}

/**
 * Resolve the selected location for a specific module.
 * Checks per-module preference first, falls back to global selection.
 */
export async function resolveSelectedLocation(
  userId: number,
  moduleKey?: string
): Promise<string | null> {
  if (moduleKey) {
    const prefs = await db
      .select({ storeLocationId: userLocationPreference.storeLocationId })
      .from(userLocationPreference)
      .where(
        and(
          eq(userLocationPreference.userId, userId),
          eq(userLocationPreference.moduleKey, moduleKey)
        )
      );

    if (prefs.length > 0) {
      return prefs[0].storeLocationId;
    }
  }

  // Fall back to global selection
  const userRows = await db
    .select({ selectedLocationId: user.selectedLocationId })
    .from(user)
    .where(eq(user.userId, userId));

  return userRows[0]?.selectedLocationId ?? null;
}

/**
 * Switch the user's selected location. Updates both the global
 * selection and the per-module preference if moduleKey is provided.
 */
export async function switchLocation(
  userId: number,
  storeLocationId: string,
  moduleKey?: string
) {
  // Update global selection
  await db
    .update(user)
    .set({ selectedLocationId: storeLocationId })
    .where(eq(user.userId, userId));

  // Update per-module preference if provided
  if (moduleKey) {
    await updateModulePreference(userId, moduleKey, storeLocationId);
  }
}

/**
 * Update the per-module location preference (upsert).
 */
export async function updateModulePreference(
  userId: number,
  moduleKey: string,
  storeLocationId: string
) {
  // Check if preference exists
  const existing = await db
    .select()
    .from(userLocationPreference)
    .where(
      and(
        eq(userLocationPreference.userId, userId),
        eq(userLocationPreference.moduleKey, moduleKey)
      )
    );

  if (existing.length > 0) {
    await db
      .update(userLocationPreference)
      .set({ storeLocationId, updatedDttm: new Date() })
      .where(
        and(
          eq(userLocationPreference.userId, userId),
          eq(userLocationPreference.moduleKey, moduleKey)
        )
      );
  } else {
    await db.insert(userLocationPreference).values({
      userId,
      moduleKey,
      storeLocationId,
    });
  }
}
