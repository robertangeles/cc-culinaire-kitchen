/**
 * @module services/organisationService
 *
 * Service layer for organisation management: create, join, leave,
 * and join-key regeneration.
 */

import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { organisation, userOrganisation, user, role, userRole } from "../db/schema.js";
import { encryptOrgPii, decryptOrgPii, decryptUserPii } from "./piiService.js";

/** Generate a short random join key. */
function generateJoinKey(): string {
  return "CULINAIRE-" + crypto.randomBytes(9).toString("base64url").replace(/[^A-Z0-9]/gi, "").slice(0, 12).toUpperCase();
}

/**
 * Pure decision, exported for a direct unit test: does this user still need
 * the Operations Admin system role granted? `user_role` has no unique
 * constraint on (userId, roleId), so a user creating a SECOND organisation
 * must not get a duplicate grant.
 */
export function shouldGrantOperationsAdminRole(existingRoleIds: number[], opsAdminRoleId: number): boolean {
  return !existingRoleIds.includes(opsAdminRoleId);
}

/**
 * Grant the org creator the Operations Admin system role, replacing the old
 * ORG_ADMIN_PERMISSIONS bridge (deleted from authService.ts) with a real,
 * permission-key-based role — the same RBAC system compliance:* and
 * roster:* already use, instead of a hardcoded inventory+purchasing-only grant.
 * Additive, never a replacement: an existing Subscriber/Paid Subscriber role
 * is untouched (stripeService.ts reads those for billing).
 */
async function grantOperationsAdminRole(userId: number): Promise<void> {
  const [opsAdminRole] = await db.select().from(role).where(eq(role.roleName, "Operations Admin"));
  // Guarded, not thrown: an environment where db/seed.ts hasn't run yet
  // degrades to today's behaviour instead of failing org creation.
  if (!opsAdminRole) return;

  const existing = await db.select({ roleId: userRole.roleId }).from(userRole).where(eq(userRole.userId, userId));
  if (shouldGrantOperationsAdminRole(existing.map((r) => r.roleId), opsAdminRole.roleId)) {
    await db.insert(userRole).values({ userId, roleId: opsAdminRole.roleId });
  }
}

/**
 * Pure decision, exported for a direct unit test: should this user's
 * Operations Admin grant be revoked? True once they no longer admin ANY
 * organisation. The deleted ORG_ADMIN_PERMISSIONS bridge was recomputed
 * live on every token mint, straight off current userOrganisation rows, so
 * it dropped automatically the moment a user stopped being an admin
 * anywhere. The role-based replacement is a static user_role row — nothing
 * about holding it is re-derived — so revocation has to be an explicit
 * write instead of falling out of a live read.
 */
export function shouldRevokeOperationsAdminRole(remainingAdminOrgCount: number): boolean {
  return remainingAdminOrgCount === 0;
}

/**
 * Revoke the Operations Admin role from a user who no longer admins any
 * organisation. Called after any write that can end someone's last admin
 * membership — leaveOrganisation, removeMember, and updateMemberRole
 * (demotion) below. Without this, "Remove"/"Make Member" in the UI would
 * imply access is cut off while inventory:manage, purchasing:approve,
 * compliance:manage-rules (global — document_expiry_rule carries no
 * organisationId), roster:manage, etc. silently persisted.
 */
async function revokeOperationsAdminRoleIfNoLongerAdmin(userId: number): Promise<void> {
  const [opsAdminRole] = await db.select().from(role).where(eq(role.roleName, "Operations Admin"));
  if (!opsAdminRole) return;

  const adminMemberships = await db
    .select()
    .from(userOrganisation)
    .where(and(eq(userOrganisation.userId, userId), eq(userOrganisation.role, "admin")));

  if (shouldRevokeOperationsAdminRole(adminMemberships.length)) {
    await db.delete(userRole).where(and(eq(userRole.userId, userId), eq(userRole.roleId, opsAdminRole.roleId)));
  }
}

