/**
 * @module services/orgContextService
 *
 * Shared utility for resolving a user's organisation context.
 * Used by Kitchen Operations features (Waste Intelligence, Prep Copilot)
 * to support organisation-level data visibility.
 */

import { db } from "../db/index.js";
import { userOrganisation, organisation } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";

export interface OrgContext {
  orgIds: number[];
  isOrgAdmin: boolean;
  orgMemberUserIds: number[];
  primaryOrgId: number | null;
  primaryOrgName: string | null;
}

/**
 * Resolve a user's organisation context: which orgs they belong to,
 * whether they are an admin, and which other users share those orgs.
 */
export async function getUserOrgContext(userId: number): Promise<OrgContext> {
  // Get user's orgs with roles
  const memberships = await db
    .select({
      organisationId: userOrganisation.organisationId,
      role: userOrganisation.role,
    })
    .from(userOrganisation)
    .where(eq(userOrganisation.userId, userId));

  if (memberships.length === 0) {
    return {
      orgIds: [],
      isOrgAdmin: false,
      orgMemberUserIds: [userId],
      primaryOrgId: null,
      primaryOrgName: null,
    };
  }

  const orgIds = memberships.map((m) => m.organisationId);
  const isOrgAdmin = memberships.some((m) => m.role === "admin");

  // Get all member user IDs in same orgs
  const members = await db
    .select({ userId: userOrganisation.userId })
    .from(userOrganisation)
    .where(inArray(userOrganisation.organisationId, orgIds));

  const orgMemberUserIds = [...new Set(members.map((m) => m.userId))];

  // Get primary org name
  const primaryOrgId = orgIds[0];
  let primaryOrgName: string | null = null;
  if (primaryOrgId) {
    const [org] = await db
      .select({ organisationName: organisation.organisationName })
      .from(organisation)
      .where(eq(organisation.organisationId, primaryOrgId))
      .limit(1);
    primaryOrgName = org?.organisationName ?? null;
  }

  return { orgIds, isOrgAdmin, orgMemberUserIds, primaryOrgId, primaryOrgName };
}
