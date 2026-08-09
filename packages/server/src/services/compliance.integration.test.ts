import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

// Load .env before the first query — see tenantIsolation.integration.test.ts / other
// *.integration.test.ts files for the full rationale. `db` is a lazy proxy that
// connects on first use, not on import, so running this after the import
// statements is early enough.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  userOrganisation,
  complianceDocument,
  documentExpiryRule,
  documentExpiryRuleAlertDay,
  organisationRequiredDocument,
  notification,
  auditLog,
} from "../db/schema.js";
import {
  createDocument,
  listDocumentsForUser,
  verifyDocument,
  rejectDocument,
  getDocument,
  isOwnDocument,
  listStaffCompliance,
  getComplianceDashboard,
  setRequiredDocuments,
} from "./complianceService.js";
import { runExpiryScan } from "./complianceExpiryJob.js";

/**
 * Real-database behaviour of the Compliance Vault, end to end against Postgres.
 *
 * Gated on TENANT_IT=1 so it is skipped by the DB-less main CI job and run only
 * by the dedicated Postgres integration job (and locally against a dev DB).
 * Self-cleaning: each describe block deletes exactly the rows it seeded, children
 * before parents — this is a SHARED dev database and leaked rows are a real past
 * incident in this repo.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `cv_${Date.now().toString(36)}`;

/** Calendar-day arithmetic on "YYYY-MM-DD" strings, UTC-normalised. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Build a storage id the way a real upload would.
 *
 * createDocument REJECTS any public_id outside the uploader's own
 * `org-<id>/user-<id>/` folder — that guard is what stops a caller pointing
 * their row at another tenant's (or a colleague's) Cloudinary asset. Fixtures
 * therefore have to look like genuine upload results; an arbitrary string is
 * exactly what the guard exists to refuse.
 */
function sp(orgId: number, userId: number, name: string): string {
  return `culinaire/compliance/org-${orgId}/user-${userId}/${name}`;
}