/** Create a new organisation and add the creator as a member. */
export async function createOrganisation(
  userId: number,
  data: {
    name: string;
    website?: string;
    email?: string;
    phone?: string;
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
    organisationAddressLine1: null,
    organisationAddressLine2: null,
    organisationSuburb: null,
    organisationState: null,
    organisationCountry: null,
    organisationPostcode: null,
  });

  const [org] = await db
    .insert(organisation)
    .values({
      organisationName: data.name,
      organisationWebsite: data.website ?? null,
      organisationEmail: data.email ?? null,
      organisationPhone: data.phone ?? null,
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

  // Add creator as admin member. Still load-bearing on its own: it's what
  // updateMemberRole's last-admin-demotion guard and the client's
  // myOrgRole === "admin" checks key off — a separate axis from the
  // Operations Admin system role granted below.
  await db.insert(userOrganisation).values({
    userId,
    organisationId: org.organisationId,
    role: "admin",
  });

  await grantOperationsAdminRole(userId);

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
  await revokeOperationsAdminRoleIfNoLongerAdmin(userId);
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
      organisationPhone: organisation.organisationPhone,
      organisationFacebook: organisation.organisationFacebook,
      organisationInstagram: organisation.organisationInstagram,
      organisationTiktok: organisation.organisationTiktok,
      organisationPinterest: organisation.organisationPinterest,
      organisationLinkedin: organisation.organisationLinkedin,
      joinKey: organisation.joinKey,
      createdBy: organisation.createdBy,
      organisationLogoPath: organisation.organisationLogoPath,
      organisationColorAccent: organisation.organisationColorAccent,
      defaultTimezone: organisation.defaultTimezone,
      defaultCurrency: organisation.defaultCurrency,
      defaultJurisdiction: organisation.defaultJurisdiction,
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

/**
 * Update organisation details. Authorization (org admin — per-org
 * userOrganisation.role, not the global org:manage-organisation permission)
 * is checked by the caller — see handleUpdateOrganisation's isOrgManager,
 * which matches handleUpdateMemberRole/handleRemoveMember.
 */
export async function updateOrganisation(
  organisationId: number,
  data: {
    name: string;
    website?: string;
    email?: string;
    phone?: string;
    facebook?: string;
    instagram?: string;
    tiktok?: string;
    pinterest?: string;
    linkedin?: string;
    colorAccent?: string;
    defaultTimezone?: string;
    defaultCurrency?: string;
    defaultJurisdiction?: string;
  }
) {
  const org = await getOrganisation(organisationId);
  if (!org) throw new Error("Organisation not found.");

  const orgPii = encryptOrgPii({
    organisationName: data.name,
    organisationEmail: data.email ?? null,
    organisationAddressLine1: null,
    organisationAddressLine2: null,
    organisationSuburb: null,
    organisationState: null,
    organisationCountry: null,
    organisationPostcode: null,
  });

  const [updated] = await db
    .update(organisation)
    .set({
      organisationName: data.name,
      organisationWebsite: data.website ?? null,
      organisationEmail: data.email ?? null,
      organisationPhone: data.phone ?? null,
      organisationFacebook: data.facebook ?? null,
      organisationInstagram: data.instagram ?? null,
      organisationTiktok: data.tiktok ?? null,
      organisationPinterest: data.pinterest ?? null,
      organisationLinkedin: data.linkedin ?? null,
      // Preserved (not nulled) when ABSENT from the request — these are
      // edited from a separate Organisation Settings form and must never be
      // blown away by a submission from the org-details (name/website/
      // social) form above, which never sends them. An explicit "" clears
      // the nullable fields; defaultTimezone/defaultCurrency are NOT NULL
      // so they're only ever preserved or set, never cleared. logoPath is
      // never accepted here at all — see updateOrganisationLogo below, the
      // only legitimate write path (server-derived, upload-validated URL).
      organisationColorAccent: data.colorAccent !== undefined ? data.colorAccent || null : org.organisationColorAccent,
      defaultTimezone: data.defaultTimezone ?? org.defaultTimezone,
      defaultCurrency: data.defaultCurrency ?? org.defaultCurrency,
      defaultJurisdiction: data.defaultJurisdiction !== undefined ? data.defaultJurisdiction || null : org.defaultJurisdiction,
      ...orgPii,
      updatedDttm: new Date(),
    })
    .where(eq(organisation.organisationId, organisationId))
    .returning();

  return updated;
}

/** Set the organisation's logo path after a successful upload (Organisation Settings). */
export async function updateOrganisationLogo(organisationId: number, logoPath: string) {
  const [updated] = await db
    .update(organisation)
    .set({ organisationLogoPath: logoPath, updatedDttm: new Date() })
    .where(eq(organisation.organisationId, organisationId))
    .returning();
  if (!updated) throw new Error("Organisation not found.");
  return updated;
}

/** Get all members of an organisation with decrypted display names. */
export async function getOrganisationMembers(organisationId: number) {
  const rows = await db
    .select({
      userId: user.userId,
      userName: user.userName,
      userPhotoPath: user.userPhotoPath,
      userBio: user.userBio,
      userEmail: user.userEmail,
      // encrypted PII columns for decryption fallback
      userNameEnc: user.userNameEnc,
      userNameIv: user.userNameIv,
      userNameTag: user.userNameTag,
      userEmailEnc: user.userEmailEnc,
      userEmailIv: user.userEmailIv,
      userEmailTag: user.userEmailTag,
      userBioEnc: user.userBioEnc,
      userBioIv: user.userBioIv,
      userBioTag: user.userBioTag,
      role: userOrganisation.role,
    })
    .from(userOrganisation)
    .innerJoin(user, eq(userOrganisation.userId, user.userId))
    .where(eq(userOrganisation.organisationId, organisationId));

  return rows.map((row) => {
    const pii = decryptUserPii(row as unknown as Record<string, unknown>);
    return {
      userId: row.userId,
      displayName: pii.userName || pii.userEmail,
      photoPath: row.userPhotoPath,
      bio: pii.userBio,
      role: row.role,
      joinedAt: null, // userOrganisation table has no timestamp column
    };
  });
}

/** Check whether a user is a member of an organisation, returning the membership row. */
export async function getMembership(userId: number, organisationId: number) {
  const rows = await db
    .select()
    .from(userOrganisation)
    .where(
      and(
        eq(userOrganisation.userId, userId),
        eq(userOrganisation.organisationId, organisationId),
      ),
    );
  return rows[0] ?? null;
}

/** Update a member's role in an organisation. */
export async function updateMemberRole(
  organisationId: number,
  targetUserId: number,
  newRole: string,
) {
  // Prevent demoting the last admin
  if (newRole !== "admin") {
    const admins = await db
      .select()
      .from(userOrganisation)
      .where(
        and(
          eq(userOrganisation.organisationId, organisationId),
          eq(userOrganisation.role, "admin"),
        ),
      );

    const isTargetAdmin = admins.some((a) => a.userId === targetUserId);
    if (isTargetAdmin && admins.length <= 1) {
      throw new Error("Cannot demote the last admin.");
    }
  }

  const [updated] = await db
    .update(userOrganisation)
    .set({ role: newRole })
    .where(
      and(
        eq(userOrganisation.userId, targetUserId),
        eq(userOrganisation.organisationId, organisationId),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error("Member not found in this organisation.");
  }

  if (newRole !== "admin") {
    await revokeOperationsAdminRoleIfNoLongerAdmin(targetUserId);
  }

  return updated;
}

/** Remove a member from an organisation. */
export async function removeMember(organisationId: number, targetUserId: number) {
  const [deleted] = await db
    .delete(userOrganisation)
    .where(
      and(
        eq(userOrganisation.userId, targetUserId),
        eq(userOrganisation.organisationId, organisationId),
      ),
    )
    .returning();

  if (!deleted) {
    throw new Error("Member not found in this organisation.");
  }

  await revokeOperationsAdminRoleIfNoLongerAdmin(targetUserId);
}

/** Regenerate the join key for an organisation (org admins only). */
export async function regenerateJoinKey(userId: number, organisationId: number) {
  const org = await getOrganisation(organisationId);
  if (!org) throw new Error("Organisation not found.");
  const membership = await getMembership(userId, organisationId);
  if (!membership || membership.role !== "admin") {
    throw new Error("Only organisation admins can regenerate the join key.");
  }

  const newKey = generateJoinKey();
  await db
    .update(organisation)
    .set({ joinKey: newKey, updatedDttm: new Date() })
    .where(eq(organisation.organisationId, organisationId));

  return newKey;
}
