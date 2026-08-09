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
 */

import { eq, and, isNull, sql, asc, desc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  complianceDocument,
  documentExpiryRule,
  documentExpiryRuleAlertDay,
  organisationRequiredDocument,
  organisation,
  user,
  userOrganisation,
  storeLocation,
} from "../db/schema.js";
import * as auditService from "./auditService.js";
import { readLastRun, dayKey } from "../utils/dailyRunClaim.js";
import { complianceStorageFolder } from "./documentStorageService.js";
import type {
  ComplianceReportPdfData,
  ComplianceReportStaffRow,
  EngagementType,
} from "./compliancePdfService.js";

export class ComplianceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "ComplianceError";
  }
}

/** Name the daily expiry-scan job writes to via `runIfClaimed` — read here as the admin heartbeat. */
const EXPIRY_SCAN_JOB = "compliance_expiry_scan";

// ── Org-scoping helpers ──────────────────────────────────────────────

/** Assert the location belongs to the caller's org. Cross-org ids read as absent. */
async function assertLocationInOrg(locationId: string, orgId: number): Promise<void> {
  const [loc] = await db
    .select({ id: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(
      and(eq(storeLocation.storeLocationId, locationId), eq(storeLocation.organisationId, orgId)),
    );
  if (!loc) throw new ComplianceError("Location not found", 404);
}

/** Assert the staff member belongs to the caller's org. */
async function assertUserInOrg(userId: number, orgId: number): Promise<void> {
  const [row] = await db
    .select({ id: userOrganisation.userId })
    .from(userOrganisation)
    .where(and(eq(userOrganisation.userId, userId), eq(userOrganisation.organisationId, orgId)));
  if (!row) throw new ComplianceError("Staff member not found", 404);
}

/** Load a document, scoped to the caller's org. Cross-org id is a 404, not a 403. */
async function getDocumentRow(orgId: number, documentId: string) {
  const [doc] = await db
    .select()
    .from(complianceDocument)
    .where(
      and(
        eq(complianceDocument.complianceDocumentId, documentId),
        eq(complianceDocument.organisationId, orgId),
      ),
    );
  if (!doc) throw new ComplianceError("Document not found", 404);
  return doc;
}

/**
 * Pure ownership guard for `GET /documents/:id` (`compliance:read-own`).
 *
 * The permission gate only proves the caller can read THEIR OWN documents —
 * it says nothing about which document id they typed in. Without this check,
 * `compliance:read-own` becomes a way to read a colleague's document by
 * guessing a UUID. No DB access, so it is unit-testable without a database.
 */
export function isOwnDocument(doc: { userId: number | null }, callerUserId: number): boolean {
  return doc.userId === callerUserId;
}

/** Calendar-day age of a `dailyRunClaim` period key ("YYYY-MM-DD[-HH]"), UTC-normalised. */
function daysSince(period: string): number {
  const [y, m, d] = period.split("-").map(Number);
  const [ty, tm, td] = dayKey(new Date()).split("-").map(Number);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / MS_PER_DAY);
}

// ── Documents ─────────────────────────────────────────────────────────

export interface CreateDocumentInput {
  /** Staff subject. Forced to the caller by the controller — never client-supplied. */
  userId: number;
  /** Who uploaded it. Forced to the caller by the controller (self-upload only, Phase 1). */
  uploadedBy: number;
  documentType: string;
  engagementType?: "employee" | "contractor" | "agency";
  documentNumber?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  issuingAuthority?: string | null;
  issuingJurisdiction?: string | null;
  storagePublicId: string;
  /** Delivery format (pdf|jpg|png) from the upload-time sniff, already validated by the controller. Null for pre-column rows. */
  storageFormat?: string | null;
  storeLocationId?: string | null;
  notes?: string | null;
}

export interface DocumentFilters {
  verificationStatus?: string;
  documentType?: string;
  storeLocationId?: string;
  engagementType?: string;
}

/** A staff member's own documents (or an admin viewing one staff member's set). */
export async function listDocumentsForUser(orgId: number, userId: number) {
  return db
    .select()
    .from(complianceDocument)
    .where(and(eq(complianceDocument.organisationId, orgId), eq(complianceDocument.userId, userId)))
    .orderBy(desc(complianceDocument.uploadedAt));
}

/**
 * Org-wide document list with admin filters, staff name + location name
 * joined in for display. Reused by `listPendingVerification` below.
 */
export async function listDocumentsForOrg(orgId: number, filters: DocumentFilters = {}) {
  const conditions = [eq(complianceDocument.organisationId, orgId)];
  if (filters.verificationStatus) {
    conditions.push(eq(complianceDocument.verificationStatus, filters.verificationStatus));
  }
  if (filters.documentType) conditions.push(eq(complianceDocument.documentType, filters.documentType));
  if (filters.storeLocationId) {
    conditions.push(eq(complianceDocument.storeLocationId, filters.storeLocationId));
  }
  if (filters.engagementType) {
    conditions.push(eq(complianceDocument.engagementType, filters.engagementType));
  }

  return db
    .select({
      complianceDocumentId: complianceDocument.complianceDocumentId,
      storeLocationId: complianceDocument.storeLocationId,
      userId: complianceDocument.userId,
      subjectStoreLocationId: complianceDocument.subjectStoreLocationId,
      documentType: complianceDocument.documentType,
      engagementType: complianceDocument.engagementType,
      documentNumber: complianceDocument.documentNumber,
      issueDate: complianceDocument.issueDate,
      expiryDate: complianceDocument.expiryDate,
      issuingAuthority: complianceDocument.issuingAuthority,
      issuingJurisdiction: complianceDocument.issuingJurisdiction,
      verificationStatus: complianceDocument.verificationStatus,
      uploadedBy: complianceDocument.uploadedBy,
      uploadedAt: complianceDocument.uploadedAt,
      verifiedBy: complianceDocument.verifiedBy,
      verifiedAt: complianceDocument.verifiedAt,
      rejectionReason: complianceDocument.rejectionReason,
      staffName: user.userName,
      locationName: storeLocation.locationName,
    })
    .from(complianceDocument)
    .leftJoin(user, eq(user.userId, complianceDocument.userId))
    .leftJoin(storeLocation, eq(storeLocation.storeLocationId, complianceDocument.storeLocationId))
    .where(and(...conditions))
    .orderBy(asc(complianceDocument.uploadedAt));
}

/** Single document, scoped to the caller's org. Cross-org id is a 404, not a 403. */
export async function getDocument(orgId: number, documentId: string) {
  return getDocumentRow(orgId, documentId);
}

export async function createDocument(orgId: number, input: CreateDocumentInput) {
  const documentType = input.documentType.trim();
  if (!documentType) throw new ComplianceError("Document type is required", 400);
  const storagePublicId = input.storagePublicId.trim();
  if (!storagePublicId) throw new ComplianceError("A file upload is required", 400);

  await assertUserInOrg(input.userId, orgId);
  if (input.storeLocationId) await assertLocationInOrg(input.storeLocationId, orgId);

  // The storage id arrives from the CLIENT — it is echoed back from the
  // /documents/upload response — so it gets the same org check every other
  // referenced id above gets. Without this, the id is the one field a caller
  // can point anywhere: set it to an asset in another organisation's folder
  // and the resulting row still passes every existing tenant check, because
  // organisationId and userId are written from the CALLER's context. The row
  // is theirs, so signedUrlForDocument happily signs a working URL for someone
  // else's police check. A public_id is not secret — it sits in the path of
  // every signed URL ever issued for that document.
  //
  // Worse than a read: complianceRetentionService purges on this same field,
  // so a forged row that ages into retention would destroy the victim's asset.
  //
  // Scoped to org AND user, so this also blocks a colleague in the same
  // organisation claiming another colleague's document.
  //
  // Venue documents (subject_store_location_id) have no uploader-owned folder
  // and cannot be created through this path today — it is self-upload only.
  // Whoever adds that route must extend this check rather than skip it.
  // A bare startsWith is not enough: public_ids are path-shaped, so
  // ".../org-1/user-1/../user-2/x" starts with the right prefix and still
  // walks out of the folder. Match the WHOLE id instead — the caller's folder
  // followed by exactly one Cloudinary-generated segment.
  const expectedFolder = complianceStorageFolder(orgId, input.userId);
  const remainder = storagePublicId.startsWith(`${expectedFolder}/`)
    ? storagePublicId.slice(expectedFolder.length + 1)
    : null;
  if (remainder === null || !/^[A-Za-z0-9_-]+$/.test(remainder)) {
    throw new ComplianceError("That upload reference isn't valid", 400);
  }

  try {
    const [created] = await db
      .insert(complianceDocument)
      .values({
        organisationId: orgId,
        storeLocationId: input.storeLocationId ?? null,
        userId: input.userId,
        documentType,
        engagementType: input.engagementType ?? "employee",
        documentNumber: input.documentNumber ?? null,
        issueDate: input.issueDate ?? null,
        expiryDate: input.expiryDate ?? null,
        issuingAuthority: input.issuingAuthority ?? null,
        issuingJurisdiction: input.issuingJurisdiction ?? null,
        storagePublicId,
        storageFormat: input.storageFormat ?? null,
        notes: input.notes ?? null,
        uploadedBy: input.uploadedBy,
      })
      .returning();

    await auditService.log({
      entityType: "compliance_document",
      entityId: created.complianceDocumentId,
      action: "create",
      actorUserId: input.uploadedBy,
      organisationId: orgId,
      afterValue: { ...created },
      metadata: { documentType, userId: input.userId },
    });

    return created;
  } catch (err) {
    // idx_compliance_document_unique = unique(userId, documentType, documentNumber).
    // 23505 = unique_violation — give the sentence instead of a raw 500.
    if (input.documentNumber && (err as { code?: string })?.code === "23505") {
      throw new ComplianceError(
        `You've already uploaded a ${documentType} with this document number`,
        409,
      );
    }
    throw err;
  }
}

export async function verifyDocument(orgId: number, documentId: string, verifierUserId: number) {
  const doc = await getDocumentRow(orgId, documentId);
  if (doc.verificationStatus !== "Pending") {
    throw new ComplianceError(
      `Document is not pending verification (status: ${doc.verificationStatus})`,
      409,
    );
  }

  const [updated] = await db
    .update(complianceDocument)
    .set({
      verificationStatus: "Verified",
      verifiedBy: verifierUserId,
      verifiedAt: new Date(),
      rejectionReason: null,
      updatedDttm: new Date(),
    })
    .where(
      and(
        eq(complianceDocument.complianceDocumentId, documentId),
        eq(complianceDocument.organisationId, orgId),
      ),
    )
    .returning();

  await auditService.log({
    entityType: "compliance_document",
    entityId: documentId,
    action: "update",
    actorUserId: verifierUserId,
    organisationId: orgId,
    beforeValue: { verificationStatus: doc.verificationStatus },
    afterValue: { verificationStatus: "Verified" },
    metadata: { action: "verify" },
  });

  return updated;
}

export async function rejectDocument(
  orgId: number,
  documentId: string,
  verifierUserId: number,
  reason: string,
) {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new ComplianceError("A rejection reason is required", 400);

  const doc = await getDocumentRow(orgId, documentId);
  if (doc.verificationStatus !== "Pending") {
    throw new ComplianceError(
      `Document is not pending verification (status: ${doc.verificationStatus})`,
      409,
    );
  }

  const [updated] = await db
    .update(complianceDocument)
    .set({
      verificationStatus: "Rejected",
      verifiedBy: verifierUserId,
      verifiedAt: new Date(),
      rejectionReason: trimmedReason,
      updatedDttm: new Date(),
    })
    .where(
      and(
        eq(complianceDocument.complianceDocumentId, documentId),
        eq(complianceDocument.organisationId, orgId),
      ),
    )
    .returning();

  await auditService.log({
    entityType: "compliance_document",
    entityId: documentId,
    action: "update",
    actorUserId: verifierUserId,
    organisationId: orgId,
    beforeValue: { verificationStatus: doc.verificationStatus },
    afterValue: { verificationStatus: "Rejected", rejectionReason: trimmedReason },
    metadata: { action: "reject" },
  });

  return updated;
}

/** The HQ verification queue — oldest upload first. */
export async function listPendingVerification(orgId: number) {
  return listDocumentsForOrg(orgId, { verificationStatus: "Pending" });
}

// ── Dashboard + stats ────────────────────────────────────────────────

export interface ComplianceDashboard {
  totalStaff: number;
  /**
   * DOCUMENTS currently valid, not staff — one row per (staff, required type)
   * that resolved to Verified and unexpired. The name reads like a headcount
   * and is not one: an org can report `allCurrent: 2` while only ONE of its
   * two staff is compliant. The UI headline deliberately derives its "N of M
   * staff are compliant" line from the staff array instead, so the two can
   * never disagree. Anything else reading this field (Antoine's compliance
   * tool, Phase 2) must not treat it as a headcount.
   */
  allCurrent: number;
  expiringWithin30Days: number;
  expired: number;
  /** STAFF missing at least one org-required document type, verified and unexpired. */
  incompleteForRole: number;
  venueDocumentCount: number;
  contractorCount: number;
}

/**
 * Org-wide compliance snapshot. AGGREGATE queries only — never a per-staff
 * loop (this codebase has already paid for that bug once, in
 * prepService.generateTasksFromSelections).
 */
/** One document type's status for one staff member, as the dashboard table renders it. */
export interface StaffDocumentStatus {
  documentType: string;
  status: "compliant" | "expiring" | "expired" | "pending" | "rejected" | "na";
  expiryDate: string | null;
}

/** One row of the staff compliance matrix. */
export interface StaffComplianceRow {
  userId: number;
  name: string;
  role: string;
  documents: StaffDocumentStatus[];
}

/**
 * Every staff member in the org against every document type the org requires,
 * with the status of each.
 *
 * ONE query, deliberately. The naive shape here is a loop over staff and then a
 * loop over required types, which is ~500 queries at 30 staff on the module's
 * most-loaded screen. This codebase already carries that bug once in
 * prepService.generateTasksFromSelections.
 *
 * The status is computed in SQL against CURRENT_DATE rather than in JS, so it
 * uses the SAME clock as getComplianceDashboard's aggregate. If one used the
 * database's date and the other the server's, the headline ("24 of 25
 * compliant") could disagree with the table beneath it across midnight or in a
 * different process timezone — which is exactly the reconciliation bug the
 * dashboard design calls out.
 *
 * A staff member may hold several documents of one type (an expired old one and
 * a fresh replacement). The LATERAL picks the BEST: verified and current beats
 * expiring, beats pending, beats expired/rejected, with the furthest expiry
 * winning ties.
 *
 * `storeLocationId` (optional) narrows the staff set to people assigned to
 * that venue (`user_store_location`) — the compliance report's venue-scoped
 * export. Status is still resolved from ALL of that person's documents
 * org-wide: which venue they work at doesn't change whether their RSA is
 * valid.
 */
export async function listStaffCompliance(
  orgId: number,
  storeLocationId?: string,
): Promise<StaffComplianceRow[]> {
  const locationFilter = storeLocationId
    ? sql`JOIN user_store_location usl ON usl.user_id = u.user_id AND usl.store_location_id = ${storeLocationId}`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT
      u.user_id                                   AS user_id,
      u.user_name                                 AS name,
      COALESCE((
        SELECT r.role_name FROM user_role ur
        JOIN role r ON r.role_id = ur.role_id
        WHERE ur.user_id = u.user_id
        ORDER BY r.role_name
        LIMIT 1
      ), '')                                      AS role,
      ord.document_type                           AS document_type,
      cd.verification_status                      AS verification_status,
      cd.expiry_date                              AS expiry_date
    FROM "user" u
    JOIN user_organisation uo
      ON uo.user_id = u.user_id AND uo.organisation_id = ${orgId}
    ${locationFilter}
    -- LEFT JOIN, not JOIN. An org that has configured no required document
    -- types still has staff, and an inner join collapses the whole matrix to
    -- zero rows — so the dashboard renders "No one on the team yet" for an org
    -- that plainly has people, and every control gated behind a non-empty
    -- staff list (the audit PDF export among them) disappears with it.
    --
    -- Zero required types is the DEFAULT state of a new org, not an edge case:
    -- it is what every org looks like until an admin opens Settings →
    -- Requirements for the first time.
    --
    -- The row handler below tolerates a null document_type for exactly this
    -- reason: the staff member comes back with an empty documents array, which
    -- the client can tell apart from having no staff at all.
    LEFT JOIN organisation_required_document ord
      ON ord.organisation_id = ${orgId}
    LEFT JOIN LATERAL (
      SELECT cd2.verification_status, cd2.expiry_date
      FROM compliance_document cd2
      WHERE cd2.user_id = u.user_id
        AND cd2.organisation_id = ${orgId}
        AND cd2.document_type = ord.document_type
        AND cd2.verification_status <> 'Archived'
      ORDER BY
        CASE
          WHEN cd2.verification_status = 'Verified'
           AND (cd2.expiry_date IS NULL OR cd2.expiry_date >= CURRENT_DATE) THEN 0
          WHEN cd2.verification_status = 'Pending' THEN 1
          ELSE 2
        END,
        cd2.expiry_date DESC NULLS FIRST
      LIMIT 1
    ) cd ON true
    ORDER BY u.user_name, ord.document_type
  `)) as unknown as Array<{
    user_id: number;
    name: string;
    role: string;
    document_type: string | null;
    verification_status: string | null;
    expiry_date: string | null;
  }>;

  const byUser = new Map<number, StaffComplianceRow>();
  for (const r of rows) {
    let row = byUser.get(r.user_id);
    if (!row) {
      row = { userId: r.user_id, name: r.name, role: r.role, documents: [] };
      byUser.set(r.user_id, row);
    }
    // document_type is null when the org has no required types configured. The
    // staff member still belongs in the result; they just have nothing to show.
    if (r.document_type !== null) {
      row.documents.push({
        documentType: r.document_type,
        status: statusVariant(r.verification_status, r.expiry_date),
        expiryDate: r.expiry_date,
      });
    }
  }
  return [...byUser.values()];
}

/**
 * Map a stored verification status + expiry onto the pill variant the table
 * renders. Pure, so the mapping is testable without a database.
 *
 * `null` status means the staff member has never uploaded this required type,
 * which reads as "na" — visually distinct from a document that exists and has
 * gone bad.
 */
export function statusVariant(
  verificationStatus: string | null,
  expiryDate: string | null,
  today: string = new Date().toISOString().slice(0, 10),
): StaffDocumentStatus["status"] {
  if (!verificationStatus) return "na";
  if (verificationStatus === "Rejected") return "rejected";
  if (verificationStatus === "Orphaned") return "na";
  if (verificationStatus === "Pending") return "pending";
  if (verificationStatus === "Expired") return "expired";
  if (verificationStatus === "Requires Renewal") return "expiring";

  // Verified from here: the date decides.
  if (!expiryDate) return "compliant";
  if (expiryDate < today) return "expired";

  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + 30);
  return expiryDate <= cutoff.toISOString().slice(0, 10) ? "expiring" : "compliant";
}

export async function getComplianceDashboard(orgId: number): Promise<ComplianceDashboard> {
  const [staffRow] = await db
    .select({ n: sql<number>`count(DISTINCT ${userOrganisation.userId})::int` })
    .from(userOrganisation)
    .where(eq(userOrganisation.organisationId, orgId));

  // The status counts are taken over the SAME resolved set listStaffCompliance
  // renders: the BEST document per (staff member, required type), not every raw
  // row. Counting raw rows here was a real reconciliation bug — a staff member
  // who renewed an expired certificate still has the superseded row on file, so
  // the tile read "Expired: 1" while the table underneath showed nobody expired.
  // That is exactly the headline-vs-table disagreement this screen was designed
  // to prevent, and renewing a certificate is the normal case, not an edge one.
  //
  // Venue documents and the contractor headcount are NOT per-required-type, so
  // they stay counted over the raw table.
  const [docRow] = (await db.execute(sql`
    WITH resolved AS (
      SELECT cd.verification_status, cd.expiry_date
      FROM "user" u
      JOIN user_organisation uo
        ON uo.user_id = u.user_id AND uo.organisation_id = ${orgId}
      -- LEFT JOIN, not JOIN: an org that has not configured any required
      -- document types must still return its staff. With an inner join the
      -- whole matrix collapses to zero rows and the dashboard renders "No one
      -- on the team yet" for an org that plainly has staff — a false statement,
      -- and precisely the misleading-empty-state class the design warned about.
      -- Staff then come back with an empty documents array, which the client
      -- can distinguish from having no staff at all.
      LEFT JOIN organisation_required_document ord
        ON ord.organisation_id = ${orgId}
      LEFT JOIN LATERAL (
        SELECT cd2.verification_status, cd2.expiry_date
        FROM compliance_document cd2
        WHERE cd2.user_id = u.user_id
          AND cd2.organisation_id = ${orgId}
          AND cd2.document_type = ord.document_type
          AND cd2.verification_status <> 'Archived'
        ORDER BY
          CASE
            WHEN cd2.verification_status = 'Verified'
             AND (cd2.expiry_date IS NULL OR cd2.expiry_date >= CURRENT_DATE) THEN 0
            WHEN cd2.verification_status = 'Pending' THEN 1
            ELSE 2
          END,
          cd2.expiry_date DESC NULLS FIRST
        LIMIT 1
      ) cd ON true
    )
    SELECT
      (SELECT count(*) FILTER (
         WHERE verification_status = 'Verified' AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
       )::int FROM resolved) AS all_current,
      (SELECT count(*) FILTER (
         WHERE verification_status = 'Verified' AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + 30
       )::int FROM resolved) AS expiring_within_30_days,
      (SELECT count(*) FILTER (
         WHERE verification_status IS NOT NULL
           AND verification_status NOT IN ('Archived', 'Rejected')
           AND expiry_date < CURRENT_DATE
       )::int FROM resolved) AS expired,
      (SELECT count(*) FILTER (WHERE subject_store_location_id IS NOT NULL)::int
         FROM compliance_document WHERE organisation_id = ${orgId}) AS venue_document_count,
      (SELECT count(DISTINCT user_id) FILTER (
         WHERE engagement_type = 'contractor' AND user_id IS NOT NULL
       )::int FROM compliance_document WHERE organisation_id = ${orgId}) AS contractor_count
  `)) as unknown as Array<{
    all_current: number;
    expiring_within_30_days: number;
    expired: number;
    venue_document_count: number;
    contractor_count: number;
  }>;

  // Phase 1's "incomplete document set" metric — every staff member missing at
  // least one org-required document type, verified and not expired.
  const [incompleteRow] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM (
      SELECT u.user_id FROM "user" u
      JOIN user_organisation uo ON uo.user_id = u.user_id
      JOIN organisation_required_document ord ON ord.organisation_id = uo.organisation_id
      WHERE uo.organisation_id = ${orgId}
        AND NOT EXISTS (SELECT 1 FROM compliance_document cd
                        WHERE cd.user_id = u.user_id
                          AND cd.document_type = ord.document_type
                          AND cd.verification_status = 'Verified'
                          AND (cd.expiry_date IS NULL OR cd.expiry_date >= CURRENT_DATE))
      GROUP BY u.user_id
    ) t
  `)) as unknown as Array<{ n: number }>;

  return {
    totalStaff: staffRow?.n ?? 0,
    allCurrent: docRow?.all_current ?? 0,
    expiringWithin30Days: docRow?.expiring_within_30_days ?? 0,
    expired: docRow?.expired ?? 0,
    incompleteForRole: incompleteRow?.n ?? 0,
    venueDocumentCount: docRow?.venue_document_count ?? 0,
    contractorCount: docRow?.contractor_count ?? 0,
  };
}

