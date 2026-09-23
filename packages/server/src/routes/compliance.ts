/**
 * @module routes/compliance
 *
 * REST endpoints for the Compliance Vault (Phase 1): staff document
 * upload, the HQ verification queue, expiry rules, and the compliance
 * dashboard.
 *
 * Gated on the compliance_enabled site_setting (404 when off — see
 * requireFlag's own header comment), then require authentication.
 * Permission-gated by:
 *   compliance:read-own     — view/upload your own compliance documents
 *   compliance:read-all     — view compliance documents for all staff
 *   compliance:verify       — approve or reject uploaded documents
 *   compliance:manage-rules — manage expiry rules + org document requirements
 */

import { Router } from "express";
import multer from "multer";
import { authenticate, requirePermission, requireAdministrator } from "../middleware/auth.js";
import { requireFlag } from "../middleware/requireFlag.js";
import {
  complianceDocumentEditRateLimit,
  complianceDocumentViewRateLimit,
  complianceReportRateLimit,
} from "../middleware/rateLimiter.js";
import {
  handleListMyDocuments,
  handleCreateDocument,
  handleUpdateDocument,
  handleDeleteDocument,
  handleNudgeDocument,
  handleCreateVenueDocument,
  handleUploadDocument,
  handleGetDocument,
  handleGetDocumentViewUrl,
  handleListStaffDocuments,
  handleGetDashboard,
  handleListStaffCompliance,
  handleGetStats,
  handleListPending,
  handleVerifyDocument,
  handleRejectDocument,
  handleListRules,
  handleUpsertRule,
  handleListRequiredDocuments,
  handleSetRequiredDocuments,
  handleDownloadComplianceReportPdf,
} from "../controllers/complianceController.js";

const router = Router();
// Ahead of authenticate, on purpose: with the flag off, an unauthenticated
// prober should see the same 404 an authenticated one gets — the route looks
// entirely absent, not merely locked behind a login. See requireFlag's own
// header comment for why this retrofit exists and why it fails closed.
router.use(requireFlag("compliance_enabled"));
router.use(authenticate);

/**
 * Memory storage only — documentStorageService.storeDocument() reads the
 * buffer directly. NEVER route this through middleware/upload.ts's
 * uploadFileBuffer(): that helper silently falls back to writing world-
 * readable local disk when Cloudinary credentials are missing, which for a
 * police check or Medicare card is a notifiable data breach (see
 * documentStorageService.ts's header comment). 10 MB matches that module's
 * image-upload convention — compliance certs are a photo or a one-page PDF,
 * not the 100 MB knowledge-base document case.
 */
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── Documents ────────────────────────────────────────────────────
// Collection routes before parameterized ones — /documents/mine must not be
// swallowed by /documents/:id.

router.get("/documents/mine", requirePermission("compliance:read-own"), handleListMyDocuments);
router.post("/documents", requirePermission("compliance:read-own"), handleCreateDocument);
// CV-E: a venue document has no staff subject, so it's gated on verify (a
// manager action), not read-own (which is a staff-subject self-upload).
router.post(
  "/documents/venue",
  requirePermission("compliance:verify"),
  complianceDocumentEditRateLimit,
  handleCreateVenueDocument,
);
router.post(
  "/documents/upload",
  requirePermission("compliance:read-own"),
  documentUpload.single("file"),
  handleUploadDocument,
);
router.get("/documents/:id", requirePermission("compliance:read-own"), handleGetDocument);
router.put(
  "/documents/:id",
  requirePermission("compliance:read-own"),
  complianceDocumentEditRateLimit,
  handleUpdateDocument,
);
router.delete(
  "/documents/:id",
  requirePermission("compliance:read-own"),
  complianceDocumentEditRateLimit,
  handleDeleteDocument,
);
router.post(
  "/documents/:id/nudge",
  requirePermission("compliance:read-own"),
  complianceDocumentEditRateLimit,
  handleNudgeDocument,
);
router.get(
  "/documents/:id/view-url",
  // Ownership (not just permission) decides access — see the handler.
  // Broadest OR of every permission that could legitimately reach this
  // route: self-view (read-own) and manager review (read-all / verify).
  requirePermission("compliance:read-own", "compliance:read-all", "compliance:verify"),
  complianceDocumentViewRateLimit,
  handleGetDocumentViewUrl,
);
router.get(
  "/staff/:userId/documents",
  requirePermission("compliance:read-all"),
  handleListStaffDocuments,
);

// ─── Dashboard ──────────────────────────────────────────────────

router.get("/dashboard", requirePermission("compliance:read-all"), handleGetDashboard);
router.get("/staff", requirePermission("compliance:read-all"), handleListStaffCompliance);
router.get("/stats", requirePermission("compliance:read-all"), handleGetStats);
router.get(
  "/report.pdf",
  requirePermission("compliance:read-all"),
  complianceReportRateLimit,
  handleDownloadComplianceReportPdf,
);

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

// Administrator-only (requireAdministrator), not just compliance:manage-rules
// — document_expiry_rule is platform-wide, no-organisationId data.
// compliance:manage-rules is ALSO granted to Operations Admin (a
// single-org role), which the outside-voice authority-blast-radius finding
// caught: wiring a UI onto this permission alone would let any org's
// Operations Admin edit rules that apply to every org on the platform.
// compliance:manage-rules stays unweakened for its OTHER use
// (RequiredDocumentsTab, genuinely org-scoped) — only this route gets the
// extra gate.
router.get(
  "/rules",
  requirePermission("compliance:manage-rules"),
  requireAdministrator(),
  handleListRules,
);
router.put(
  "/rules",
  requirePermission("compliance:manage-rules"),
  requireAdministrator(),
  handleUpsertRule,
);
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
