import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for complianceRetentionService.
 *
 * Two layers, matching the module's own split:
 *   1. Pure decision functions (isRetentionExpired, isOrphanedInactive) — no
 *      mocking, exhaustive boundary coverage per retention window.
 *   2. Orchestrators (archiveForOffboardedStaff, purgeExpiredRetention,
 *      pruneAccessLog) — db, auditService and documentStorageService mocked,
 *      verifying the wiring: Cloudinary deletion happens before the row
 *      delete, a failed Cloudinary deletion skips the row entirely, the
 *      orphan sweep is additive, and access-log rows get pruned.
 */

// ── Mock DB ───────────────────────────────────────────────────────────
// db.select(...).from(...).where(...) pops the next queued row set — lets
// each test script exactly what each successive SELECT in purgeExpiredRetention
// returns (withEndDate candidates, withoutEndDate candidates, subject users).
let selectQueue: unknown[][] = [];
let selectCallIdx = 0;

let updateReturningRows: unknown[] = [];
let deleteReturningRows: unknown[] = [];

const txDeleteWhereMock = vi.fn(async () => undefined);
const txDeleteMock = vi.fn(() => ({ where: txDeleteWhereMock }));
const dbTransactionMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
  const tx = { delete: txDeleteMock };
  return cb(tx);
});

const selectMock = vi.fn(() => ({
  from: vi.fn(() => ({
    where: vi.fn(async () => selectQueue[selectCallIdx++] ?? []),
  })),
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: selectMock,
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => updateReturningRows),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => deleteReturningRows),
      })),
    })),
    transaction: dbTransactionMock,
  },
}));

vi.mock("../db/schema.js", () => ({
  complianceDocument: {
    complianceDocumentId: "compliance_document_id",
    organisationId: "organisation_id",
    storagePublicId: "storage_public_id",
    engagementType: "engagement_type",
    employmentEndDate: "employment_end_date",
    userId: "user_id",
    verificationStatus: "verification_status",
    updatedDttm: "updated_dttm",
  },
  documentAccessLog: {
    documentAccessLogId: "document_access_log_id",
    createdDttm: "created_dttm",
  },
  user: {
    userId: "user_id",
    userStatus: "user_status",
    updatedDttm: "updated_dttm",
  },
}));

const deleteStoredDocumentMock = vi.fn(async () => undefined);
vi.mock("./documentStorageService.js", () => ({
  deleteStoredDocument: deleteStoredDocumentMock,
}));

const auditLogMock = vi.fn(async () => undefined);
vi.mock("./auditService.js", () => ({ log: auditLogMock }));

beforeEach(() => {
  selectQueue = [];
  selectCallIdx = 0;
  updateReturningRows = [];
  deleteReturningRows = [];
  vi.clearAllMocks();
});

const TODAY = "2026-08-06";

// ── Pure decision logic ──────────────────────────────────────────────

describe("isRetentionExpired", () => {
  it("employee: expired exactly at the 7-year boundary (inclusive)", async () => {
    const { isRetentionExpired } = await import("./complianceRetentionService.js");
    const doc = { engagementType: "employee", employmentEndDate: "2019-08-06" };
    expect(isRetentionExpired(doc, TODAY)).toBe(true);
  });

  it("employee: not yet expired one day short of 7 years", async () => {
    const { isRetentionExpired } = await import("./complianceRetentionService.js");
    const doc = { engagementType: "employee", employmentEndDate: "2019-08-07" };
    expect(isRetentionExpired(doc, TODAY)).toBe(false);
  });

  it("contractor: expired exactly at the 2-year boundary (inclusive)", async () => {
    const { isRetentionExpired } = await import("./complianceRetentionService.js");
    const doc = { engagementType: "contractor", employmentEndDate: "2024-08-06" };
    expect(isRetentionExpired(doc, TODAY)).toBe(true);
  });

  it("contractor: not yet expired one day short of 2 years", async () => {
    const { isRetentionExpired } = await import("./complianceRetentionService.js");
    const doc = { engagementType: "contractor", employmentEndDate: "2024-08-07" };
    expect(isRetentionExpired(doc, TODAY)).toBe(false);
  });

  it("agency uses the same 2-year window as contractor", async () => {
    const { isRetentionExpired } = await import("./complianceRetentionService.js");
    const doc = { engagementType: "agency", employmentEndDate: "2024-08-06" };
    expect(isRetentionExpired(doc, TODAY)).toBe(true);
  });

  it("an employee with no employment_end_date is NEVER purged by the retention window", async () => {
    const { isRetentionExpired } = await import("./complianceRetentionService.js");
    const doc = { engagementType: "employee", employmentEndDate: null };
    expect(isRetentionExpired(doc, TODAY)).toBe(false);
  });

  it("unrecognised engagement_type is a fail-closed no-op, never purged", async () => {
    const { isRetentionExpired } = await import("./complianceRetentionService.js");
    const doc = { engagementType: "volunteer", employmentEndDate: "2000-01-01" };
    expect(isRetentionExpired(doc, TODAY)).toBe(false);
  });
});

