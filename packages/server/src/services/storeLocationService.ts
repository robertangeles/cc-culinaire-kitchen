/**
 * @module services/storeLocationService
 *
 * Service layer for store location management: CRUD, staff assignment,
 * store key generation, operating hours, and location pulse.
 */

import crypto from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  storeLocation,
  userStoreLocation,
  userOrganisation,
  user,
  storeLocationHour,
  organisation,
  wasteLog,
  prepSession,
} from "../db/schema.js";
import { encryptPii, decryptPii } from "../utils/crypto.js";
import { decryptUserPii } from "./piiService.js";

// ---------------------------------------------------------------------------
// Store Key Generation
// ---------------------------------------------------------------------------

/** Generate a unique store key with KITCHEN- prefix. */
function generateStoreKey(): string {
  return (
    "KITCHEN-" +
    crypto
      .randomBytes(9)
      .toString("base64url")
      .replace(/[^A-Z0-9]/gi, "")
      .slice(0, 12)
      .toUpperCase()
  );
}

// ---------------------------------------------------------------------------
// Location PII Encryption
// ---------------------------------------------------------------------------

interface LocationAddressFields {
  line1: string | null;
  line2: string | null;
  suburb: string | null;
  state: string | null;
  country: string | null;
  postcode: string | null;
}

interface LocationPiiEncrypted {
  locationNameEnc: string | null;
  locationNameIv: string | null;
  locationNameTag: string | null;
  locationAddressEnc: string | null;
  locationAddressIv: string | null;
  locationAddressTag: string | null;
}

function encryptLocationPii(data: {
  locationName: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  suburb?: string | null;
  state?: string | null;
  country?: string | null;
  postcode?: string | null;
}): LocationPiiEncrypted {
  const nameEnc = encryptPii(data.locationName);

  const addressData: LocationAddressFields = {
    line1: data.addressLine1 ?? null,
    line2: data.addressLine2 ?? null,
    suburb: data.suburb ?? null,
    state: data.state ?? null,
    country: data.country ?? null,
    postcode: data.postcode ?? null,
  };
  const hasAddress = Object.values(addressData).some(Boolean);
  const addressEnc = hasAddress
    ? encryptPii(JSON.stringify(addressData))
    : null;

  return {
    locationNameEnc: nameEnc?.enc ?? null,
    locationNameIv: nameEnc?.iv ?? null,
    locationNameTag: nameEnc?.tag ?? null,
    locationAddressEnc: addressEnc?.enc ?? null,
    locationAddressIv: addressEnc?.iv ?? null,
    locationAddressTag: addressEnc?.tag ?? null,
  };
}