describe.skipIf(!RUN)("compliance vault (real DB)", () => {
  // ── Group 1: document lifecycle — create, verify, reject, read-own ──────
  describe("document lifecycle", () => {
    let staffA: number;
    let staffB: number;
    let org1: number;
    let org2: number;

    beforeAll(async () => {
      [{ userId: staffA }] = await db
        .insert(user)
        .values({ userName: "Compliance A", userEmail: `${tag}-a@it.test` })
        .returning({ userId: user.userId });
      [{ userId: staffB }] = await db
        .insert(user)
        .values({ userName: "Compliance B", userEmail: `${tag}-b@it.test` })
        .returning({ userId: user.userId });

      [{ id: org1 }] = await db
        .insert(organisation)
        .values({ organisationName: `${tag}-org1`, joinKey: `${tag}-jk1`, createdBy: staffA })
        .returning({ id: organisation.organisationId });
      // A second org used only as a cross-tenant negative case — never written to.
      [{ id: org2 }] = await db
        .insert(organisation)
        .values({ organisationName: `${tag}-org2`, joinKey: `${tag}-jk2`, createdBy: staffA })
        .returning({ id: organisation.organisationId });

      await db.insert(userOrganisation).values([
        { userId: staffA, organisationId: org1, role: "member" },
        { userId: staffB, organisationId: org1, role: "admin" },
      ]);
    });

    afterAll(async () => {
      await db.delete(complianceDocument).where(eq(complianceDocument.organisationId, org1));
      await db.delete(auditLog).where(eq(auditLog.organisationId, org1));
      await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, org1));
      await db.delete(organisation).where(inArray(organisation.organisationId, [org1, org2]));
      await db.delete(user).where(inArray(user.userId, [staffA, staffB]));
    });

    it("createDocument then listDocumentsForUser returns it", async () => {
      const created = await createDocument(org1, {
        userId: staffA,
        uploadedBy: staffA,
        documentType: `${tag}-passport`,
        storagePublicId: sp(org1, staffA, "passport"),
      });
      expect(created.verificationStatus).toBe("Pending");

      const list = await listDocumentsForUser(org1, staffA);
      expect(list.some((d) => d.complianceDocumentId === created.complianceDocumentId)).toBe(true);
    });

    it("verifyDocument sets status Verified and stamps verifier + timestamp", async () => {
      const doc = await createDocument(org1, {
        userId: staffA,
        uploadedBy: staffA,
        documentType: `${tag}-verify-type`,
        storagePublicId: sp(org1, staffA, "verify"),
      });

      const before = Date.now();
      const verified = await verifyDocument(org1, doc.complianceDocumentId, staffB);

      expect(verified.verificationStatus).toBe("Verified");
      expect(verified.verifiedBy).toBe(staffB);
      expect(verified.verifiedAt).toBeInstanceOf(Date);
      expect((verified.verifiedAt as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it("rejectDocument requires a non-empty reason and stores it for the staff member to see", async () => {
      const doc = await createDocument(org1, {
        userId: staffA,
        uploadedBy: staffA,
        documentType: `${tag}-reject-type`,
        storagePublicId: sp(org1, staffA, "reject"),
      });

      await expect(rejectDocument(org1, doc.complianceDocumentId, staffB, "")).rejects.toMatchObject({
        statusCode: 400,
      });
      await expect(rejectDocument(org1, doc.complianceDocumentId, staffB, "   ")).rejects.toMatchObject({
        statusCode: 400,
      });

      // Neither failed attempt changed anything.
      const stillPending = await getDocument(org1, doc.complianceDocumentId);
      expect(stillPending.verificationStatus).toBe("Pending");

      const rejected = await rejectDocument(
        org1,
        doc.complianceDocumentId,
        staffB,
        "  Photo is blurry, please re-upload  ",
      );
      expect(rejected.verificationStatus).toBe("Rejected");
      expect(rejected.rejectionReason).toBe("Photo is blurry, please re-upload"); // trimmed
    });

    it("isOwnDocument distinguishes the owner from a colleague; a cross-org read is a 404", async () => {
      const own = await createDocument(org1, {
        userId: staffA,
        uploadedBy: staffA,
        documentType: `${tag}-own-type`,
        storagePublicId: sp(org1, staffA, "own"),
      });

      expect(isOwnDocument(own, staffA)).toBe(true);
      // staffB is a colleague (and even the org's verifier) — never "own" this document.
      expect(isOwnDocument(own, staffB)).toBe(false);

      const fetched = await getDocument(org1, own.complianceDocumentId);
      expect(fetched.complianceDocumentId).toBe(own.complianceDocumentId);

      // A caller scoped to a different org can't reach it even by guessing the
      // right id — reads 404, not a leak of "exists but forbidden".
      await expect(getDocument(org2, own.complianceDocumentId)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    // The storage id is the ONE referenced id that arrives from the client —
    // it is echoed back from the upload response — so it needs the same org
    // check userId and storeLocationId already get.
    //
    // Without it, the attack is: read a public_id (they are not secret, every
    // signed URL carries one in its path), POST a document row of your own
    // pointing at it, and every existing tenant check passes, because the row's
    // organisationId and userId are written from YOUR context. The row is
    // yours, so the vault mints you a working signed URL for someone else's
    // police check. The retention purge then deletes on the same field, so a
    // forged row aging into retention would destroy the victim's real asset.
    it("REFUSES a storage id from another organisation's folder", async () => {
      await expect(
        createDocument(org1, {
          userId: staffA,
          uploadedBy: staffA,
          documentType: `${tag}-forged-cross-org`,
          storagePublicId: sp(org2, staffA, "someone-elses-police-check"),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    // Org scoping alone would let this through, which is why the folder is
    // scoped per user too: compliance:read-own must mean OWN, not "anyone's".
    it("REFUSES a colleague's storage id from within the same organisation", async () => {
      await expect(
        createDocument(org1, {
          userId: staffA,
          uploadedBy: staffA,
          documentType: `${tag}-forged-same-org`,
          storagePublicId: sp(org1, staffB, "colleagues-medicare-card"),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("REFUSES an arbitrary string that is not an upload reference at all", async () => {
      await expect(
        createDocument(org1, {
          userId: staffA,
          uploadedBy: staffA,
          documentType: `${tag}-forged-junk`,
          storagePublicId: "sp-passport",
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    // A prefix check is only safe if it cannot be walked out of. Cloudinary
    // public_ids are path-shaped, so "org-1/user-1/../user-2/x" must not pass
    // by starting with the right characters.
    it("REFUSES a traversal that merely STARTS with the caller's folder", async () => {
      await expect(
        createDocument(org1, {
          userId: staffA,
          uploadedBy: staffA,
          documentType: `${tag}-forged-traversal`,
          storagePublicId: `${sp(org1, staffA, "")}../user-${staffB}/colleagues-doc`,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  // ── Group 2: staff compliance matrix + dashboard reconciliation ─────────
  describe("staff compliance matrix + dashboard", () => {
    const typeCert = `${tag}-cert`;
    const typePolice = `${tag}-police`;
    let staffE: number;
    let staffF: number;
    let org3: number;

    beforeAll(async () => {
      [{ userId: staffE }] = await db
        .insert(user)
        .values({ userName: "Compliance E", userEmail: `${tag}-e@it.test` })
        .returning({ userId: user.userId });
      [{ userId: staffF }] = await db
        .insert(user)
        .values({ userName: "Compliance F", userEmail: `${tag}-f@it.test` })
        .returning({ userId: user.userId });

      [{ id: org3 }] = await db
        .insert(organisation)
        .values({ organisationName: `${tag}-org3`, joinKey: `${tag}-jk3`, createdBy: staffE })
        .returning({ id: organisation.organisationId });

      await db.insert(userOrganisation).values([
        { userId: staffE, organisationId: org3, role: "member" },
        { userId: staffF, organisationId: org3, role: "admin" },
      ]);

      await setRequiredDocuments(org3, [typeCert, typePolice]);

      // staffE holds TWO certs: an expired original and a fresh verified
      // replacement. staffE never uploads a police clearance. staffF uploads
      // nothing at all.
      const stale = await createDocument(org3, {
        userId: staffE,
        uploadedBy: staffE,
        documentType: typeCert,
        storagePublicId: sp(org3, staffE, "cert-old"),
        expiryDate: "2020-01-01",
      });
      await verifyDocument(org3, stale.complianceDocumentId, staffF);

      const fresh = await createDocument(org3, {
        userId: staffE,
        uploadedBy: staffE,
        documentType: typeCert,
        storagePublicId: sp(org3, staffE, "cert-new"),
        expiryDate: "2099-01-01",
      });
      await verifyDocument(org3, fresh.complianceDocumentId, staffF);
    });

    afterAll(async () => {
      await db.delete(complianceDocument).where(eq(complianceDocument.organisationId, org3));
      await db.delete(auditLog).where(eq(auditLog.organisationId, org3));
      await db.delete(organisationRequiredDocument).where(eq(organisationRequiredDocument.organisationId, org3));
      await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, org3));
      await db.delete(organisation).where(eq(organisation.organisationId, org3));
      await db.delete(user).where(inArray(user.userId, [staffE, staffF]));
    });

    it("returns one entry per required type per staff member, 'na' when nothing was uploaded, and the BEST document when duplicates exist", async () => {
      const rows = await listStaffCompliance(org3);
      const mine = rows.filter((r) => r.userId === staffE || r.userId === staffF);

      // One row per staff member, one document entry per required type.
      expect(mine).toHaveLength(2);
      expect(mine.flatMap((r) => r.documents)).toHaveLength(4);

      const staffERow = mine.find((r) => r.userId === staffE)!;
      const staffFRow = mine.find((r) => r.userId === staffF)!;

      const eCert = staffERow.documents.find((d) => d.documentType === typeCert)!;
      const ePolice = staffERow.documents.find((d) => d.documentType === typePolice)!;
      const fCert = staffFRow.documents.find((d) => d.documentType === typeCert)!;
      const fPolice = staffFRow.documents.find((d) => d.documentType === typePolice)!;

      // Best document wins: the fresh verified replacement, not the expired original.
      expect(eCert.status).toBe("compliant");
      expect(eCert.expiryDate).toBe("2099-01-01");
      // Never uploaded -> na, not "expired" or absent.
      expect(ePolice.status).toBe("na");
      expect(fCert.status).toBe("na");
      expect(fPolice.status).toBe("na");
    });

    it("dashboard counts reconcile with what the staff compliance table shows", async () => {
      const rows = await listStaffCompliance(org3);
      const mine = rows.filter((r) => r.userId === staffE || r.userId === staffF);
      const allEntries = mine.flatMap((r) => r.documents);

      const dashboard = await getComplianceDashboard(org3);

      const tableCompliantCount = allEntries.filter((d) => d.status === "compliant").length;
      const tableExpiredCount = allEntries.filter((d) => d.status === "expired").length;
      const tableIncompleteStaffCount = mine.filter((r) =>
        r.documents.some((d) => d.status !== "compliant"),
      ).length;

      // The headline "compliant" count and the "incomplete" count must agree
      // with what the table underneath actually shows.
      expect(dashboard.allCurrent).toBe(tableCompliantCount);
      expect(dashboard.incompleteForRole).toBe(tableIncompleteStaffCount);
      // The "expired" headline must also agree with the table: a document type
      // whose BEST record is "compliant" (staffE's cert, via the fresh
      // replacement) must not still be counted as "expired" in the headline
      // just because a superseded, no-longer-relevant record for that same
      // type/staff exists underneath it.
      expect(dashboard.expired).toBe(tableExpiredCount);
    });
  });

  // ── Group 3: expiry scan ─────────────────────────────────────────────────
  describe("expiry scan", () => {
    const TODAY = "2026-01-15";
    const ruleType = `${tag}-rsa`;
    let staffG: number;
    let org4: number;
    let ruleId: string;
    let expiringTodayId: string;
    let alertDueId: string;

    beforeAll(async () => {
      [{ userId: staffG }] = await db
        .insert(user)
        .values({ userName: "Compliance G", userEmail: `${tag}-g@it.test` })
        .returning({ userId: user.userId });

      [{ id: org4 }] = await db
        .insert(organisation)
        .values({ organisationName: `${tag}-org4`, joinKey: `${tag}-jk4`, createdBy: staffG })
        .returning({ id: organisation.organisationId });

      [{ id: ruleId }] = await db
        .insert(documentExpiryRule)
        .values({ documentType: ruleType, jurisdiction: null, effectiveFrom: "2020-01-01" })
        .returning({ id: documentExpiryRule.documentExpiryRuleId });
      await db.insert(documentExpiryRuleAlertDay).values({ documentExpiryRuleId: ruleId, daysBefore: 30 });

      [{ id: expiringTodayId }] = await db
        .insert(complianceDocument)
        .values({
          organisationId: org4,
          userId: staffG,
          documentType: ruleType,
          storagePublicId: "sp-exp-today",
          verificationStatus: "Verified",
          expiryDate: TODAY,
          uploadedBy: staffG,
        })
        .returning({ id: complianceDocument.complianceDocumentId });

      [{ id: alertDueId }] = await db
        .insert(complianceDocument)
        .values({
          organisationId: org4,
          userId: staffG,
          documentType: ruleType,
          storagePublicId: "sp-exp-alert",
          verificationStatus: "Verified",
          expiryDate: addDays(TODAY, 30), // exactly matches the 30-day alert day
          uploadedBy: staffG,
        })
        .returning({ id: complianceDocument.complianceDocumentId });
    });

    afterAll(async () => {
      await db.delete(notification).where(eq(notification.organisationId, org4));
      await db.delete(complianceDocument).where(eq(complianceDocument.organisationId, org4));
      await db.delete(documentExpiryRuleAlertDay).where(eq(documentExpiryRuleAlertDay.documentExpiryRuleId, ruleId));
      await db.delete(documentExpiryRule).where(eq(documentExpiryRule.documentExpiryRuleId, ruleId));
      await db.delete(organisation).where(eq(organisation.organisationId, org4));
      await db.delete(user).where(eq(user.userId, staffG));
    });

    it("flips a document expiring today to Expired", async () => {
      const result = await runExpiryScan(TODAY);
      expect(result).toEqual({ scanned: 2, notified: 1, expired: 1 });

      const [row] = await db
        .select({ status: complianceDocument.verificationStatus })
        .from(complianceDocument)
        .where(eq(complianceDocument.complianceDocumentId, expiringTodayId));
      expect(row.status).toBe("Expired");
    });

    it("does not double-notify when the scan runs twice (hasRecentNotification dedup)", async () => {
      const before = await db
        .select({ id: notification.notificationId })
        .from(notification)
        .where(eq(notification.relatedEntityId, alertDueId));
      expect(before).toHaveLength(1); // the first run's alert, from the previous test

      const second = await runExpiryScan(TODAY);
      expect(second).toEqual({ scanned: 2, notified: 0, expired: 1 });

      const after = await db
        .select({ id: notification.notificationId })
        .from(notification)
        .where(eq(notification.relatedEntityId, alertDueId));
      expect(after).toHaveLength(1); // still exactly one — dedup held
    });
  });
});