export interface ComplianceStats {
  /** Period key (`dayKey`) the daily expiry scan last completed, or null if it has never run. */
  jobLastRun: string | null;
  /** Calendar days since that run — the staleness signal a dead job shows up as. */
  jobLastRunDaysAgo: number | null;
  documentsByStatus: Record<string, number>;
  expiringWithin30Days: number;
  /** Phase 2 (staff consent-to-store flow) — no consent table yet, always 0. */
  consentPending: number;
}

/** Admin snapshot: job heartbeat + document counts by status. */
export async function getComplianceStats(orgId: number): Promise<ComplianceStats> {
  const jobLastRun = await readLastRun(EXPIRY_SCAN_JOB);

  const statusRows = (await db.execute(sql`
    SELECT verification_status, count(*)::int AS n
    FROM compliance_document
    WHERE organisation_id = ${orgId}
    GROUP BY verification_status
  `)) as unknown as Array<{ verification_status: string; n: number }>;
  const documentsByStatus: Record<string, number> = {};
  for (const row of statusRows) documentsByStatus[row.verification_status] = row.n;

  const [expiringRow] = (await db.execute(sql`
    SELECT count(*)::int AS n
    FROM compliance_document
    WHERE organisation_id = ${orgId}
      AND verification_status NOT IN ('Archived', 'Rejected')
      AND expiry_date >= CURRENT_DATE
      AND expiry_date <= CURRENT_DATE + 30
  `)) as unknown as Array<{ n: number }>;

  return {
    jobLastRun,
    jobLastRunDaysAgo: jobLastRun ? daysSince(jobLastRun) : null,
    documentsByStatus,
    expiringWithin30Days: expiringRow?.n ?? 0,
    consentPending: 0,
  };
}

