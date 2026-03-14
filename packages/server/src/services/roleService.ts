/**
 * @module services/roleService
 *
 * Service layer for role and permission management (admin).
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { role, permission, rolePermission } from "../db/schema.js";

/** List all roles with their permissions. */
export async function listRoles() {
  const roles = await db.select().from(role);

  const enriched = await Promise.all(
    roles.map(async (r) => {
      const perms = await db
        .select({ permissionId: permission.permissionId, permissionKey: permission.permissionKey })
        .from(rolePermission)
        .innerJoin(permission, eq(rolePermission.permissionId, permission.permissionId))
        .where(eq(rolePermission.roleId, r.roleId));

      return { ...r, permissions: perms };
    })
  );

  return enriched;
}

/** Create a new role. */
export async function createRole(name: string, description?: string) {
  const [created] = await db
    .insert(role)
    .values({
      roleName: name,
      roleDescription: description ?? null,
    })
    .returning();

  return created;
}

/** Update a role's name/description. */
export async function updateRole(
  roleId: number,
  data: { roleName?: string; roleDescription?: string }
) {
  await db.update(role).set(data).where(eq(role.roleId, roleId));
}

/** Delete a role and its permission mappings. */
export async function deleteRole(roleId: number) {
  await db.delete(rolePermission).where(eq(rolePermission.roleId, roleId));
  await db.delete(role).where(eq(role.roleId, roleId));
}

/** List all permissions. */
export async function listPermissions() {
  return db.select().from(permission);
}

/** Set permissions for a role (replace all). */
export async function setRolePermissions(roleId: number, permissionIds: number[]) {
  // Remove existing
  await db.delete(rolePermission).where(eq(rolePermission.roleId, roleId));

  // Insert new
  if (permissionIds.length > 0) {
    await db.insert(rolePermission).values(
      permissionIds.map((pid) => ({ roleId, permissionId: pid }))
    );
  }
}
