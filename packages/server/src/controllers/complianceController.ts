/**
 * @module controllers/complianceController
 *
 * Input validation + response formatting for the Compliance Vault (Phase 1).
 * `orgId` is always derived from the authenticated user via
 * `getUserLocationContext` — never from the client (CLAUDE.md).
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { getUserLocationContext } from "../services/locationContextService.js";
import { hasPermission } from "../middleware/auth.js";
import {
  listDocumentsForUser,
  getDocument,
  createDocument,
  verifyDocument,
  rejectDocument,
  getComplianceDashboard,
  listStaffCompliance,
  getComplianceStats,
  listPendingVerification,
  listExpiryRules,
  upsertExpiryRule,
  listRequiredDocuments,
  setRequiredDocuments,
  isOwnDocument,
  ComplianceError,
} from "../services/complianceService.js";
import {
  storeDocument,
  signedUrlForDocument,
  DocumentStorageError,
  type AllowedMime,
} from "../services/documentStorageService.js";
import { extractCertificateFields } from "../services/documentOcrService.js";

const logger = pino({ name: "complianceController" });

/** Every value compliance_document.storage_format can hold. */
const STORAGE_FORMATS = ["pdf", "jpg", "png"] as const;
type StorageFormat = (typeof STORAGE_FORMATS)[number];

/** Cloudinary download-URL extension for each mime storeDocument's magic-byte sniff can return. */
const FORMAT_BY_MIME: Record<AllowedMime, StorageFormat> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** Exported for a direct unit test — a stored JPEG must resolve to "jpg", never the old hardcoded "pdf". */
export function mimeToStorageFormat(mime: AllowedMime): StorageFormat {
  return FORMAT_BY_MIME[mime];
}

const CreateDocumentSchema = z.object({
  documentType: z.string().min(1).max(40),
  engagementType: z.enum(["employee", "contractor", "agency"]).optional(),
  documentNumber: z.string().max(100).nullable().optional(),
  issueDate: z.string().min(1).nullable().optional(),
  expiryDate: z.string().min(1).nullable().optional(),
  issuingAuthority: z.string().max(200).nullable().optional(),
  issuingJurisdiction: z.string().max(3).nullable().optional(),
  storagePublicId: z.string().min(1).max(255),
  // Echoed back by the client from the /documents/upload response. Validated
  // against the fixed enum rather than trusted as-is — a forged value only
  // breaks that user's own preview (wrong extension on their own document's
  // signed URL), not another tenant's data, so rejecting via the schema like
  // every other field here is enough.
  storageFormat: z.enum(STORAGE_FORMATS).nullable().optional(),
  storeLocationId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const RejectDocumentSchema = z.object({
  reason: z.string().min(1, "A rejection reason is required").max(500),
});

const StaffIdParamSchema = z.coerce.number().int().positive();

const ExpiryRuleSchema = z.object({
  documentType: z.string().min(1).max(40),
  jurisdiction: z.string().max(3).nullable().optional(),
  validityPeriodYears: z.number().int().positive().nullable().optional(),
  blockRosterOnExpiry: z.boolean().optional(),
  trainingProviderUrl: z.string().max(500).nullable().optional(),
  effectiveFrom: z.string().min(1),
  sourceCitation: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  alertDays: z.array(z.number().int().positive()).max(20).optional(),
});

const RequiredDocumentsSchema = z.object({
  documentTypes: z.array(z.string().min(1).max(40)).max(50),
});

function handleServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ComplianceError) {
    res.status(err.statusCode).json({ error: err.message });
  } else {
    next(err);
  }
}

/**
 * Resolve org from the user's context. Deliberately checks org MEMBERSHIP
 * (`organisationId`), not location assignment (`locations.length`) — a new
 * hire's compliance documents are often uploaded before they're assigned to
 * a location, sometimes as a prerequisite for that assignment.
 */
async function resolveContext(req: Request, res: Response): Promise<{ orgId: number } | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.organisationId === null) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return { orgId: ctx.organisationId };
}

// ─── Documents ──────────────────────────────────────────────────

export async function handleListMyDocuments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await listDocumentsForUser(ctx.orgId, req.user!.sub));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleCreateDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = CreateDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }

    // Self-upload only (compliance:read-own gates this route) — the subject
    // and uploader are ALWAYS the caller, never taken from the client body.
    const doc = await createDocument(ctx.orgId, {
      ...parsed.data,
      userId: req.user!.sub,
      uploadedBy: req.user!.sub,
    });
    logger.info(
      { complianceDocumentId: doc.complianceDocumentId, userId: req.user!.sub },
      "Compliance document uploaded",
    );
    res.status(201).json(doc);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

/**
 * POST /api/compliance/documents/upload — stores the file (private Cloudinary,
 * magic-byte sniffed) and best-effort OCRs it for form pre-fill. This is the
 * pre-step before `POST /documents`, which persists the record; nothing here
 * touches the database.
 */
