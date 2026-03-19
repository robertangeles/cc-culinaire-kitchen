/**
 * @module services/organisationService
 *
 * Service layer for organisation management: create, join, leave,
 * and join-key regeneration.
 */

import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { organisation, userOrganisation } from "../db/schema.js";
import { encryptOrgPii, decryptOrgPii } from "./piiService.js";

/** Generate a short random join key. */
function generateJoinKey(): string {
  return "CULINAIRE-" + crypto.randomBytes(9).toString("base64url").replace(/[^A-Z0-9]/gi, "").slice(0, 12).toUpperCase();
}

/** Create a new organisation and add the creator as a member. */
export async function createOrganisation(
  userId: number,
  data: {
    name: string;
    addressLine1?: string;
    addressLine2?: string;
    suburb?: string;
    state?: string;
    country?: string;
    postcode?: string;
    website?: string;
    email?: string;
    facebook?: string;
    instagram?: string;
    tiktok?: string;
    pinterest?: string;
    linkedin?: string;
  }
) {
  const joinKey = generateJoinKey();

  // Encrypt organisation PII (dual-write: plaintext + encrypted)
  const orgPii = encryptOrgPii({
    organisationName: data.name,
    organisationEmail: data.email ?? null,
    organisationAddressLine1: data.addressLine1 ?? null,
    organisationAddressLine2: data.addressLine2 ?? null,
    organisationSuburb: data.suburb ?? null,
    organisationState: data.state ?? null,
    organisationCountry: data.country ?? null,
    organisationPostcode: data.postcode ?? null,
  });

  const [org] = await db
    .insert(organisation)
    .values({
      organisationName: data.name,
      organisationAddressLine1: data.addressLine1 ?? null,
      organisationAddressLine2: data.addressLine2 ?? null,
      organisationSuburb: data.suburb ?? null,
      organisationState: data.state ?? null,
      organisationCountry: data.country ?? null,
      organisationPostcode: data.postcode ?? null,
      organisationWebsite: data.website ?? null,
      organisationEmail: data.email ?? null,
      organisationFacebook: data.facebook ?? null,
      organisationInstagram: data.instagram ?? null,
      organisationTiktok: data.tiktok ?? null,
      organisationPinterest: data.pinterest ?? null,
      organisationLinkedin: data.linkedin ?? null,
      ...orgPii,
      joinKey,
      createdBy: userId,
    })
    .returning();

  // Add creator as admin member
  await db.insert(userOrganisation).values({
    userId,
    organisationId: org.organisationId,
    role: "admin",
  });

  return org;
}

/** Join an organisation via join key. */
export async function joinOrganisation(userId: number, joinKey: string) {
  const orgs = await db
    .select()
    .from(organisation)
    .where(eq(organisation.joinKey, joinKey));

  if (orgs.length === 0) {
    throw new Error("Invalid join key.");
  }

  const org = orgs[0];

  // Check if already a member
  const existing = await db
    .select()
    .from(userOrganisation)
    .where(
      and(
        eq(userOrganisation.userId, userId),
        eq(userOrganisation.organisationId, org.organisationId)
      )
    );

  if (existing.length > 0) {
    throw new Error("You are already a member of this organisation.");
  }

  await db.insert(userOrganisation).values({
    userId,
    organisationId: org.organisationId,
  });

  return org;
}

/** Leave an organisation. */
export async function leaveOrganisation(userId: number, organisationId: number) {
  await db
    .delete(userOrganisation)
    .where(
      and(
        eq(userOrganisation.userId, userId),
        eq(userOrganisation.organisationId, organisationId)
      )
    );
}

/** Get organisation details by ID. */
export async function getOrganisation(organisationId: number) {
  const rows = await db
    .select()
    .from(organisation)
    .where(eq(organisation.organisationId, organisationId));

  const row = rows[0];
  if (!row) return null;
  const pii = decryptOrgPii(row as Record<string, unknown>);
  return { ...row, ...pii };
}

