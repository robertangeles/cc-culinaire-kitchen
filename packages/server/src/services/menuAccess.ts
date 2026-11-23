/**
 * @module services/menuAccess
 *
 * Who may see and change a menu item. Menu items belong to the organisation: every member reads them, the creator
 * or an admin of that organisation edits them. "The organisation" is the caller's primary one (earliest membership,
 * the rule getUserLocationContext uses), so a user of two organisations works in the first.
 *
 * A row an older server wrote before the organisation column was filled (organisation_id NULL) is visible to its
 * creator only, until scripts/backfillMenuItemOrganisation.ts claims it.
 */

import { and, asc, eq, isNull, or, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { menuItem, userOrganisation } from "../db/schema.js";
import { AppError } from "../utils/appError.js";

export interface MenuScope {
  userId: number;
  /** Null for a user who belongs to no organisation: their own items only. */
  organisationId: number | null;
  /** Admin of `organisationId`. Admin of some other organisation of the user's does not count. */
  isOrgAdmin: boolean;
}

export async function resolveMenuScope(userId: number): Promise<MenuScope> {
  const [primary] = await db
    .select({ organisationId: userOrganisation.organisationId, role: userOrganisation.role })
    .from(userOrganisation)
    .where(eq(userOrganisation.userId, userId))
    .orderBy(asc(userOrganisation.userOrganisationId))
    .limit(1);
  return { userId, organisationId: primary?.organisationId ?? null, isOrgAdmin: primary?.role === "admin" };
}

/** The menu_item rows the caller may read. */
export function menuReadable(scope: MenuScope): SQL {
  const own = and(isNull(menuItem.organisationId), eq(menuItem.userId, scope.userId))!;
  return scope.organisationId === null ? eq(menuItem.userId, scope.userId) : or(eq(menuItem.organisationId, scope.organisationId), own)!;
}

/** 403 FORBIDDEN unless the caller made the item or administers its organisation. The item must already be readable by the caller. */
export function assertCanManageMenuItem(scope: MenuScope, item: { userId: number; organisationId: number | null }): void {
  if (item.userId === scope.userId) return;
  if (scope.isOrgAdmin && item.organisationId === scope.organisationId) return;
  throw new AppError(403, "FORBIDDEN", "Only the person who created this menu item or an organisation admin can change it");
}