export async function handleUploadDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    if (!req.file) {
      res.status(400).json({ error: "A file is required" });
      return;
    }

    const { publicId, mime } = await storeDocument(req.file.buffer, ctx.orgId);
    // Never throws — a miss just means the form falls back to manual entry.
    const ocr = await extractCertificateFields(req.file.buffer);

    res.json({ storagePublicId: publicId, storageFormat: mimeToStorageFormat(mime), ocr });
  } catch (err) {
    if (err instanceof DocumentStorageError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function handleGetDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const doc = await getDocument(ctx.orgId, req.params.id as string);
    // compliance:read-own is READ-OWN ONLY. 404 (not 403) so a guessed id
    // never confirms a colleague's document exists.
    if (!isOwnDocument(doc, req.user!.sub)) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json(doc);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

/**
 * GET /api/compliance/documents/:id/view-url — mints a short-lived Cloudinary
 * signed URL for one document. Called by both the staff self-view (own
 * document) and the HQ verification queue (compliance:read-all / :verify).
 *
 * Ownership is not a permission, so it can't be expressed as a single
 * requirePermission() at the router — the route accepts anyone holding ANY
 * of the three perms, and this handler makes the real per-document decision.
 */
export async function handleGetDocumentViewUrl(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    // Cross-org id -> ComplianceError(404) via getDocument, caught below.
    // Never 403 here: a guessed id from another tenant must not confirm
    // the document exists.
    const doc = await getDocument(ctx.orgId, req.params.id as string);

    const granted =
      isOwnDocument(doc, req.user!.sub) ||
      hasPermission(req.user!, "compliance:read-all", "compliance:verify");

    // Always call through — signedUrlForDocument writes the access-log row
    // for denials too, which is the record that matters when investigating
    // who went looking for someone else's document.
    const url = await signedUrlForDocument({
      complianceDocumentId: doc.complianceDocumentId,
      publicId: doc.storagePublicId,
      // doc.storageFormat is the SERVER's magic-byte sniff from upload time
      // (mimeToStorageFormat), persisted by createDocument — never re-derived
      // from the client. Rows uploaded before the storage_format column
      // existed have no recoverable format; "pdf" is the fallback for those,
      // since Cloudinary serves a real PDF as-is and wraps a stored JPG/PNG
      // into a one-page PDF rather than erroring.
      format: doc.storageFormat ?? "pdf",
      actorUserId: req.user!.sub,
      ipAddress: req.ip,
      granted,
    });

    if (!granted) {
      res.status(403).json({ error: "You don't have access to this document" });
      return;
    }
    res.json({ url });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleListStaffDocuments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsedUserId = StaffIdParamSchema.safeParse(req.params.userId);
    if (!parsedUserId.success) {
      res.status(400).json({ error: "A valid staff userId is required" });
      return;
    }
    res.json(await listDocumentsForUser(ctx.orgId, parsedUserId.data));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ─── Dashboard ──────────────────────────────────────────────────

export async function handleGetDashboard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await getComplianceDashboard(ctx.orgId));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

/**
 * GET /api/compliance/staff — the per-staff, per-document-type matrix the
 * dashboard table renders. Gated by compliance:read-all, and the org comes from
 * the authenticated user, never a client-supplied id.
 */
export async function handleListStaffCompliance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await listStaffCompliance(ctx.orgId));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleGetStats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await getComplianceStats(ctx.orgId));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ─── Verification queue ─────────────────────────────────────────

export async function handleListPending(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await listPendingVerification(ctx.orgId));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleVerifyDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const doc = await verifyDocument(ctx.orgId, req.params.id as string, req.user!.sub);
    logger.info(
      { complianceDocumentId: req.params.id, verifierUserId: req.user!.sub },
      "Compliance document verified",
    );
    res.json(doc);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleRejectDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = RejectDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    const doc = await rejectDocument(
      ctx.orgId,
      req.params.id as string,
      req.user!.sub,
      parsed.data.reason,
    );
    logger.info(
      { complianceDocumentId: req.params.id, verifierUserId: req.user!.sub },
      "Compliance document rejected",
    );
    res.json(doc);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ─── Rules + required documents (admin) ──────────────────────────

export async function handleListRules(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await listExpiryRules());
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleUpsertRule(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ExpiryRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    const rule = await upsertExpiryRule(parsed.data);
    logger.info(
      { documentExpiryRuleId: rule.documentExpiryRuleId, userId: req.user!.sub },
      "Compliance expiry rule saved",
    );
    res.status(201).json(rule);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleListRequiredDocuments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await listRequiredDocuments(ctx.orgId));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleSetRequiredDocuments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = RequiredDocumentsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    const types = await setRequiredDocuments(ctx.orgId, parsed.data.documentTypes);
    logger.info(
      { orgId: ctx.orgId, count: types.length, userId: req.user!.sub },
      "Organisation required documents set",
    );
    res.json(types);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}