// ── Expiry rules (global — jurisdiction law, not per-org) ───────────────

export interface ExpiryRuleInput {
  documentType: string;
  jurisdiction?: string | null;
  validityPeriodYears?: number | null;
  blockRosterOnExpiry?: boolean;
  trainingProviderUrl?: string | null;
  effectiveFrom: string;
  sourceCitation?: string | null;
  notes?: string | null;
  alertDays?: number[];
}

/** Every rule, current and historical, oldest-effective last within each type+jurisdiction. */
export async function listExpiryRules() {
  const rules = await db
    .select()
    .from(documentExpiryRule)
    .orderBy(
      asc(documentExpiryRule.documentType),
      asc(documentExpiryRule.jurisdiction),
      desc(documentExpiryRule.effectiveFrom),
    );
  if (rules.length === 0) return [];

  const alertRows = await db
    .select()
    .from(documentExpiryRuleAlertDay)
    .where(
      inArray(
        documentExpiryRuleAlertDay.documentExpiryRuleId,
        rules.map((r) => r.documentExpiryRuleId),
      ),
    );
  const alertsByRule = new Map<string, number[]>();
  for (const row of alertRows) {
    const list = alertsByRule.get(row.documentExpiryRuleId) ?? [];
    list.push(row.daysBefore);
    alertsByRule.set(row.documentExpiryRuleId, list);
  }

  return rules.map((r) => ({
    ...r,
    alertDays: (alertsByRule.get(r.documentExpiryRuleId) ?? []).sort((a, b) => b - a),
  }));
}

