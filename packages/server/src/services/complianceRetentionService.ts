/**
 * @module services/complianceRetentionService
 *
 * Retention lifecycle for the Staff Compliance Vault: archive on offboard, and
 * the daily purge that actually deletes what's past its retention window.
 *
 * Three independent jobs:
 *   - archiveForOffboardedStaff — called the moment someone's employment ends.
 *     Access stops IMMEDIATELY (verification_status -> Archived); the row
 *     itself survives until its retention window elapses. The storage service
 *     (documentStorageService) is what actually refuses a view of an Archived
 *     document — this function only sets the state.
 *   - purgeExpiredRetention — the daily job. Deletes the DB row AND the
 *     Cloudinary blob for any document whose retention window has elapsed,
 *     plus an orphan sweep for documents nobody ever formally offboarded.
 *   - pruneAccessLog — prunes document_access_log, which grows on every view
 *     (granted or denied) and has no other retention mechanism.
 *
 * Retention-window and orphan-sweep decisions are pure functions
 * (isRetentionExpired, isOrphanedInactive) kept separate from the DB-querying
 * orchestrators below, mirroring complianceExpiryMath.ts: every rule here is
 * unit-testable without a database.
 */

import { eq, and, isNull, isNotNull, inArray, lt } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import { complianceDocument, documentAccessLog, user } from "../db/schema.js";
import { dayKey } from "../utils/dailyRunClaim.js";
import { deleteStoredDocument } from "./documentStorageService.js";
import type { DbOrTx } from "./auditService.js";
import * as auditService from "./auditService.js";

const logger = pino({ name: "complianceRetentionService" });

/**
 * Fair Work Regulations 2009 (Cth) reg 3.44: employee records must be kept
 * for 7 years. Applies to `engagement_type = 'employee'` only.
 */
export const EMPLOYEE_RETENTION_YEARS = 7;

/**
 * APP 11.2 (Privacy Act 1988): destroy or de-identify personal information
 * once it is no longer needed for the purpose it was collected. The Fair
 * Work 7-year figure above is an EMPLOYMENT-records rule (reg 3.44) and does
 * not automatically extend to contractors or agency staff — they also fall
 * outside the Privacy Act's employee-records exemption (s.7B(3)), so APP 11
 * is the operative rule for them instead.
 *
 * 2 years is a PLACEHOLDER. This is a legal call — confirm with counsel
 * before relying on it in production.
 */
export const NON_EMPLOYEE_RETENTION_YEARS = 2;

/**
 * A document with no employment_end_date belongs to someone who was never
 * formally offboarded. Without this, such a document would be retained
 * forever. Threshold: the subject account has been non-active for this long.
 */
export const ORPHAN_INACTIVE_YEARS = 2;

/** document_access_log has no other retention mechanism and grows on every
 *  view. Mirrors the employee-record statutory window. */
export const ACCESS_LOG_RETENTION_DAYS = EMPLOYEE_RETENTION_YEARS * 365;

// ---------------------------------------------------------------------------
// Pure decision logic — no DB, fully unit-testable.
// ---------------------------------------------------------------------------

export interface RetentionCandidate {
  engagementType: string;
  employmentEndDate: string | null;
}

/**
 * Has this document's post-offboarding retention window elapsed as of `today`?
 *
 * Still engaged (employmentEndDate === null) -> never expired; that case is
 * what the orphan sweep exists to eventually catch instead.
 */
export function isRetentionExpired(doc: RetentionCandidate, today: string): boolean {
  if (doc.employmentEndDate === null) return false;

  const years =
    doc.engagementType === "employee"
      ? EMPLOYEE_RETENTION_YEARS
      : doc.engagementType === "contractor" || doc.engagementType === "agency"
        ? NON_EMPLOYEE_RETENTION_YEARS
        : null;
  if (years === null) return false;

  // "YYYY-MM-DD" strings sort lexicographically in calendar order.
  return doc.employmentEndDate <= yearsAgo(today, years);
}

export interface OrphanCandidate {
  employmentEndDate: string | null;
  userId: number | null;
}

export interface SubjectUser {
  userStatus: string;
  updatedDttm: Date;
}

/**
 * Catches the staff member who left without ever being formally offboarded:
 * a user-subject document with no employment_end_date, whose subject account
 * has been non-active (userStatus !== "active") for over
 * ORPHAN_INACTIVE_YEARS.
 *
 * user.updatedDttm is the only signal this schema carries for "when did this
 * account go inactive" — userService's suspend/cancel paths stamp updatedDttm
 * alongside the status change, so it doubles as a status-change timestamp. Not
 * perfect (an unrelated later edit would reset the clock too), but it is the
 * only timestamp available without a schema change.
 */
export function isOrphanedInactive(
  doc: OrphanCandidate,
  subject: SubjectUser | null,
  today: string,
): boolean {
  if (doc.employmentEndDate !== null) return false;
  if (doc.userId === null || subject === null) return false;
  if (subject.userStatus === "active") return false;

  const cutoff = new Date(`${yearsAgo(today, ORPHAN_INACTIVE_YEARS)}T00:00:00.000Z`);
  return subject.updatedDttm < cutoff;
}