function decryptLocationPii(row: Record<string, unknown>): {
  locationName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  country: string | null;
  postcode: string | null;
} {
  const locationName =
    decryptPii(
      row.locationNameEnc as string | null,
      row.locationNameIv as string | null,
      row.locationNameTag as string | null
    ) ?? (row.locationName as string);

  const addressJson = decryptPii(
    row.locationAddressEnc as string | null,
    row.locationAddressIv as string | null,
    row.locationAddressTag as string | null
  );

  let address: LocationAddressFields;
  if (addressJson) {
    address = JSON.parse(addressJson) as LocationAddressFields;
  } else {
    address = {
      line1: row.addressLine1 as string | null,
      line2: row.addressLine2 as string | null,
      suburb: row.suburb as string | null,
      state: row.state as string | null,
      country: row.country as string | null,
      postcode: row.postcode as string | null,
    };
  }

  return {
    locationName,
    addressLine1: address.line1,
    addressLine2: address.line2,
    suburb: address.suburb,
    state: address.state,
    country: address.country,
    postcode: address.postcode,
  };
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

export interface CreateLocationData {
  locationName: string;
  classification?: string;
  addressLine1?: string;
  addressLine2?: string;
  suburb?: string;
  state?: string;
  country?: string;
  postcode?: string;
  colorAccent?: string;
  photoPath?: string;
}

/** Create a new store location within an organisation. */
export async function createStoreLocation(
  organisationId: number,
  data: CreateLocationData,
  createdBy: number
) {
  const storeKey = generateStoreKey();
  const pii = encryptLocationPii({
    locationName: data.locationName,
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    suburb: data.suburb,
    state: data.state,
    country: data.country,
    postcode: data.postcode,
  });

  const [location] = await db
    .insert(storeLocation)
    .values({
      organisationId,
      locationName: data.locationName,
      classification: data.classification ?? "branch",
      addressLine1: data.addressLine1 ?? null,
      addressLine2: data.addressLine2 ?? null,
      suburb: data.suburb ?? null,
      state: data.state ?? null,
      country: data.country ?? null,
      postcode: data.postcode ?? null,
      ...pii,
      storeKey,
      colorAccent: data.colorAccent ?? null,
      photoPath: data.photoPath ?? null,
      createdBy,
    })
    .returning();

  return location;
}

/** Get a store location by ID with decrypted PII. */
export async function getStoreLocation(storeLocationId: string) {
  const rows = await db
    .select()
    .from(storeLocation)
    .where(eq(storeLocation.storeLocationId, storeLocationId));

  const row = rows[0];
  if (!row) return null;
  const pii = decryptLocationPii(row as unknown as Record<string, unknown>);
  return { ...row, ...pii };
}

/** Get all active store locations for an organisation. */
export async function getOrgStoreLocations(organisationId: number) {
  const rows = await db
    .select()
    .from(storeLocation)
    .where(
      and(
        eq(storeLocation.organisationId, organisationId),
        eq(storeLocation.isActiveInd, true)
      )
    );

  return rows.map((row) => {
    const pii = decryptLocationPii(row as unknown as Record<string, unknown>);
    return { ...row, ...pii };
  });
}

/** Update a store location. */
export async function updateStoreLocation(
  storeLocationId: string,
  data: Partial<CreateLocationData>
) {
  const existing = await getStoreLocation(storeLocationId);
  if (!existing) throw new Error("Store location not found.");

  const updatedName = data.locationName ?? existing.locationName;
  const pii = encryptLocationPii({
    locationName: updatedName,
    addressLine1: data.addressLine1 ?? existing.addressLine1,
    addressLine2: data.addressLine2 ?? existing.addressLine2,
    suburb: data.suburb ?? existing.suburb,
    state: data.state ?? existing.state,
    country: data.country ?? existing.country,
    postcode: data.postcode ?? existing.postcode,
  });

  const [updated] = await db
    .update(storeLocation)
    .set({
      locationName: updatedName,
      classification: data.classification ?? existing.classification,
      addressLine1: data.addressLine1 ?? existing.addressLine1,
      addressLine2: data.addressLine2 ?? existing.addressLine2,
      suburb: data.suburb ?? existing.suburb,
      state: data.state ?? existing.state,
      country: data.country ?? existing.country,
      postcode: data.postcode ?? existing.postcode,
      ...pii,
      colorAccent: data.colorAccent ?? existing.colorAccent,
      photoPath: data.photoPath ?? existing.photoPath,
      updatedDttm: new Date(),
    })
    .where(eq(storeLocation.storeLocationId, storeLocationId))
    .returning();

  return updated;
}

/** Deactivate a store location (cannot deactivate HQ). */
export async function deactivateStoreLocation(storeLocationId: string) {
  const location = await getStoreLocation(storeLocationId);
  if (!location) throw new Error("Store location not found.");
  if (location.classification === "hq") {
    throw new Error("Cannot deactivate the HQ location.");
  }

  // Clear selected_location_id for affected users
  await db
    .update(user)
    .set({ selectedLocationId: null })
    .where(eq(user.selectedLocationId, storeLocationId));

  // Remove all staff assignments
  await db
    .delete(userStoreLocation)
    .where(eq(userStoreLocation.storeLocationId, storeLocationId));

  // Mark as inactive
  const [updated] = await db
    .update(storeLocation)
    .set({ isActiveInd: false, updatedDttm: new Date() })
    .where(eq(storeLocation.storeLocationId, storeLocationId))
    .returning();

  return updated;
}

// ---------------------------------------------------------------------------
// Store Key Operations
// ---------------------------------------------------------------------------

/** Join a store location via store key (self-serve). */
export async function joinStoreLocation(userId: number, storeKey: string) {
  // Look up location by store key
  const locations = await db
    .select()
    .from(storeLocation)
    .where(eq(storeLocation.storeKey, storeKey));

  if (locations.length === 0) {
    throw new Error("Store key not found.");
  }

  const location = locations[0];

  if (!location.isActiveInd) {
    throw new Error("This location is no longer active.");
  }

  // Cross-org guard: verify user is a member of the org that owns this location
  const membership = await db
    .select()
    .from(userOrganisation)
    .where(
      and(
        eq(userOrganisation.userId, userId),
        eq(userOrganisation.organisationId, location.organisationId)
      )
    );

  if (membership.length === 0) {
    throw new Error(
      "You must be a member of this organisation first."
    );
  }

  // Check if already assigned
  const existing = await db
    .select()
    .from(userStoreLocation)
    .where(
      and(
        eq(userStoreLocation.userId, userId),
        eq(userStoreLocation.storeLocationId, location.storeLocationId)
      )
    );

  if (existing.length > 0) {
    throw new Error("You are already assigned to this location.");
  }

  // Create assignment (self-serve: assignedBy = null)
  await db.insert(userStoreLocation).values({
    userId,
    storeLocationId: location.storeLocationId,
    assignedBy: null,
  });

  const pii = decryptLocationPii(
    location as unknown as Record<string, unknown>
  );
  return { ...location, ...pii };
}

/** Regenerate store key for a location. */
export async function regenerateStoreKey(storeLocationId: string) {
  const newKey = generateStoreKey();
  await db
    .update(storeLocation)
    .set({ storeKey: newKey, updatedDttm: new Date() })
    .where(eq(storeLocation.storeLocationId, storeLocationId));
  return newKey;
}

// ---------------------------------------------------------------------------
// Staff Assignment
// ---------------------------------------------------------------------------

/** Assign a staff member to a location (admin-led). */
export async function assignStaffToLocation(
  storeLocationId: string,
  targetUserId: number,
  assignedBy: number
) {
  const location = await getStoreLocation(storeLocationId);
  if (!location) throw new Error("Store location not found.");
  if (!location.isActiveInd) throw new Error("This location is not active.");

  // Verify target user is an org member
  const membership = await db
    .select()
    .from(userOrganisation)
    .where(
      and(
        eq(userOrganisation.userId, targetUserId),
        eq(userOrganisation.organisationId, location.organisationId)
      )
    );

  if (membership.length === 0) {
    throw new Error("User is not a member of this organisation.");
  }

  // Check if already assigned
  const existing = await db
    .select()
    .from(userStoreLocation)
    .where(
      and(
        eq(userStoreLocation.userId, targetUserId),
        eq(userStoreLocation.storeLocationId, storeLocationId)
      )
    );

  if (existing.length > 0) {
    throw new Error("User is already assigned to this location.");
  }

  const [assignment] = await db
    .insert(userStoreLocation)
    .values({
      userId: targetUserId,
      storeLocationId,
      assignedBy,
    })
    .returning();

  return assignment;
}

/** Remove a staff member from a location. */
export async function removeStaffFromLocation(
  storeLocationId: string,
  targetUserId: number
) {
  // If this location is the user's selected location, clear it
  await db
    .update(user)
    .set({ selectedLocationId: null })
    .where(
      and(
        eq(user.userId, targetUserId),
        eq(user.selectedLocationId, storeLocationId)
      )
    );

  const [deleted] = await db
    .delete(userStoreLocation)
    .where(
      and(
        eq(userStoreLocation.userId, targetUserId),
        eq(userStoreLocation.storeLocationId, storeLocationId)
      )
    )
    .returning();

  if (!deleted) {
    throw new Error("User is not assigned to this location.");
  }
}

/** Get all staff assigned to a location with decrypted display info. */
export async function getLocationStaff(storeLocationId: string) {
  const rows = await db
    .select({
      userId: user.userId,
      userName: user.userName,
      userPhotoPath: user.userPhotoPath,
      userBio: user.userBio,
      userEmail: user.userEmail,
      userNameEnc: user.userNameEnc,
      userNameIv: user.userNameIv,
      userNameTag: user.userNameTag,
      userEmailEnc: user.userEmailEnc,
      userEmailIv: user.userEmailIv,
      userEmailTag: user.userEmailTag,
      userBioEnc: user.userBioEnc,
      userBioIv: user.userBioIv,
      userBioTag: user.userBioTag,
      assignedBy: userStoreLocation.assignedBy,
      assignedAtDttm: userStoreLocation.assignedAtDttm,
    })
    .from(userStoreLocation)
    .innerJoin(user, eq(userStoreLocation.userId, user.userId))
    .where(eq(userStoreLocation.storeLocationId, storeLocationId));

  return rows.map((row) => {
    const pii = decryptUserPii(row as unknown as Record<string, unknown>);
    return {
      userId: row.userId,
      displayName: pii.userName || pii.userEmail,
      photoPath: row.userPhotoPath,
      bio: pii.userBio,
      assignedBy: row.assignedBy,
      assignedAt: row.assignedAtDttm,
    };
  });
}

// ---------------------------------------------------------------------------
// Operating Hours
// ---------------------------------------------------------------------------

/** Get operating hours for a store location. */
export async function getLocationHours(storeLocationId: string) {
  return db
    .select()
    .from(storeLocationHour)
    .where(eq(storeLocationHour.storeLocationId, storeLocationId));
}

/** Set operating hours for a store location (upsert all 7 days). */
export async function setLocationHours(
  storeLocationId: string,
  hours: Array<{
    dayOfWeek: number;
    openTime: string;
    closeTime: string;
    isClosed?: boolean;
  }>
) {
  // Delete existing hours and re-insert
  await db
    .delete(storeLocationHour)
    .where(eq(storeLocationHour.storeLocationId, storeLocationId));

  if (hours.length === 0) return [];

  const values = hours.map((h) => ({
    storeLocationId,
    dayOfWeek: h.dayOfWeek,
    openTime: h.openTime,
    closeTime: h.closeTime,
    isClosedInd: h.isClosed ?? false,
  }));

  return db.insert(storeLocationHour).values(values).returning();
}

// ---------------------------------------------------------------------------
// Location Pulse (lightweight aggregate)
// ---------------------------------------------------------------------------

/** Get a lightweight pulse for a store location. */
export async function getLocationPulse(storeLocationId: string) {
  // Staff count
  const staffRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userStoreLocation)
    .where(eq(userStoreLocation.storeLocationId, storeLocationId));

  const staffCount = staffRows[0]?.count ?? 0;

  // Last activity: most recent waste log or prep session
  const lastWaste = await db
    .select({ latest: sql<Date>`max(logged_at)` })
    .from(wasteLog)
    .where(eq(wasteLog.storeLocationId, storeLocationId));

  const lastPrep = await db
    .select({ latest: sql<Date>`max(created_dttm)` })
    .from(prepSession)
    .where(eq(prepSession.storeLocationId, storeLocationId));

  const wasteDate = lastWaste[0]?.latest;
  const prepDate = lastPrep[0]?.latest;

  let lastActivity: Date | null = null;
  if (wasteDate && prepDate) {
    lastActivity = wasteDate > prepDate ? wasteDate : prepDate;
  } else {
    lastActivity = wasteDate ?? prepDate ?? null;
  }

  return { staffCount, lastActivity };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get store locations assigned to a user (direct assignments only). */
export async function getUserStoreLocations(userId: number) {
  const rows = await db
    .select({
      storeLocationId: storeLocation.storeLocationId,
      organisationId: storeLocation.organisationId,
      locationName: storeLocation.locationName,
      classification: storeLocation.classification,
      addressLine1: storeLocation.addressLine1,
      addressLine2: storeLocation.addressLine2,
      suburb: storeLocation.suburb,
      state: storeLocation.state,
      country: storeLocation.country,
      postcode: storeLocation.postcode,
      locationNameEnc: storeLocation.locationNameEnc,
      locationNameIv: storeLocation.locationNameIv,
      locationNameTag: storeLocation.locationNameTag,
      locationAddressEnc: storeLocation.locationAddressEnc,
      locationAddressIv: storeLocation.locationAddressIv,
      locationAddressTag: storeLocation.locationAddressTag,
      storeKey: storeLocation.storeKey,
      colorAccent: storeLocation.colorAccent,
      photoPath: storeLocation.photoPath,
      isActiveInd: storeLocation.isActiveInd,
      createdBy: storeLocation.createdBy,
      createdDttm: storeLocation.createdDttm,
      updatedDttm: storeLocation.updatedDttm,
    })
    .from(userStoreLocation)
    .innerJoin(
      storeLocation,
      eq(userStoreLocation.storeLocationId, storeLocation.storeLocationId)
    )
    .where(
      and(
        eq(userStoreLocation.userId, userId),
        eq(storeLocation.isActiveInd, true)
      )
    );

  return rows.map((row) => {
    const pii = decryptLocationPii(row as unknown as Record<string, unknown>);
    return { ...row, ...pii };
  });
}

/** Check whether a user has access to a location (assigned or org admin). */
export async function hasLocationAccess(
  userId: number,
  storeLocationId: string
): Promise<boolean> {
  // Check direct assignment
  const assignment = await db
    .select()
    .from(userStoreLocation)
    .where(
      and(
        eq(userStoreLocation.userId, userId),
        eq(userStoreLocation.storeLocationId, storeLocationId)
      )
    );

  if (assignment.length > 0) return true;

  // Check org admin status
  const location = await db
    .select({ organisationId: storeLocation.organisationId })
    .from(storeLocation)
    .where(eq(storeLocation.storeLocationId, storeLocationId));

  if (location.length === 0) return false;

  const membership = await db
    .select()
    .from(userOrganisation)
    .where(
      and(
        eq(userOrganisation.userId, userId),
        eq(userOrganisation.organisationId, location[0].organisationId),
        eq(userOrganisation.role, "admin")
      )
    );

  return membership.length > 0;
}
