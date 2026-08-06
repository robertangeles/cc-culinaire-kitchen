/**
 * @module routes/compliance
 *
 * REST endpoints for the Compliance Vault (Phase 1): staff document
 * upload, the HQ verification queue, expiry rules, and the compliance
 * dashboard.
 *
 * All routes require authentication. Permission-gated by:
 *   compliance:read-own     — view/upload your own compliance documents
 *   compliance:read-all     — view compliance documents for all staff
 *   compliance:verify       — approve or reject uploaded documents
 *   compliance:manage-rules — manage expiry rules + org document requirements
 */

import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.js";
import {
  handleListMyDocuments,
  handleCreateDocument,
  handleGetDocument,
  handleListStaffDocuments,
  handleGetDashboard,
  handleGetStats,
  handleListPending,
  handleVerifyDocument,
  handleRejectDocument,
  handleListRules,
  handleUpsertRule,
  handleListRequiredDocuments,
  handleSetRequiredDocuments,
} from "../controllers/complianceController.js";

const router = Router();
router.use(authenticate);

// ─── Documents ────────────────────────────────────────────────────
// Collection routes before parameterized ones — /documents/mine must not be
// swallowed by /documents/:id.

router.get("/documents/mine", requirePermission("compliance:read-own"), handleListMyDocuments);
router.post("/documents", requirePermission("compliance:read-own"), handleCreateDocument);
router.get("/documents/:id", requirePermission("compliance:read-own"), handleGetDocument);
router.get(
  "/staff/:userId/documents",
  requirePermission("compliance:read-all"),
  handleListStaffDocuments,
);

// ─── Dashboard ──────────────────────────────────────────────────

router.get("/dashboard", requirePermission("compliance:read-all"), handleGetDashboard);
router.get("/stats", requirePermission("compliance:read-all"), handleGetStats);

// ─── Verification queue ─────────────────────────────────────────

router.get("/pending", requirePermission("compliance:verify"), handleListPending);
router.post(
  "/documents/:id/verify",
  requirePermission("compliance:verify"),
  handleVerifyDocument,
);
router.post(
  "/documents/:id/reject",
  requirePermission("compliance:verify"),
  handleRejectDocument,
);

// ─── Rules + required documents (admin) ──────────────────────────

router.get("/rules", requirePermission("compliance:manage-rules"), handleListRules);
router.put("/rules", requirePermission("compliance:manage-rules"), handleUpsertRule);
router.get(
  "/required-documents",
  requirePermission("compliance:manage-rules"),
  handleListRequiredDocuments,
);
router.put(
  "/required-documents",
  requirePermission("compliance:manage-rules"),
  handleSetRequiredDocuments,
);

export default router;