/**
 * Create a new rule version for (documentType, jurisdiction), closing out the
 * currently-active version so a roster published under the old rule can still
 * see the rule that applied AT THE TIME (schema doc comment).
 *
 * ponytail: assumes the new effectiveFrom is after the currently-active
 * version's effectiveFrom (the normal "the law changed" case). Backdated
 * corrections to an already-closed rule aren't handled — upgrade to an
 * explicit ruleId-targeted edit if that's needed.
 */
export async function upsertExpiryRule(input: ExpiryRuleInput) {
  const documentType = input.documentType.trim();
  if (!documentType) throw new ComplianceError("Document type is required", 400);
  if (!input.effectiveFrom) throw new ComplianceError("An effective-from date is required", 400);
  const jurisdiction = input.jurisdiction?.trim() || null;

  return db.transaction(async (tx) => {
    const activeMatch = jurisdiction
      ? and(
          eq(documentExpiryRule.documentType, documentType),
          eq(documentExpiryRule.jurisdiction, jurisdiction),
        )
      : and(
          eq(documentExpiryRule.documentType, documentType),
          isNull(documentExpiryRule.jurisdiction),
        );

    await tx
      .update(documentExpiryRule)
      .set({
        effectiveTo: sql`(${input.effectiveFrom}::date - 1)`,
        updatedDttm: new Date(),
      })
      .where(and(activeMatch, isNull(documentExpiryRule.effectiveTo)));

    const [created] = await tx
      .insert(documentExpiryRule)
      .values({
        documentType,
        jurisdiction,
        validityPeriodYears: input.validityPeriodYears ?? null,
        blockRosterOnExpiry: input.blockRosterOnExpiry ?? false,
        trainingProviderUrl: input.trainingProviderUrl ?? null,
        effectiveFrom: input.effectiveFrom,
        sourceCitation: input.sourceCitation ?? null,
        notes: input.notes ?? null,
      })
      .returning();

    const alertDays = [...new Set(input.alertDays ?? [])];
    if (alertDays.length > 0) {
      await tx
        .insert(documentExpiryRuleAlertDay)
        .values(
          alertDays.map((daysBefore) => ({
            documentExpiryRuleId: created.documentExpiryRuleId,
            daysBefore,
          })),
        );
    }

    return { ...created, alertDays: alertDays.sort((a, b) => b - a) };
  });
}

