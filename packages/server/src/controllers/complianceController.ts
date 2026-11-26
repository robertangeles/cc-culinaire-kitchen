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
  updateDocument,
  deleteDocument,
  verifyDocument,
  rejectDocument,
  nudgeVerifier,
  getComplianceDashboard,
  listStaffCompliance,
  getComplianceStats,
  listPendingVerification,
  listExpiryRules,
  upsertExpiryRule,
  listRequiredDocuments,
  setRequiredDocuments,
  getComplianceReportData,
  isOwnDocument,
  ComplianceError,
} from "../services/complianceService.js";
import {
  storeDocument,
  signedUrlForDocument,
  DocumentStorageError,
  type AllowedMime,
} from "../services/documentStorageService.js";
import { extractCertificateFields, type OcrResult } from "../services/documentOcrService.js";
import { generateComplianceReportPdf } from "../services/compliancePdfService.js";
import { dayKey } from "../utils/dailyRunClaim.js";

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

/**
 * tesseract.js is an image OCR engine — it does not decode PDF byte streams.
 * Handing it a PDF buffer doesn't reject cleanly: it hangs until the 5s OCR
 * timeout kills the worker thread, so every PDF upload would wait 5s for
 * nothing and force a cold worker start on the next image. Skip OCR for PDFs
 * and let the form fall back to manual entry.
 */
function shouldRunOcr(mime: AllowedMime): boolean {
  return mime !== "application/pdf";
}

/** Optional client-made id: a create whose answer was lost is sent again with it and finds the same document. */
const clientId = z.string().uuid().optional();

const CreateDocumentSchema = z.object({
  complianceDocumentId: clientId,
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

/** CV-E: a venue document has no staff subject — its subject IS the venue. */
const CreateVenueDocumentSchema = z.object({
  complianceDocumentId: clientId,
  documentType: z.string().min(1).max(40),
  storeLocationId: z.string().uuid(),
  documentNumber: z.string().max(100).nullable().optional(),
  issueDate: z.string().min(1).nullable().optional(),
  expiryDate: z.string().min(1).nullable().optional(),
  issuingAuthority: z.string().max(200).nullable().optional(),
  issuingJurisdiction: z.string().max(3).nullable().optional(),
  storagePublicId: z.string().min(1).max(255),
  storageFormat: z.enum(STORAGE_FORMATS).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// notes is deliberately absent — schema.ts documents compliance_document.notes
// as "Manager-only free text. Sanitised before it can reach any model
// prompt." The ownership guard on this route lets the document's SUBJECT
// call it, so accepting notes here would let a staff member overwrite their
// manager's annotation about them, not just their own certificate metadata.
const UpdateDocumentSchema = z.object({
  documentNumber: z.string().max(100).nullable().optional(),
  issueDate: z.string().min(1).nullable().optional(),
  expiryDate: z.string().min(1).nullable().optional(),
  issuingAuthority: z.string().max(200).nullable().optional(),
  issuingJurisdiction: z.string().max(3).nullable().optional(),
});

const RejectDocumentSchema = z.object({
  reason: z.string().min(1, "A rejection reason is required").max(500),
});


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

const ReportQuerySchema = z.object({
  // Omitted = org-wide export. Present-but-cross-org is checked downstream
  // by getComplianceReportData, which 404s rather than 403s (see there).
  storeLocationId: z.string().uuid().optional(),
});

/**
 * What a person is sent about their own document: what they entered, its status and why it was rejected.
 * The manager's notes, who verified it and the retention dates stay on the manager's side.
 */
const STAFF_FIELDS = [
  "complianceDocumentId",
  "documentType",
  "engagementType",
  "documentNumber",
  "issueDate",
  "expiryDate",
  "issuingAuthority",
  "issuingJurisdiction",
  "storagePublicId",
  "storageFormat",
  "verificationStatus",
  "uploadedAt",
  "verifiedAt",
  "rejectionReason",
] as const;

function staffView(doc: Record<(typeof STAFF_FIELDS)[number], unknown>) {
  return Object.fromEntries(STAFF_FIELDS.map((k) => [k, doc[k]]));
}

function handleServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ComplianceError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
  } else if (err instanceof DocumentStorageError) {
    // Storage not set up or not answering: its own status (503/502), never a generic 500.
    res.status(err.status).json({ error: err.message, code: err.code });
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
    res.status(400).json({ error: "You are not a member of any organisation", code: "FORBIDDEN" });
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
    res.json((await listDocumentsForUser(ctx.orgId, req.user!.sub)).map(staffView));
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
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input", code: "VALIDATION" });
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
      { complianceDocumentId: doc.complianceDocumentId, userId: req.user!.sub, replay: doc.replay },
      "Compliance document uploaded",
    );
    res.status(doc.replay ? 200 : 201).json(staffView(doc));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

/**
 * POST /api/compliance/documents/venue (CV-E) — a document whose subject is a
 * venue (liquor licence, food business registration), not a staff member.
 * Gated at compliance:verify, not compliance:read-own — there is no "self"
 * for a venue, so this is a manager action, not a self-upload.
 */
export async function handleCreateVenueDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = CreateVenueDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input", code: "VALIDATION" });
      return;
    }

    const { storeLocationId, ...rest } = parsed.data;
    const { replay, ...doc } = await createDocument(ctx.orgId, {
      ...rest,
      userId: null,
      subjectStoreLocationId: storeLocationId,
      uploadedBy: req.user!.sub,
    });
    logger.info(
      { complianceDocumentId: doc.complianceDocumentId, storeLocationId, userId: req.user!.sub, replay },
      "Venue compliance document uploaded",
    );
    res.status(replay ? 200 : 201).json(doc);
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
      res.status(400).json({ error: "A file is required", code: "VALIDATION" });
      return;
    }

    const { publicId, mime } = await storeDocument(req.file.buffer, ctx.orgId, req.user!.sub);
    // Never throws — a miss just means the form falls back to manual entry.
    const ocr: OcrResult = shouldRunOcr(mime)
      ? await extractCertificateFields(req.file.buffer)
      : {};

    res.json({ storagePublicId: publicId, storageFormat: mimeToStorageFormat(mime), ocr });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}


