/**
 * @module controllers/roleController
 *
 * Express handlers for role and permission management (admin).
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listPermissions,
  setRolePermissions,
} from "../services/roleService.js";

/** GET /api/roles — list all roles with permissions. */
export async function handleListRoles(_req: Request, res: Response, next: NextFunction) {
  try {
    const roles = await listRoles();
    res.json({ roles });
  } catch (err) {
    next(err);
  }
}

const CreateRoleSchema = z.object({
  roleName: z.string().min(1).max(50),
  roleDescription: z.string().max(500).optional(),
});

/** POST /api/roles — create a role. */
export async function handleCreateRole(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = CreateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const role = await createRole(parsed.data.roleName, parsed.data.roleDescription);
    res.status(201).json({ role });
  } catch (err) {
    next(err);
  }
}

const UpdateRoleSchema = z.object({
  roleName: z.string().min(1).max(50).optional(),
  roleDescription: z.string().max(500).optional(),
});

/** PATCH /api/roles/:id — update a role. */
export async function handleUpdateRole(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = UpdateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    await updateRole(parseInt(req.params.id), parsed.data);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/roles/:id — delete a role. */
export async function handleDeleteRole(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteRole(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/** GET /api/permissions — list all permissions. */
export async function handleListPermissions(_req: Request, res: Response, next: NextFunction) {
  try {
    const permissions = await listPermissions();
    res.json({ permissions });
  } catch (err) {
    next(err);
  }
}

const SetPermissionsSchema = z.object({
  permissionIds: z.array(z.number().int()),
});

/** PUT /api/roles/:id/permissions — set permissions for a role. */
export async function handleSetRolePermissions(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = SetPermissionsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    await setRolePermissions(parseInt(req.params.id), parsed.data.permissionIds);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