// ── Organisation required documents (org-scoped) ────────────────────────

/** The document types this org requires of every staff member, regardless of role. */
export async function listRequiredDocuments(orgId: number): Promise<string[]> {
  const rows = await db
    .select({ documentType: organisationRequiredDocument.documentType })
    .from(organisationRequiredDocument)
    .where(eq(organisationRequiredDocument.organisationId, orgId))
    .orderBy(asc(organisationRequiredDocument.documentType));
  return rows.map((r) => r.documentType);
}

/** Wholesale replace — mirrors orderGuideService.setGuideItems / storageAreaService.setAreaItems. */
export async function setRequiredDocuments(
  orgId: number,
  documentTypes: string[],
): Promise<string[]> {
  const types = [...new Set(documentTypes.map((t) => t.trim()).filter(Boolean))];

  await db.transaction(async (tx) => {
    await tx
      .delete(organisationRequiredDocument)
      .where(eq(organisationRequiredDocument.organisationId, orgId));
    if (types.length > 0) {
      await tx
        .insert(organisationRequiredDocument)
        .values(types.map((documentType) => ({ organisationId: orgId, documentType })));
    }
  });

  return listRequiredDocuments(orgId);
}

// ── Report PDF assembly ──────────────────────────────────────────────

/**
 * Most recent `engagement_type` per staff member. Not carried by
 * `listStaffCompliance` — engagement_type lives on `compliance_document`
 * (a snapshot per upload), not on the person — so the report needs this one
 * extra, narrowly-scoped query rather than re-deriving the whole matrix.
 * Falls back to "employee" (the schema default) for staff with nothing on
 * file yet.
 */
