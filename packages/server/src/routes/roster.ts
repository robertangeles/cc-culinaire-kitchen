/**
 * @module routes/roster
 *
 * REST endpoints for Roster Core (Phase 2, Slice 3): roles, shifts,
 * assignments, staff availability, and publish.
 *
 * Gated on the roster_enabled site_setting (404 when off — see
 * requireFlag's own header comment), then require authentication.
 * Permission-gated by:
 *   roster:read-own — view/respond to your own shifts and availability
 *   roster:read-all — view all shifts and org-wide availability
 *   roster:manage    — create/edit roles, shifts, assignments
 *   roster:publish    — publish a roster
 */

import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { requireFlag } from "../middleware/requireFlag.js";
import {
  handleListRoles,
  handleCreateRole,
  handleUpdateRole,
  handleDeleteRole,
  handleListRoleDocuments,
  handleSetRoleDocuments,
  handleListShifts,
  handleListMyShifts,
  handleCreateShift,
  handleUpdateShift,
  handleCancelShift,
  handleAssignStaff,
  handleListShiftAssignments,
  handleRespondToAssignment,
  handleRemoveAssignment,
  handleListMyAvailability,
  handleListOrgAvailability,
  handleCreateAvailability,
  handleUpdateAvailability,
  handleDeleteAvailability,
  handlePublishRoster,
} from "../controllers/rosterController.js";

const router = Router();
// Ahead of authenticate, on purpose — see routes/compliance.ts's identical
// comment: with the flag off, an unauthenticated prober should see the same
// 404 an authenticated one gets.
router.use(requireFlag("roster_enabled"));
router.use(authenticate);

// ─── Roles ────────────────────────────────────────────────────────
// Collection routes before parameterized ones.

router.get("/roles", requirePermission("roster:read-all"), handleListRoles);
router.post("/roles", requirePermission("roster:manage"), handleCreateRole);
router.put("/roles/:id", requirePermission("roster:manage"), handleUpdateRole);
router.delete("/roles/:id", requirePermission("roster:manage"), handleDeleteRole);
router.get("/roles/:id/documents", requirePermission("roster:read-all"), handleListRoleDocuments);
router.put("/roles/:id/documents", requirePermission("roster:manage"), handleSetRoleDocuments);

// ─── Shifts ───────────────────────────────────────────────────────

router.get("/shifts/mine", requirePermission("roster:read-own"), handleListMyShifts);
router.get("/shifts", requirePermission("roster:read-all"), handleListShifts);
router.post("/shifts", requirePermission("roster:manage"), handleCreateShift);
router.put("/shifts/:id", requirePermission("roster:manage"), handleUpdateShift);
router.post("/shifts/:id/cancel", requirePermission("roster:manage"), handleCancelShift);
router.get("/shifts/:id/assignments", requirePermission("roster:read-all"), handleListShiftAssignments);
router.post("/shifts/:id/assignments", requirePermission("roster:manage"), handleAssignStaff);

// ─── Assignments ──────────────────────────────────────────────────

router.post("/assignments/:id/respond", requirePermission("roster:read-own"), handleRespondToAssignment);
router.delete("/assignments/:id", requirePermission("roster:manage"), handleRemoveAssignment);

// ─── Availability ─────────────────────────────────────────────────

router.get("/availability/mine", requirePermission("roster:read-own"), handleListMyAvailability);
router.get("/availability", requirePermission("roster:read-all"), handleListOrgAvailability);
router.post("/availability", requirePermission("roster:read-own"), handleCreateAvailability);
router.put("/availability/:id", requirePermission("roster:read-own"), handleUpdateAvailability);
router.delete("/availability/:id", requirePermission("roster:read-own"), handleDeleteAvailability);

// ─── Publish ──────────────────────────────────────────────────────

router.post("/publish", requirePermission("roster:publish"), handlePublishRoster);

export default router;
