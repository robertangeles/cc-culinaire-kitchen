import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for complianceExpiryJob.runExpiryScan.
 *
 * db.select(...).from(...).leftJoin()?.leftJoin()?.where() pops the next
 * queued row set off `selectQueue`, same convention as
 * complianceRetentionService.test.ts — lets each test script exactly what
 * each successive SELECT returns: the candidate documents, then per document
 * the matching document_expiry_rule row(s), then (if a rule was found) its
 * alert days.
 */

let selectQueue: (unknown[] | Error)[] = [];
let selectCallIdx = 0;

function nextRows(): Promise<unknown[]> {
  const item = selectQueue[selectCallIdx++];
  if (item instanceof Error) return Promise.reject(item);
  return Promise.resolve(item ?? []);
}

function makeSelectChain(): { where: () => Promise<unknown[]>; leftJoin: () => unknown } {
  const chain = {
    where: vi.fn(() => nextRows()),
    leftJoin: vi.fn(() => chain),
  };
  return chain;
}

const selectMock = vi.fn(() => ({ from: vi.fn(() => makeSelectChain()) }));

const updateWhereMock = vi.fn(async () => undefined);
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
const updateMock = vi.fn(() => ({ set: updateSetMock }));

vi.mock("../db/index.js", () => ({
  db: {
    select: selectMock,
    update: updateMock,
  },
}));

vi.mock("../db/schema.js", () => ({
  complianceDocument: {
    complianceDocumentId: "compliance_document_id",
    organisationId: "organisation_id",
    storeLocationId: "store_location_id",
    userId: "user_id",
    documentType: "document_type",
    expiryDate: "expiry_date",
    verificationStatus: "verification_status",
    updatedDttm: "updated_dttm",
  },
  documentExpiryRule: {
    documentExpiryRuleId: "document_expiry_rule_id",
    documentType: "document_type",
    jurisdiction: "jurisdiction",
    effectiveFrom: "effective_from",
    effectiveTo: "effective_to",
    trainingProviderUrl: "training_provider_url",
  },
  documentExpiryRuleAlertDay: {
    documentExpiryRuleId: "document_expiry_rule_id",
    daysBefore: "days_before",
  },
  storeLocation: {
    storeLocationId: "store_location_id",
    state: "state",
    locationName: "location_name",
  },
  user: {
    userId: "user_id",
    userName: "user_name",
  },
}));

const createInAppMock = vi.fn(async () => undefined);
const notifyHQAdminsMock = vi.fn(async () => undefined);
const hasRecentNotificationMock = vi.fn(async () => false);
vi.mock("./notificationService.js", () => ({
  createInApp: createInAppMock,
  notifyHQAdmins: notifyHQAdminsMock,
  hasRecentNotification: hasRecentNotificationMock,
}));

beforeEach(() => {
  selectQueue = [];
  selectCallIdx = 0;
  vi.clearAllMocks();
  hasRecentNotificationMock.mockResolvedValue(false);
});

const TODAY = "2026-08-06";

const nationalRule = {
  documentExpiryRuleId: "rule-national",
  jurisdiction: null,
  effectiveFrom: "2020-01-01",
  effectiveTo: null,
  trainingProviderUrl: null,
};

// expiryDate 30 calendar days after TODAY (2026-08-06 -> 2026-09-05).
const ALERT_EXPIRY_DATE = "2026-09-05";