/**
 * `today` minus `years` calendar years, as "YYYY-MM-DD". UTC-normalised —
 * same technique as complianceExpiryMath's daysBetween — so DST and
 * local-timezone shifts can never move the cutoff.
 */
function yearsAgo(today: string, years: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const cutoff = new Date(Date.UTC(y, m - 1, d));
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Orchestrators — DB + Cloudinary + audit.
// ---------------------------------------------------------------------------

/**
 * Archive every compliance document held for `userId`. Access stops
 * IMMEDIATELY — the day someone leaves, not seven years later — because
 * documentStorageService refuses to serve an Archived document. This
 * function only sets the state; it does not touch storage.
 *
 * @returns the number of documents archived.
 */
export async function archiveForOffboardedStaff(
  userId: number,
  employmentEndDate: string,
): Promise<number> {
  const rows = await db
    .update(complianceDocument)
    .set({
      verificationStatus: "Archived",
      employmentEndDate,
      updatedDttm: new Date(),
    })
    .where(eq(complianceDocument.userId, userId))
    .returning({ id: complianceDocument.complianceDocumentId });

  return rows.length;
}

interface RetentionRow {
  complianceDocumentId: string;
  organisationId: number;
  storagePublicId: string;
  engagementType: string;
  employmentEndDate: string | null;
  userId: number | null;
}

const RETENTION_ROW_COLUMNS = {
  complianceDocumentId: complianceDocument.complianceDocumentId,
  organisationId: complianceDocument.organisationId,
  storagePublicId: complianceDocument.storagePublicId,
  engagementType: complianceDocument.engagementType,
  employmentEndDate: complianceDocument.employmentEndDate,
  userId: complianceDocument.userId,
};

/**
 * Daily purge. Finds every document whose retention window has elapsed
 * (direct or via the orphan sweep), destroys its Cloudinary blob, and only
 * then deletes the row + writes an audit_log entry.
 *
 * Cloudinary deletion happens BEFORE the row delete, deliberately: if
 * deleteStoredDocument throws, the document is skipped entirely — row and
 * blob stay in sync and the next day's run retries. Deleting the row first
 * would risk a permanently unreachable Cloudinary blob, which is exactly the
 * failure mode a retention policy exists to prevent.
 */
export async function purgeExpiredRetention(
  today: string = dayKey(new Date()),
): Promise<{ purged: number; orphanSweep: number }> {
  const withEndDate: RetentionRow[] = await db
    .select(RETENTION_ROW_COLUMNS)
    .from(complianceDocument)
    .where(isNotNull(complianceDocument.employmentEndDate));

  const retentionExpired = withEndDate.filter((doc) => isRetentionExpired(doc, today));

  const withoutEndDate: RetentionRow[] = await db
    .select(RETENTION_ROW_COLUMNS)
    .from(complianceDocument)
    .where(and(isNull(complianceDocument.employmentEndDate), isNotNull(complianceDocument.userId)));

  let orphaned: RetentionRow[] = [];
  if (withoutEndDate.length > 0) {
    // isNotNull(userId) above guarantees every row here has a userId.
    const userIds = [...new Set(withoutEndDate.map((doc) => doc.userId as number))];
    const subjects = await db
      .select({ userId: user.userId, userStatus: user.userStatus, updatedDttm: user.updatedDttm })
      .from(user)
      .where(inArray(user.userId, userIds));
    const subjectById = new Map(subjects.map((s) => [s.userId, s]));

    orphaned = withoutEndDate.filter((doc) =>
      isOrphanedInactive(doc, subjectById.get(doc.userId as number) ?? null, today),
    );
  }

  let purged = 0;
  for (const doc of [...retentionExpired, ...orphaned]) {
    try {
      await deleteStoredDocument(doc.storagePublicId);
    } catch (err) {
      logger.error(
        { err, complianceDocumentId: doc.complianceDocumentId },
        "Retention purge: Cloudinary deletion failed — leaving document for retry",
      );
      continue;
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(complianceDocument)
        .where(eq(complianceDocument.complianceDocumentId, doc.complianceDocumentId));

      await auditService.log(
        {
          entityType: "compliance_document",
          entityId: doc.complianceDocumentId,
          action: "soft_delete",
          actorUserId: null,
          organisationId: doc.organisationId,
          beforeValue: {
            engagementType: doc.engagementType,
            employmentEndDate: doc.employmentEndDate,
            userId: doc.userId,
          },
          metadata: { reason: "retention_purge" },
        },
        tx as DbOrTx,
      );
    });
    purged++;
  }

  return { purged, orphanSweep: orphaned.length };
}

/**
 * Prunes document_access_log rows older than `retainDays` (default: the
 * statutory 7-year window). That table logs every document view — granted
 * or denied — and has no other mechanism to keep it from growing unbounded.
 *
 * @returns the number of rows deleted.
 */
export async function pruneAccessLog(
  today: string = dayKey(new Date()),
  retainDays: number = ACCESS_LOG_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(`${today}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - retainDays);

  const rows = await db
    .delete(documentAccessLog)
    .where(lt(documentAccessLog.createdDttm, cutoff))
    .returning({ id: documentAccessLog.documentAccessLogId });

  return rows.length;
}