describe("isOrphanedInactive", () => {
  const inactiveOverTwoYears = { userStatus: "cancelled", updatedDttm: new Date("2024-08-05T00:00:00.000Z") };

  it("flags a never-offboarded document whose subject has been inactive over 2 years", async () => {
    const { isOrphanedInactive } = await import("./complianceRetentionService.js");
    const doc = { employmentEndDate: null, userId: 42 };
    expect(isOrphanedInactive(doc, inactiveOverTwoYears, TODAY)).toBe(true);
  });

  it("does not flag exactly at the 2-year boundary — must be OVER 2 years", async () => {
    const { isOrphanedInactive } = await import("./complianceRetentionService.js");
    const doc = { employmentEndDate: null, userId: 42 };
    const subject = { userStatus: "cancelled", updatedDttm: new Date("2024-08-06T00:00:00.000Z") };
    expect(isOrphanedInactive(doc, subject, TODAY)).toBe(false);
  });

  it("does not flag a still-active subject regardless of updatedDttm", async () => {
    const { isOrphanedInactive } = await import("./complianceRetentionService.js");
    const doc = { employmentEndDate: null, userId: 42 };
    const subject = { userStatus: "active", updatedDttm: new Date("2000-01-01T00:00:00.000Z") };
    expect(isOrphanedInactive(doc, subject, TODAY)).toBe(false);
  });

  it("does not flag a document that already has an employment_end_date", async () => {
    const { isOrphanedInactive } = await import("./complianceRetentionService.js");
    const doc = { employmentEndDate: "2020-01-01", userId: 42 };
    expect(isOrphanedInactive(doc, inactiveOverTwoYears, TODAY)).toBe(false);
  });

  it("does not flag a venue document (no subject user)", async () => {
    const { isOrphanedInactive } = await import("./complianceRetentionService.js");
    const doc = { employmentEndDate: null, userId: null };
    expect(isOrphanedInactive(doc, null, TODAY)).toBe(false);
  });
});

// ── Orchestrators ─────────────────────────────────────────────────────

describe("archiveForOffboardedStaff", () => {
  it("returns the count of documents archived", async () => {
    updateReturningRows = [{ id: "doc-1" }, { id: "doc-2" }];
    const { archiveForOffboardedStaff } = await import("./complianceRetentionService.js");
    const count = await archiveForOffboardedStaff(7, "2026-08-06");
    expect(count).toBe(2);
  });
});