export async function handleUpdateDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = UpdateDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input", code: "VALIDATION" });
      return;
    }

    const doc = await updateDocument(ctx.orgId, req.params.id as string, req.user!.sub, parsed.data);
    logger.info(
      { complianceDocumentId: doc.complianceDocumentId, userId: req.user!.sub },
      "Compliance document edited",
    );
    res.json(staffView(doc));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleDeleteDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    await deleteDocument(ctx.orgId, req.params.id as string, req.user!.sub);
    logger.info(
      { complianceDocumentId: req.params.id, userId: req.user!.sub },
      "Compliance document deleted",
    );
    res.status(204).end();
  } catch (err) {
    // deleteDocument calls deleteStoredDocument, which can throw a
    // DocumentStorageError (e.g. Cloudinary credentials missing);
    // handleServiceError answers it with its own status and code.
    handleServiceError(err, res, next);
  }
}

/**
 * POST /api/compliance/documents/:id/nudge — the staff member's own-document
 * reminder to whoever holds compliance:verify, once a Pending document has
 * been waiting 48+ hours (CV-C7). All the real rules (ownership, status,
 * age, once-per-24h) live in nudgeVerifier — this just maps its errors.
 */
export async function handleNudgeDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    await nudgeVerifier(ctx.orgId, req.params.id as string, req.user!.sub);
    res.status(204).end();
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

    // An Archived document (offboarding, or a superseded upload) must never
    // mint a signed URL again, regardless of ownership or permission — that
    // refusal is the entire point of archiving on offboard (CV-K1/K2).
    const granted =
      doc.verificationStatus !== "Archived" &&
      (isOwnDocument(doc, req.user!.sub) ||
        hasPermission(req.user!, "compliance:read-all", "compliance:verify"));

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
      res.status(403).json({ error: "You don't have access to this document", code: "FORBIDDEN" });
      return;
    }
    res.json({ url });
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
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input", code: "VALIDATION" });
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
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input", code: "VALIDATION" });
      return;
    }
    const rule = await upsertExpiryRule(parsed.data, req.user!.sub);
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
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input", code: "VALIDATION" });
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

// ─── Report export ────────────────────────────────────────────────

/**
 * GET /api/compliance/report.pdf — the audit-ready export an inspector asks
 * for on-site. Mirrors purchaseOrderController.handleDownloadPOPdf's
 * response pattern (headers, filename, buffer).
 */
export async function handleDownloadComplianceReportPdf(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = ReportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "storeLocationId must be a valid id", code: "VALIDATION" });
      return;
    }

    const data = await getComplianceReportData(ctx.orgId, parsed.data.storeLocationId);
    const buffer = await generateComplianceReportPdf(data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="compliance-report-${dayKey(new Date())}.pdf"`,
    );
    res.send(buffer);
  } catch (err) {
    if (err instanceof Error && err.message.includes("timed out")) {
      res.status(500).json({ error: "PDF generation timed out — please try again", code: "PDF_TIMEOUT" });
      return;
    }
    handleServiceError(err, res, next);
  }
}
