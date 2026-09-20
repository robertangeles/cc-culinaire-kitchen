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
import multer from "multer";
import { authenticate, requirePermission, requireAdministrator } from "../middleware/auth.js";
import { requireFlag } from "../middleware/requireFlag.js";
import {
  handleListRoles,
  handleCreateRole,
  handleUpdateRole,
  handleDeleteRole,
  handleListRoleDocuments,
  handleSetRoleDocuments,
  handleListShifts,
  handleGetWeekCalendar,
  handleListMyShifts,
  handleCreateShift,
  handleUpdateShift,
  handleCancelShift,
  handleAssignStaff,
  handleListShiftAssignments,
  handleRespondToAssignment,
  handleRemoveAssignment,
  handleListTemplates,
  handleCreateTemplateRow,
  handleUpdateTemplateRow,
  handleDeleteTemplateRow,
  handleGenerateWeekFromTemplate,
  handleUndoGeneration,
  handleListMyAvailability,
  handleListOrgAvailability,
  handleCreateAvailability,
  handleUpdateAvailability,
  handleDeleteAvailability,
  handlePublishRoster,
  handleListPublicHolidays,
  handleCreatePublicHoliday,
  handleDeletePublicHoliday,
  handleRequestConsent,
  handleRespondToConsent,
  handleListAwardRules,
  handleUpsertAwardRule,
  handleAwardRuleCsvPreview,
  handleAwardRuleCsvCommit,
} from "../controllers/rosterController.js";

// Memory storage only, same convention as routes/compliance.ts's
// documentUpload — a CSV of a few hundred rows is well under 1MB.
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1 * 1024 * 1024 } });

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
router.get("/shifts/calendar", requirePermission("roster:read-all"), handleGetWeekCalendar);
router.get("/shifts", requirePermission("roster:read-all"), handleListShifts);
router.post("/shifts", requirePermission("roster:manage"), handleCreateShift);
router.put("/shifts/:id", requirePermission("roster:manage"), handleUpdateShift);
router.post("/shifts/:id/cancel", requirePermission("roster:manage"), handleCancelShift);
router.get("/shifts/:id/assignments", requirePermission("roster:read-all"), handleListShiftAssignments);
router.post("/shifts/:id/assignments", requirePermission("roster:manage"), handleAssignStaff);

// ─── Roster Shift Templates ───────────────────────────────────────
// A saved weekly pattern (role + day-of-week + start/end time), turned into
// real Draft shifts via "Generate this week". See
// docs/designs/roster-scheduling-templates.md.

router.get("/templates", requirePermission("roster:manage"), handleListTemplates);
router.post("/templates", requirePermission("roster:manage"), handleCreateTemplateRow);
router.post("/templates/generate", requirePermission("roster:manage"), handleGenerateWeekFromTemplate);
router.post("/templates/undo-generation", requirePermission("roster:manage"), handleUndoGeneration);
router.patch("/templates/:id", requirePermission("roster:manage"), handleUpdateTemplateRow);
router.delete("/templates/:id", requirePermission("roster:manage"), handleDeleteTemplateRow);

// ─── Assignments ──────────────────────────────────────────────────

router.post("/assignments/:id/respond", requirePermission("roster:read-own"), handleRespondToAssignment);
router.post("/assignments/:id/consent/request", requirePermission("roster:manage"), handleRequestConsent);
router.post("/assignments/:id/consent/respond", requirePermission("roster:read-own"), handleRespondToConsent);
router.delete("/assignments/:id", requirePermission("roster:manage"), handleRemoveAssignment);

// ─── Availability ─────────────────────────────────────────────────

router.get("/availability/mine", requirePermission("roster:read-own"), handleListMyAvailability);
router.get("/availability", requirePermission("roster:read-all"), handleListOrgAvailability);
router.post("/availability", requirePermission("roster:read-own"), handleCreateAvailability);
router.put("/availability/:id", requirePermission("roster:read-own"), handleUpdateAvailability);
router.delete("/availability/:id", requirePermission("roster:read-own"), handleDeleteAvailability);

// ─── Public holidays ──────────────────────────────────────────────
// Admin loader (Settings tab) — same permission for read and write, no
// separate roster:read key exists for this admin-only reference table.

router.get("/public-holidays", requirePermission("roster:manage"), handleListPublicHolidays);
router.post("/public-holidays", requirePermission("roster:manage"), handleCreatePublicHoliday);
router.delete("/public-holidays/:id", requirePermission("roster:manage"), handleDeletePublicHoliday);

// ─── Award rules ────────────────────────────────────────────────────
// Administrator-only (requireAdministrator), not just roster:manage-award-rules
// — award_rule is platform-wide, no-organisationId data, same reasoning as
// the authority-blast-radius fix on compliance/rules (Permissions section
// of the Org Admin plan). Administrator-only until a non-admin owner is
// named (tasks/todo.md) — remove requireAdministrator then, not before.

router.get(
  "/award-rules",
  requirePermission("roster:manage-award-rules"),
  requireAdministrator(),
  handleListAwardRules,
);
router.post(
  "/award-rules",
  requirePermission("roster:manage-award-rules"),
  requireAdministrator(),
  handleUpsertAwardRule,
);
router.post(
  "/award-rules/import/preview",
  requirePermission("roster:manage-award-rules"),
  requireAdministrator(),
  csvUpload.single("file"),
  handleAwardRuleCsvPreview,
);
router.post(
  "/award-rules/import/commit",
  requirePermission("roster:manage-award-rules"),
  requireAdministrator(),
  handleAwardRuleCsvCommit,
);

// ─── Publish ──────────────────────────────────────────────────────

router.post("/publish", requirePermission("roster:publish"), handlePublishRoster);

export default router;