describe("purgeExpiredRetention", () => {
  const expiredEmployeeDoc = {
    complianceDocumentId: "doc-expired",
    organisationId: 3,
    storagePublicId: "culinaire/compliance/org-3/doc-expired",
    engagementType: "employee",
    employmentEndDate: "2019-08-06",
    userId: 42,
  };

  const freshEmployeeDoc = {
    complianceDocumentId: "doc-fresh",
    organisationId: 3,
    storagePublicId: "culinaire/compliance/org-3/doc-fresh",
    engagementType: "employee",
    employmentEndDate: "2026-01-01",
    userId: 43,
  };

  const orphanCandidateDoc = {
    complianceDocumentId: "doc-orphan",
    organisationId: 3,
    storagePublicId: "culinaire/compliance/org-3/doc-orphan",
    engagementType: "employee",
    employmentEndDate: null,
    userId: 99,
  };

  it("purges a retention-expired document: Cloudinary deletion before the row delete, audit row written", async () => {
    selectQueue = [[expiredEmployeeDoc], []]; // withEndDate, withoutEndDate
    const { purgeExpiredRetention } = await import("./complianceRetentionService.js");

    const result = await purgeExpiredRetention(TODAY);

    expect(result).toEqual({ purged: 1, orphanSweep: 0 });
    expect(deleteStoredDocumentMock).toHaveBeenCalledWith(expiredEmployeeDoc.storagePublicId);
    expect(dbTransactionMock).toHaveBeenCalledTimes(1);
    expect(txDeleteMock).toHaveBeenCalledTimes(1);
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(auditLogMock.mock.calls[0][0]).toMatchObject({
      entityType: "compliance_document",
      entityId: "doc-expired",
      action: "soft_delete",
      actorUserId: null,
      organisationId: 3,
    });

    // Cloudinary destroyed before the row is deleted — order, not just occurrence.
    const cloudinaryCallOrder = deleteStoredDocumentMock.mock.invocationCallOrder[0];
    const rowDeleteCallOrder = txDeleteMock.mock.invocationCallOrder[0];
    expect(cloudinaryCallOrder).toBeLessThan(rowDeleteCallOrder);
  });

  it("does not purge a document still inside its retention window", async () => {
    selectQueue = [[freshEmployeeDoc], []];
    const { purgeExpiredRetention } = await import("./complianceRetentionService.js");

    const result = await purgeExpiredRetention(TODAY);

    expect(result).toEqual({ purged: 0, orphanSweep: 0 });
    expect(deleteStoredDocumentMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it("orphan sweep purges a never-offboarded document once its subject has been inactive over 2 years", async () => {
    selectQueue = [
      [], // withEndDate: none
      [orphanCandidateDoc], // withoutEndDate
      [{ userId: 99, userStatus: "suspended", updatedDttm: new Date("2024-01-01T00:00:00.000Z") }], // subjects
    ];
    const { purgeExpiredRetention } = await import("./complianceRetentionService.js");

    const result = await purgeExpiredRetention(TODAY);

    expect(result).toEqual({ purged: 1, orphanSweep: 1 });
    expect(deleteStoredDocumentMock).toHaveBeenCalledWith(orphanCandidateDoc.storagePublicId);
  });

  it("does not run the orphan sweep's user lookup when nothing is missing an end date", async () => {
    selectQueue = [[expiredEmployeeDoc], []];
    const { purgeExpiredRetention } = await import("./complianceRetentionService.js");

    await purgeExpiredRetention(TODAY);

    // Only the two compliance_document selects — no subject-user lookup fired.
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it("does not orphan-sweep a subject who is still active", async () => {
    selectQueue = [
      [],
      [orphanCandidateDoc],
      [{ userId: 99, userStatus: "active", updatedDttm: new Date("2000-01-01T00:00:00.000Z") }],
    ];
    const { purgeExpiredRetention } = await import("./complianceRetentionService.js");

    const result = await purgeExpiredRetention(TODAY);

    expect(result).toEqual({ purged: 0, orphanSweep: 0 });
    expect(deleteStoredDocumentMock).not.toHaveBeenCalled();
  });

  it("skips a document when Cloudinary deletion fails, leaving row and audit trail untouched for retry", async () => {
    const secondExpiredDoc = { ...expiredEmployeeDoc, complianceDocumentId: "doc-expired-2", storagePublicId: "culinaire/compliance/org-3/doc-expired-2" };
    selectQueue = [[expiredEmployeeDoc, secondExpiredDoc], []];
    deleteStoredDocumentMock
      .mockRejectedValueOnce(new Error("Cloudinary unavailable"))
      .mockResolvedValueOnce(undefined);

    const { purgeExpiredRetention } = await import("./complianceRetentionService.js");
    const result = await purgeExpiredRetention(TODAY);

    // Only the second document (Cloudinary succeeded) was purged.
    expect(result).toEqual({ purged: 1, orphanSweep: 0 });
    expect(dbTransactionMock).toHaveBeenCalledTimes(1);
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(auditLogMock.mock.calls[0][0]).toMatchObject({ entityId: "doc-expired-2" });
  });
});

describe("pruneAccessLog", () => {
  it("returns the count of pruned access-log rows", async () => {
    deleteReturningRows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { pruneAccessLog } = await import("./complianceRetentionService.js");

    const count = await pruneAccessLog(TODAY);

    expect(count).toBe(3);
  });

  it("accepts an explicit retainDays override without error", async () => {
    deleteReturningRows = [{ id: "a" }];
    const { pruneAccessLog } = await import("./complianceRetentionService.js");

    const count = await pruneAccessLog(TODAY, 30);

    expect(count).toBe(1);
  });
});
