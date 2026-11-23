/**
 * @module services/menuAccess
 *
 * Who may see and change a menu item. Menu items belong to the organisation: every member reads them, the creator
 * or an admin of that organisation edits them. "The organisation" is the caller's primary one (earliest membership,
 * the rule getUserLocationContext uses), so a user of two organisations works in the first.
 *
 * A row with no organisation (organisation_id NULL: written by an older server, or by a person who belongs to none)
 * is visible to its creator only. It is given the creator's organisation when they create or join one
 * (claimMenuItems), and by scripts/backfillMenuItemOrganisation.ts. A person who leaves an organisation leaves its
 * items behind, including the ones they created.
 */

import { and, asc, eq, isNull, or, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import type { DbOrTx } from "./auditService.js";
import { menuItem, userOrganisation } from "../db/schema.js";
import { AppError } from "../utils/appError.js";

export interface MenuScope {
  userId: number;
  /** Null for a user who belongs to no organisation: their own items only. */
  organisationId: number | null;
  /** Admin of `organisationId`. Admin of some other organisation of the user's does not count. */
  isOrgAdmin: boolean;
}

export async function resolveMenuScope(userId: number, db_: DbOrTx = db): Promise<MenuScope> {
  const [primary] = await db_
    .select({ organisationId: userOrganisation.organisationId, role: userOrganisation.role })
    .from(userOrganisation)
    .where(eq(userOrganisation.userId, userId))
    .orderBy(asc(userOrganisation.userOrganisationId))
    .limit(1);
  return { userId, organisationId: primary?.organisationId ?? null, isOrgAdmin: primary?.role === "admin" };
}

/**
 * Gives the user's menu items that have no organisation their primary one. Run in the transaction that adds a
 * membership, after the insert. Only NULL rows change, so a repeat changes nothing.
 */
export async function claimMenuItems(tx: DbOrTx, userId: number): Promise<void> {
  const { organisationId } = await resolveMenuScope(userId, tx);
  if (organisationId === null) return;
  await tx.update(menuItem).set({ organisationId }).where(and(eq(menuItem.userId, userId), isNull(menuItem.organisationId)));
}

/** The menu_item rows the caller may read. */
export function menuReadable(scope: MenuScope): SQL {
  const own = and(isNull(menuItem.organisationId), eq(menuItem.userId, scope.userId))!;
  return scope.organisationId === null ? own : or(eq(menuItem.organisationId, scope.organisationId), own)!;
}

/** 403 FORBIDDEN unless the caller made the item or administers its organisation. The item must already be readable by the caller. */
export function assertCanManageMenuItem(scope: MenuScope, item: { userId: number; organisationId: number | null }): void {
  if (item.userId === scope.userId && (item.organisationId === null || item.organisationId === scope.organisationId)) return;
  if (scope.isOrgAdmin && item.organisationId === scope.organisationId) return;
  throw new AppError(403, "FORBIDDEN", "Only the person who created this menu item or an organisation admin can change it");
}
