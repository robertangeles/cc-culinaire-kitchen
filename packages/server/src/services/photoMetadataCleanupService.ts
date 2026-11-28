/**
 * @module services/photoMetadataCleanupService
 *
 * Finds compliance photos stored before uploads were cleaned (documentStorageService.storeDocument strips metadata
 * since then) and, when asked, replaces each one that still carries metadata with a cleaned copy. Run by the owner
 * through scripts/cleanStoredPhotoMetadata.ts.
 *
 * REPLACING ONE PHOTO, in an order that keeps the original until the copy is known good:
 *   storeDocument(original)  ->  a cleaned copy under a new public_id, in the uploader's folder (same cleaning code as uploads)
 *   audit "copy_stored"      ->  recorded before anything can go wrong, so a stray copy can always be found again
 *   download the copy        ->  it must read as clean, or the run stops with the original still in place
 *   one transaction          ->  the row moves to the copy only if it still points at the original, plus audit "repointed"
 *   destroy the original     ->  audit "original_removed"
 * The document id and how its view URL is minted stay the same; only storage_public_id changes.
 *
 * RESUMING. The audit rows are the record: every --apply run first finishes what an earlier run left half done
 * (an original still stored after its row moved, a copy no row points at), then works through the photos. A photo
 * that already reads clean is skipped, so a second run changes nothing. Any storage error stops the run; run it again.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { readMetadata } from "@culinaire/shared";
import { db } from "../db/index.js";
import { auditLog, complianceDocument } from "../db/schema.js";
import * as auditService from "./auditService.js";
import { deleteStoredDocument, downloadStoredDocument, storeDocument } from "./documentStorageService.js";

/** Tags this job's audit rows. */
export const CLEANUP_JOB = "photo-metadata-cleanup";

export interface StoredPhoto {
  complianceDocumentId: string;
  organisationId: number;
  uploadedBy: number;
  storagePublicId: string;
  storageFormat: string;
}

/** Storage as this job needs it. The real one is documentStorageService; tests pass a fake. */
export interface PhotoStorage {
  /** The stored bytes, or null when storage no longer has the file. Throws on any other storage failure. */
  download(publicId: string, format: string): Promise<Uint8Array | null>;
  /** Stores a cleaned copy and returns its public_id. */
  store(bytes: Uint8Array, organisationId: number, uploadedBy: number): Promise<string>;
  remove(publicId: string): Promise<void>;
}

export const documentStorage: PhotoStorage = {
  download: downloadStoredDocument,
  store: async (bytes, organisationId, uploadedBy) =>
    (await storeDocument(Buffer.from(bytes), organisationId, uploadedBy)).publicId,
  remove: deleteStoredDocument,
};

export interface CleanupReport {
  total: number;
  location: number;
  /** Metadata other than a location, and no location. */
  otherMetadata: number;
  clean: number;
  /** Not stored any more, or not a whole JPEG or PNG. Left as they are. */
  unreadable: string[];
  /** --apply only: replaced with a cleaned copy. */
  cleaned: number;
  /** --apply only: the row changed or went away mid-run; its copy was removed and the photo left for the next run. */
  changedMeanwhile: string[];
}

type Step = "copy_stored" | "repointed" | "copy_removed" | "original_removed";
/** What a step's audit row says: which document, and which original it replaced. */
type Original = Pick<StoredPhoto, "complianceDocumentId" | "organisationId" | "storagePublicId">;

/** Every JPEG or PNG compliance document, plus how many rows have no recorded format (uploaded before the column existed). */
export async function listStoredPhotos(): Promise<{ photos: StoredPhoto[]; formatNotRecorded: number }> {
  const photos = await db
    .select({
      complianceDocumentId: complianceDocument.complianceDocumentId,
      organisationId: complianceDocument.organisationId,
      uploadedBy: complianceDocument.uploadedBy,
      storagePublicId: complianceDocument.storagePublicId,
      storageFormat: complianceDocument.storageFormat,
    })
    .from(complianceDocument)
    .where(inArray(complianceDocument.storageFormat, ["jpg", "png"]))
    .orderBy(complianceDocument.complianceDocumentId);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(complianceDocument)
    .where(isNull(complianceDocument.storageFormat));
  return { photos: photos as StoredPhoto[], formatNotRecorded: n };
}