describe("runExpiryScan", () => {
  it("flips a document expiring today to Expired", async () => {
    const doc = {
      complianceDocumentId: "doc-expired",
      organisationId: 3,
      userId: 7,
      documentType: "RSA",
      expiryDate: TODAY,
      verificationStatus: "Verified",
      staffName: "Alex Ng",
      venueState: "VIC",
      venueName: "CBD Store",
    };

    selectQueue = [
      [doc], // documents
      [nationalRule], // rule lookup
      [{ daysBefore: 30 }], // alert days (irrelevant — daysRemaining is 0)
    ];

    const { runExpiryScan } = await import("./complianceExpiryJob.js");
    const result = await runExpiryScan(TODAY);

    expect(result).toEqual({ scanned: 1, notified: 0, expired: 1 });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ verificationStatus: "Expired" }),
    );
    expect(createInAppMock).not.toHaveBeenCalled();
    expect(notifyHQAdminsMock).not.toHaveBeenCalled();
  });

  it("an alert-day match notifies both the staff member and the org admins", async () => {
    const doc = {
      complianceDocumentId: "doc-alert",
      organisationId: 3,
      userId: 7,
      documentType: "RSA",
      expiryDate: ALERT_EXPIRY_DATE,
      verificationStatus: "Verified",
      staffName: "Alex Ng",
      venueState: "NSW",
      venueName: "CBD Store",
    };
    const rule = {
      documentExpiryRuleId: "rule-nsw",
      jurisdiction: "NSW",
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
      trainingProviderUrl: "https://training.example.com/rsa",
    };

    selectQueue = [
      [doc],
      [rule],
      [{ daysBefore: 90 }, { daysBefore: 30 }, { daysBefore: 7 }],
    ];

    const { runExpiryScan } = await import("./complianceExpiryJob.js");
    const result = await runExpiryScan(TODAY);

    expect(result).toEqual({ scanned: 1, notified: 1, expired: 0 });

    expect(createInAppMock).toHaveBeenCalledTimes(1);
    expect(createInAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: 3,
        recipientUserId: 7,
        relatedEntityType: "compliance_document",
        relatedEntityId: "doc-alert",
        payload: expect.objectContaining({
          staffName: "Alex Ng",
          documentType: "RSA",
          expiryDate: "5 September 2026",
          daysRemaining: 30,
          trainingProviderUrl: "https://training.example.com/rsa",
        }),
      }),
    );

    expect(notifyHQAdminsMock).toHaveBeenCalledTimes(1);
    const hqCall = notifyHQAdminsMock.mock.calls[0];
    expect(hqCall[0]).toBe(3); // orgId
    expect(hqCall[3]).toBe("compliance_document"); // relatedEntityType
    expect(hqCall[4]).toBe("doc-alert"); // relatedEntityId
    expect(hqCall[5]).toContain("30 days"); // email subject mentions the countdown
  });

  it("a second run notifies nobody because of dedup", async () => {
    const doc = {
      complianceDocumentId: "doc-alert",
      organisationId: 3,
      userId: 7,
      documentType: "RSA",
      expiryDate: ALERT_EXPIRY_DATE,
      verificationStatus: "Verified",
      staffName: "Alex Ng",
      venueState: "NSW",
      venueName: "CBD Store",
    };
    const rule = {
      documentExpiryRuleId: "rule-nsw",
      jurisdiction: "NSW",
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
      trainingProviderUrl: null,
    };

    hasRecentNotificationMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const { runExpiryScan } = await import("./complianceExpiryJob.js");

    selectQueue = [[doc], [rule], [{ daysBefore: 30 }]];
    selectCallIdx = 0;
    const first = await runExpiryScan(TODAY);

    selectQueue = [[doc], [rule], [{ daysBefore: 30 }]];
    selectCallIdx = 0;
    const second = await runExpiryScan(TODAY);

    expect(first.notified).toBe(1);
    expect(second.notified).toBe(0);
    expect(createInAppMock).toHaveBeenCalledTimes(1);
    expect(notifyHQAdminsMock).toHaveBeenCalledTimes(1);
  });

  it("never scans a null-expiry document", async () => {
    const doc = {
      complianceDocumentId: "doc-no-expiry",
      organisationId: 3,
      userId: 7,
      documentType: "Police Clearance",
      expiryDate: null,
      verificationStatus: "Verified",
      staffName: "Alex Ng",
      venueState: "VIC",
      venueName: "CBD Store",
    };

    selectQueue = [[doc]];

    const { runExpiryScan } = await import("./complianceExpiryJob.js");
    const result = await runExpiryScan(TODAY);

    expect(result).toEqual({ scanned: 0, notified: 0, expired: 0 });
    // Only the initial document select fired — a rule lookup was never attempted.
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(createInAppMock).not.toHaveBeenCalled();
    expect(notifyHQAdminsMock).not.toHaveBeenCalled();
  });

  it("a row that throws does not abort the remaining rows", async () => {
    const docA = {
      complianceDocumentId: "doc-a-throws",
      organisationId: 3,
      userId: 7,
      documentType: "RSA",
      expiryDate: ALERT_EXPIRY_DATE,
      verificationStatus: "Verified",
      staffName: "Alex Ng",
      venueState: "NSW",
      venueName: "CBD Store",
    };
    const docB = {
      complianceDocumentId: "doc-b-ok",
      organisationId: 3,
      userId: 8,
      documentType: "RSA",
      expiryDate: ALERT_EXPIRY_DATE,
      verificationStatus: "Verified",
      staffName: "Sam Lee",
      venueState: "NSW",
      venueName: "CBD Store",
    };
    const rule = {
      documentExpiryRuleId: "rule-nsw",
      jurisdiction: "NSW",
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
      trainingProviderUrl: null,
    };

    selectQueue = [
      [docA, docB], // documents
      new Error("rule lookup failed"), // doc A's rule select throws
      [rule], // doc B's rule select
      [{ daysBefore: 30 }], // doc B's alert days
    ];

    const { runExpiryScan } = await import("./complianceExpiryJob.js");
    const result = await runExpiryScan(TODAY);

    expect(result).toEqual({ scanned: 2, notified: 1, expired: 0 });
    expect(createInAppMock).toHaveBeenCalledTimes(1);
    expect(createInAppMock).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 8, relatedEntityId: "doc-b-ok" }),
    );
  });

  it("returns accurate scanned/notified/expired counts across a mixed batch", async () => {
    const expiredDoc = {
      complianceDocumentId: "doc-1",
      organisationId: 3,
      userId: 7,
      documentType: "RSA",
      expiryDate: TODAY,
      verificationStatus: "Verified",
      staffName: "Alex Ng",
      venueState: "VIC",
      venueName: "CBD Store",
    };
    const alertDoc = {
      complianceDocumentId: "doc-2",
      organisationId: 3,
      userId: 8,
      documentType: "RSA",
      expiryDate: ALERT_EXPIRY_DATE,
      verificationStatus: "Verified",
      staffName: "Sam Lee",
      venueState: "NSW",
      venueName: "CBD Store",
    };
    const noRuleDoc = {
      complianceDocumentId: "doc-3",
      organisationId: 3,
      userId: 9,
      documentType: "Food Handler",
      expiryDate: ALERT_EXPIRY_DATE,
      verificationStatus: "Verified",
      staffName: "Jo Park",
      venueState: "QLD",
      venueName: "CBD Store",
    };
    const nswRule = {
      documentExpiryRuleId: "rule-nsw",
      jurisdiction: "NSW",
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
      trainingProviderUrl: null,
    };

    selectQueue = [
      [expiredDoc, alertDoc, noRuleDoc], // documents
      [nationalRule], // doc-1 rule
      [{ daysBefore: 30 }], // doc-1 alert days
      [nswRule], // doc-2 rule
      [{ daysBefore: 30 }], // doc-2 alert days
      [], // doc-3 rule lookup: no matching rule at all
    ];

    const { runExpiryScan } = await import("./complianceExpiryJob.js");
    const result = await runExpiryScan(TODAY);

    expect(result).toEqual({ scanned: 3, notified: 1, expired: 1 });
  });
});
