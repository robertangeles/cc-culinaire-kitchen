/**
 * @module services/complianceService
 *
 * Compliance Vault (Phase 1): staff/venue document tracking, a verification
 * queue for HQ, and the org-wide compliance dashboard.
 *
 * Every query is scoped by `organisationId` derived from the authenticated
 * user (never the client) — mirrors orderGuideService's org-scoping: a
 * cross-org document id reads as 404, not 403, so a guessed id never
 * confirms another tenant's data exists.
 *
 * `document_expiry_rule` (+ its alert-day junction) carries NO organisation_id
 * — it is a shared jurisdiction rule library (an RSA renewal cadence in VIC is
 * the same law for every org), effective-dated and versioned per the schema's
 * own doc comment. `organisation_required_document` IS org-scoped and uses the
 * wholesale-replace pattern from orderGuideService.setGuideItems /
 * storageAreaService.setAreaItems.
 *
 * Split into:
 *   - complianceErrors.ts       — ComplianceError class
 *   - complianceDocumentService — document CRUD, dashboard, stats, required docs, report PDF
 *   - complianceExpiryService   — expiry rule library (global, not org-scoped)
 */

export * from "./complianceErrors.js";
export * from "./complianceDocumentService.js";
export * from "./complianceExpiryService.js";