/** Get the organisation a user belongs to (first one). */
export async function getUserOrganisation(userId: number) {
  const rows = await db
    .select({
      organisationId: organisation.organisationId,
      organisationName: organisation.organisationName,
      organisationAddressLine1: organisation.organisationAddressLine1,
      organisationAddressLine2: organisation.organisationAddressLine2,
      organisationSuburb: organisation.organisationSuburb,
      organisationState: organisation.organisationState,
      organisationCountry: organisation.organisationCountry,
      organisationPostcode: organisation.organisationPostcode,
      organisationWebsite: organisation.organisationWebsite,
      organisationEmail: organisation.organisationEmail,
      organisationFacebook: organisation.organisationFacebook,
      organisationInstagram: organisation.organisationInstagram,
      organisationTiktok: organisation.organisationTiktok,
      organisationPinterest: organisation.organisationPinterest,
      organisationLinkedin: organisation.organisationLinkedin,
      joinKey: organisation.joinKey,
      createdBy: organisation.createdBy,
    })
    .from(userOrganisation)
    .innerJoin(
      organisation,
      eq(userOrganisation.organisationId, organisation.organisationId)
    )
    .where(eq(userOrganisation.userId, userId));

  const row = rows[0];
  if (!row) return null;
  const pii = decryptOrgPii(row as Record<string, unknown>);
  return { ...row, ...pii };
}

/** Update organisation details (creator only). */
export async function updateOrganisation(
  userId: number,
  organisationId: number,
  data: {
    name: string;
    addressLine1?: string;
    addressLine2?: string;
    suburb?: string;
    state?: string;
    country?: string;
    postcode?: string;
    website?: string;
    email?: string;
    facebook?: string;
    instagram?: string;
    tiktok?: string;
    pinterest?: string;
    linkedin?: string;
  }
) {
  const org = await getOrganisation(organisationId);
  if (!org) throw new Error("Organisation not found.");
  if (org.createdBy !== userId) throw new Error("Only the creator can update the organisation.");

  const orgPii = encryptOrgPii({
    organisationName: data.name,
    organisationEmail: data.email ?? null,
    organisationAddressLine1: data.addressLine1 ?? null,
    organisationAddressLine2: data.addressLine2 ?? null,
    organisationSuburb: data.suburb ?? null,
    organisationState: data.state ?? null,
    organisationCountry: data.country ?? null,
    organisationPostcode: data.postcode ?? null,
  });

  const [updated] = await db
    .update(organisation)
    .set({
      organisationName: data.name,
      organisationAddressLine1: data.addressLine1 ?? null,
      organisationAddressLine2: data.addressLine2 ?? null,
      organisationSuburb: data.suburb ?? null,
      organisationState: data.state ?? null,
      organisationCountry: data.country ?? null,
      organisationPostcode: data.postcode ?? null,
      organisationWebsite: data.website ?? null,
      organisationEmail: data.email ?? null,
      organisationFacebook: data.facebook ?? null,
      organisationInstagram: data.instagram ?? null,
      organisationTiktok: data.tiktok ?? null,
      organisationPinterest: data.pinterest ?? null,
      organisationLinkedin: data.linkedin ?? null,
      ...orgPii,
      updatedDttm: new Date(),
    })
    .where(eq(organisation.organisationId, organisationId))
    .returning();

  return updated;
}

/** Regenerate the join key for an organisation (owner only). */
export async function regenerateJoinKey(userId: number, organisationId: number) {
  const org = await getOrganisation(organisationId);
  if (!org) throw new Error("Organisation not found.");
  if (org.createdBy !== userId) throw new Error("Only the creator can regenerate the join key.");

  const newKey = generateJoinKey();
  await db
    .update(organisation)
    .set({ joinKey: newKey, updatedDttm: new Date() })
    .where(eq(organisation.organisationId, organisationId));

  return newKey;
}
