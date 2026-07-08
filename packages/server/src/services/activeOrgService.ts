/**
 * @module services/activeOrgService
 *
 * Resolves a user's single "active organisation" for the Brain org tier
 * (docs/specs/brain-memory.md T11, spec E-fold #8).
 *
 * The Brain recalls org-shared memories from ONE active org, not every
 * membership — this bounds the exact-scan slice and prevents cross-org bleed.
 * Resolution is deterministic:
 *   (i)   `user.selected_organisation_id` — if it is still a live membership;
 *   (ii)  else the org of `user.selected_location_id` — if that org is a live
 *         membership;
 *   (iii) else the numerically-lowest org id the user is a member of;
 *   (iv)  else null (no memberships).
 *
 * SECURITY (spec E-fold #8, threat "Active-org spoofing" / "ex-member leak"):
 * a stored selection is NEVER returned without an authoritative live-membership
 * recheck. A removed member whose `selected_organisation_id` still points at
 * their old org resolves past it to a live membership (or null), so recall can
 * never surface an org they no longer belong to.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { user, storeLocation } from "../db/schema.js";
import { getUserOrganisationIds } from "./benchService.js";

/**
 * Resolve the user's active organisation id, or null if they have no live
 * membership. The returned id is always a verified current membership.
 */
export async function resolveActiveOrg(userId: number): Promise<number | null> {
  if (!userId || userId <= 0) return null;

  const memberOrgIds = await getUserOrganisationIds(userId);
  if (memberOrgIds.length === 0) return null;
  const memberSet = new Set(memberOrgIds);

  const [row] = await db
    .select({
      selectedOrganisationId: user.selectedOrganisationId,
      selectedLocationId: user.selectedLocationId,
    })
    .from(user)
    .where(eq(user.userId, userId))
    .limit(1);

  // (i) Explicit selection — only if still a live membership.
  if (row?.selectedOrganisationId != null && memberSet.has(row.selectedOrganisationId)) {
    return row.selectedOrganisationId;
  }

  // (ii) Org of the selected location — only if that org is a live membership.
  if (row?.selectedLocationId) {
    const [loc] = await db
      .select({ organisationId: storeLocation.organisationId })
      .from(storeLocation)
      .where(eq(storeLocation.storeLocationId, row.selectedLocationId))
      .limit(1);
    if (loc?.organisationId != null && memberSet.has(loc.organisationId)) {
      return loc.organisationId;
    }
  }

  // (iii) Deterministic fallback: the numerically-lowest live membership.
  return Math.min(...memberOrgIds);
}

/**
 * Persist a user's active-org selection after verifying live membership.
 * Plumbing for T12 / a future org switcher — not route-wired in T11.
 * Throws if the user is not a current member of `organisationId`.
 */
export async function switchOrganisation(userId: number, organisationId: number): Promise<void> {
  const memberOrgIds = await getUserOrganisationIds(userId);
  if (!memberOrgIds.includes(organisationId)) {
    throw new Error("You must be a member of this organisation first.");
  }
  await db
    .update(user)
    .set({ selectedOrganisationId: organisationId })
    .where(eq(user.userId, userId));
}