function record(photo: Original, copyId: string, step: Step, tx: auditService.DbOrTx = db) {
  return auditService.log(
    {
      entityType: "compliance_document",
      entityId: photo.complianceDocumentId,
      action: "update",
      actorUserId: null,
      organisationId: photo.organisationId,
      beforeValue: { storagePublicId: photo.storagePublicId },
      afterValue: { storagePublicId: copyId },
      metadata: { job: CLEANUP_JOB, step },
    },
    tx,
  );
}

/** Moves the row to the copy only if it still points at the original. False when it changed or went away. */
function repoint(photo: StoredPhoto, copyId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const moved = await tx
      .update(complianceDocument)
      .set({ storagePublicId: copyId })
      .where(
        and(
          eq(complianceDocument.complianceDocumentId, photo.complianceDocumentId),
          eq(complianceDocument.storagePublicId, photo.storagePublicId),
        ),
      )
      .returning({ id: complianceDocument.complianceDocumentId });
    if (moved.length === 0) return false;
    await record(photo, copyId, "repointed", tx);
    return true;
  });
}

/**
 * Finishes what an earlier --apply run left half done, keyed on each copy's public_id: destroys an original whose row
 * already moved to its copy, and destroys a copy no row points at (the run stopped before moving the row, or the row
 * was deleted, for example by the retention purge, after it moved). Returns how many files it removed.
 */
export async function finishInterruptedCleanups(storage: PhotoStorage): Promise<number> {
  const rows = await db
    .select({
      entityId: auditLog.entityId,
      organisationId: auditLog.organisationId,
      beforeValue: auditLog.beforeValue,
      afterValue: auditLog.afterValue,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, "compliance_document"), sql`${auditLog.metadata}->>'job' = ${CLEANUP_JOB}`));

  const copies = new Map<string, { photo: Original; steps: Set<Step> }>();
  for (const r of rows) {
    const copyId = (r.afterValue as { storagePublicId: string }).storagePublicId;
    const entry = copies.get(copyId) ?? {
      photo: {
        complianceDocumentId: r.entityId,
        organisationId: r.organisationId!,
        storagePublicId: (r.beforeValue as { storagePublicId: string }).storagePublicId,
      },
      steps: new Set<Step>(),
    };
    entry.steps.add((r.metadata as { step: Step }).step);
    copies.set(copyId, entry);
  }

  let removed = 0;
  for (const [copyId, { photo, steps }] of copies) {
    if (steps.has("repointed") && !steps.has("original_removed")) {
      await storage.remove(photo.storagePublicId);
      await record(photo, copyId, "original_removed");
      removed++;
    }
    if (steps.has("copy_removed")) continue;
    const [inUse] = await db
      .select({ id: complianceDocument.complianceDocumentId })
      .from(complianceDocument)
      .where(eq(complianceDocument.storagePublicId, copyId))
      .limit(1);
    if (inUse) continue;
    await storage.remove(copyId);
    await record(photo, copyId, "copy_removed");
    removed++;
  }
  return removed;
}

/**
 * Reads every photo and counts what it carries. With `apply`, replaces each one that carries any metadata.
 * Stops at the first storage error (it throws); nothing about the photo being worked on is lost, and a rerun resumes.
 */
export async function cleanStoredPhotos(
  photos: StoredPhoto[],
  storage: PhotoStorage,
  apply: boolean,
): Promise<CleanupReport> {
  const report: CleanupReport = { total: photos.length, location: 0, otherMetadata: 0, clean: 0, unreadable: [], cleaned: 0, changedMeanwhile: [] };

  for (const photo of photos) {
    const bytes = await storage.download(photo.storagePublicId, photo.storageFormat);
    const found = bytes && readMetadata(bytes);
    if (!found) {
      report.unreadable.push(photo.complianceDocumentId);
      continue;
    }
    if (!found.metadata) {
      report.clean++;
      continue;
    }
    if (found.location) report.location++;
    else report.otherMetadata++;
    if (!apply) continue;

    const copyId = await storage.store(bytes, photo.organisationId, photo.uploadedBy);
    await record(photo, copyId, "copy_stored");
    const copy = await storage.download(copyId, photo.storageFormat);
    if (!copy || readMetadata(copy)?.metadata !== false) {
      throw new Error(`The cleaned copy of document ${photo.complianceDocumentId} did not read back clean; its original is untouched.`);
    }
    if (!(await repoint(photo, copyId))) {
      await storage.remove(copyId);
      await record(photo, copyId, "copy_removed");
      report.changedMeanwhile.push(photo.complianceDocumentId);
      continue;
    }
    await storage.remove(photo.storagePublicId);
    await record(photo, copyId, "original_removed");
    report.cleaned++;
  }
  return report;
}
