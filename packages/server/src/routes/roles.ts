/**
 * @module routes/roles
 *
 * Express router for role and permission management (admin), mounted at `/api/roles`.
 */

import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  handleListRoles,
  handleCreateRole,
  handleUpdateRole,
  handleDeleteRole,
  handleListPermissions,
  handleSetRolePermissions,
} from "../controllers/roleController.js";

const router = Router();

// All role routes require Admin
router.use(authenticate, requireRole("Administrator"));

router.get("/", handleListRoles);
router.post("/", handleCreateRole);
router.patch("/:id", handleUpdateRole);
router.delete("/:id", handleDeleteRole);
router.put("/:id/permissions", handleSetRolePermissions);

export default router;