async function getEngagementTypesByUser(
  orgId: number,
  userIds: number[],
): Promise<Map<number, EngagementType>> {
  if (userIds.length === 0) return new Map();

  const rows = await db
    .select({
      userId: complianceDocument.userId,
      engagementType: complianceDocument.engagementType,
    })
    .from(complianceDocument)
    .where(
      and(eq(complianceDocument.organisationId, orgId), inArray(complianceDocument.userId, userIds)),
    )
    .orderBy(desc(complianceDocument.uploadedAt));

  const byUser = new Map<number, EngagementType>();
  for (const row of rows) {
    // First hit per user wins — rows are newest-uploaded first.
    if (row.userId !== null && !byUser.has(row.userId)) {
      byUser.set(row.userId, row.engagementType as EngagementType);
    }
  }
  return byUser;
}

/**
 * Maps a dashboard status variant to the report's plain-text label — the
 * exact wording StaffComplianceTable.tsx shows, so the PDF an inspector is
 * handed never disagrees with the live screen it was exported from. "na" is
 * deliberately absent: compliancePdfService's own contract renders a missing
 * key as "Missing", so that string lives in one place, not two.
 */
const REPORT_STATUS_LABELS: Record<Exclude<StaffDocumentStatus["status"], "na">, string> = {
  compliant: "Compliant",
  expiring: "Expiring",
  expired: "Expired",
  pending: "Pending",
  rejected: "Rejected",
};

function toDocumentStatusRecord(docs: StaffDocumentStatus[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const doc of docs) {
    if (doc.status === "na") continue;
    record[doc.documentType] = REPORT_STATUS_LABELS[doc.status];
  }
  return record;
}

/**
 * Assemble the data `compliancePdfService.generateComplianceReportPdf`
 * renders — the audit-ready export an inspector asks for on-site. Reuses
 * `listStaffCompliance` for the per-staff/per-document matrix and
 * `listRequiredDocuments` for the column order rather than re-querying
 * either.
 *
 * `storeLocationId` is org-scoped before use: a cross-org id throws
 * ComplianceError(404), never a 403, so a guessed id from another tenant
 * never confirms a venue exists. Omitted means an org-wide export
 * (`venueName: null`).
 */
export async function getComplianceReportData(
  orgId: number,
  storeLocationId?: string,
): Promise<ComplianceReportPdfData> {
  const [org] = await db
    .select({ organisationName: organisation.organisationName })
    .from(organisation)
    .where(eq(organisation.organisationId, orgId));

  let venueName: string | null = null;
  if (storeLocationId) {
    const [loc] = await db
      .select({ locationName: storeLocation.locationName })
      .from(storeLocation)
      .where(
        and(
          eq(storeLocation.storeLocationId, storeLocationId),
          eq(storeLocation.organisationId, orgId),
        ),
      );
    if (!loc) throw new ComplianceError("Location not found", 404);
    venueName = loc.locationName;
  }

  const [documentTypes, staffRows] = await Promise.all([
    listRequiredDocuments(orgId),
    listStaffCompliance(orgId, storeLocationId),
  ]);
  const engagementByUser = await getEngagementTypesByUser(
    orgId,
    staffRows.map((row) => row.userId),
  );

  const staff: ComplianceReportStaffRow[] = staffRows.map((row) => ({
    staffName: row.name,
    role: row.role,
    engagementType: engagementByUser.get(row.userId) ?? "employee",
    documents: toDocumentStatusRecord(row.documents),
  }));

  return {
    organisationName: org?.organisationName ?? "Unknown Organisation",
    venueName,
    documentTypes,
    staff,
  };
}
