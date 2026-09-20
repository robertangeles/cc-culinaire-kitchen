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

import { eq, inArray, and, isNull, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  userOrganisation,
  storeLocation,
  complianceDocument,
  documentAccessLog,
  documentExpiryRule,
  documentExpiryRuleAlertDay,
  organisationRequiredDocument,
  notification,
  auditLog,
} from "../db/schema.js";
import {
  createDocument,
  listDocumentsForUser,
  updateDocument,
  deleteDocument,
  verifyDocument,
  rejectDocument,
  nudgeVerifier,
  getDocument,
  isOwnDocument,
  listStaffCompliance,
  getComplianceDashboard,
  setRequiredDocuments,
  upsertExpiryRule,
} from "./complianceService.js";
import { runExpiryScan } from "./complianceExpiryJob.js";
import { archiveForOffboardedStaff } from "./complianceRetentionService.js";
import { handleGetDocumentViewUrl } from "../controllers/complianceController.js";

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

    it("updateDocument edits a Pending document's own fields, staying Pending", async () => {
      const doc = await createDocument(org1, {
        userId: staffA,
        uploadedBy: staffA,
        documentType: `${tag}-edit-pending`,
        storagePublicId: sp(org1, staffA, "edit-pending"),
      });

      const updated = await updateDocument(org1, doc.complianceDocumentId, staffA, {
        documentNumber: "ABC-123",
        expiryDate: "2027-06-01",
      });
      expect(updated.documentNumber).toBe("ABC-123");
      expect(updated.expiryDate).toBe("2027-06-01");
      expect(updated.verificationStatus).toBe("Pending");
    });

    it("updateDocument on a Rejected document resubmits it to Pending and clears the rejection reason", async () => {
      const doc = await createDocument(org1, {
        userId: staffA,
        uploadedBy: staffA,
        documentType: `${tag}-edit-rejected`,
        storagePublicId: sp(org1, staffA, "edit-rejected"),
      });
      await rejectDocument(org1, doc.complianceDocumentId, staffB, "Wrong document number");

      const updated = await updateDocument(org1, doc.complianceDocumentId, staffA, {
        documentNumber: "FIXED-1",
      });
      expect(updated.verificationStatus).toBe("Pending");
      expect(updated.rejectionReason).toBeNull();
      expect(updated.documentNumber).toBe("FIXED-1");
    });

    it("updateDocument REFUSES to edit a Verified document", async () => {
      const doc = await createDocument(org1, {
        userId: staffA,
        uploadedBy: staffA,
        documentType: `${tag}-edit-verified`,
        storagePublicId: sp(org1, staffA, "edit-verified"),
      });
      await verifyDocument(org1, doc.complianceDocumentId, staffB);

      await expect(
        updateDocument(org1, doc.complianceDocumentId, staffA, { documentNumber: "SHOULD-FAIL" }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("updateDocument REFUSES a colleague editing someone else's document (404, not 403)", async () => {
      const doc = await createDocument(org1, {
        userId: staffA,
        uploadedBy: staffA,
        documentType: `${tag}-edit-not-owner`,
        storagePublicId: sp(org1, staffA, "edit-not-owner"),
      });

      await expect(
        updateDocument(org1, doc.complianceDocumentId, staffB, { documentNumber: "NOT-YOURS" }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    // deleteDocument's happy path (Pending/Rejected -> actually removed, Cloudinary
    // blob destroyed first) is deliberately NOT exercised here: deleteStoredDocument
    // calls the real Cloudinary API via credentials from the Integrations panel,
    // which this suite has no business depending on. Both guards below are
    // ownership/status checks that throw BEFORE deleteStoredDocument is ever
    // called (see complianceService.deleteDocument), so they're safe to run
    // against the real DB with zero Cloudinary interaction.
    it("deleteDocument REFUSES to delete a Verified document", async () => {
      const doc = await createDocument(org1, {
        userId: staffA,
        uploadedBy: staffA,
        documentType: `${tag}-delete-verified`,
        storagePublicId: sp(org1, staffA, "delete-verified"),
      });
      await verifyDocument(org1, doc.complianceDocumentId, staffB);

      await expect(deleteDocument(org1, doc.complianceDocumentId, staffA)).rejects.toMatchObject({
        statusCode: 409,
      });
      // Refused, so it must still be there.
      const stillThere = await getDocument(org1, doc.complianceDocumentId);
      expect(stillThere.verificationStatus).toBe("Verified");
    });

    it("deleteDocument REFUSES a colleague deleting someone else's document (404, not 403)", async () => {
      const doc = await createDocument(org1, {
        userId: staffA,
        uploadedBy: staffA,
        documentType: `${tag}-delete-not-owner`,
        storagePublicId: sp(org1, staffA, "delete-not-owner"),
      });

      await expect(deleteDocument(org1, doc.complianceDocumentId, staffB)).rejects.toMatchObject({
        statusCode: 404,
      });
      // Refused, so it must still be there.
      const stillThere = await getDocument(org1, doc.complianceDocumentId);
      expect(stillThere.complianceDocumentId).toBe(doc.complianceDocumentId);
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

    // The state EVERY organisation is in until an admin first opens
    // Settings -> Requirements. An inner join here collapses the whole matrix
    // to zero rows, so the dashboard says "No one on the team yet" about an org
    // that plainly has staff, and every control gated behind a non-empty staff
    // list — the audit PDF export among them — vanishes with it.
    //
    // This is the test that should have existed the first time this was
    // "fixed": the earlier attempt corrected getComplianceDashboard's join and
    // left this one alone, and passed its verification only because seed data
    // happened to be present, which gave the inner join rows to match.
    it("returns staff even when the org has configured NO required document types", async () => {
      const [{ userId: staffG }] = await db
        .insert(user)
        .values({ userName: "Compliance G", userEmail: `${tag}-g@it.test` })
        .returning({ userId: user.userId });
      const [{ id: org4 }] = await db
        .insert(organisation)
        .values({
          organisationName: `${tag}-no-reqs`,
          joinKey: `${tag}-jk4`,
          createdBy: staffG,
        })
        .returning({ id: organisation.organisationId });
      await db
        .insert(userOrganisation)
        .values({ userId: staffG, organisationId: org4, role: "member" });

      try {
        // Deliberately no setRequiredDocuments call — that is the whole point.
        const rows = await listStaffCompliance(org4);

        expect(rows).toHaveLength(1);
        expect(rows[0].userId).toBe(staffG);
        // Present, with nothing to show — which the client renders differently
        // from having no staff at all.
        expect(rows[0].documents).toEqual([]);
      } finally {
        await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, org4));
        await db.delete(organisation).where(eq(organisation.organisationId, org4));
        await db.delete(user).where(eq(user.userId, staffG));
      }
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

  // ── Group 2b: upsertExpiryRule (auto-supersede write path) ────────────────
  describe("upsertExpiryRule", () => {
    const documentType = `${tag}-upsert-rsa`;
    let createdRuleIds: string[] = [];
    let actorUserId: number;

    beforeAll(async () => {
      [{ userId: actorUserId }] = await db
        .insert(user)
        .values({ userName: "Rule Upsert Actor", userEmail: `${tag}-upsert-actor@it.test` })
        .returning({ userId: user.userId });
    });

    afterAll(async () => {
      await db
        .delete(auditLog)
        .where(and(eq(auditLog.entityType, "document_expiry_rule"), eq(auditLog.actorUserId, actorUserId)));
      if (createdRuleIds.length > 0) {
        await db
          .delete(documentExpiryRuleAlertDay)
          .where(inArray(documentExpiryRuleAlertDay.documentExpiryRuleId, createdRuleIds));
        await db.delete(documentExpiryRule).where(inArray(documentExpiryRule.documentExpiryRuleId, createdRuleIds));
      }
      await db.delete(user).where(eq(user.userId, actorUserId));
    });

    it("creates a new rule with no prior active row, and audit-logs the insert", async () => {
      const created = await upsertExpiryRule({ documentType, jurisdiction: null, effectiveFrom: "2020-01-01" }, actorUserId);
      createdRuleIds.push(created.documentExpiryRuleId);
      expect(created.effectiveFrom).toBe("2020-01-01");

      const [row] = await db
        .select({ effectiveTo: documentExpiryRule.effectiveTo })
        .from(documentExpiryRule)
        .where(eq(documentExpiryRule.documentExpiryRuleId, created.documentExpiryRuleId));
      expect(row.effectiveTo).toBeNull();

      const [auditRow] = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "document_expiry_rule"), eq(auditLog.entityId, created.documentExpiryRuleId)));
      expect(auditRow.action).toBe("create");
    });

    it("auto-supersede: a later edit closes the old row, audit-logs both halves, and both remain visible in history", async () => {
      const first = await upsertExpiryRule({ documentType, jurisdiction: "NSW", effectiveFrom: "2021-01-01" }, actorUserId);
      createdRuleIds.push(first.documentExpiryRuleId);

      const second = await upsertExpiryRule({ documentType, jurisdiction: "NSW", effectiveFrom: "2022-06-01" }, actorUserId);
      createdRuleIds.push(second.documentExpiryRuleId);

      const [closedFirst] = await db
        .select({ effectiveTo: documentExpiryRule.effectiveTo })
        .from(documentExpiryRule)
        .where(eq(documentExpiryRule.documentExpiryRuleId, first.documentExpiryRuleId));
      expect(closedFirst.effectiveTo).toBe("2022-05-31");

      const [stillOpenSecond] = await db
        .select({ effectiveTo: documentExpiryRule.effectiveTo })
        .from(documentExpiryRule)
        .where(eq(documentExpiryRule.documentExpiryRuleId, second.documentExpiryRuleId));
      expect(stillOpenSecond.effectiveTo).toBeNull();

      const closeAudits = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityType, "document_expiry_rule"),
            eq(auditLog.entityId, first.documentExpiryRuleId),
            eq(auditLog.action, "update"),
          ),
        );
      expect(closeAudits).toHaveLength(1); // the close-row half, distinct from first's own earlier "create" row
    });

    it("rejects a same-day edit that would invert the closed row's date range", async () => {
      const first = await upsertExpiryRule(
        { documentType, jurisdiction: "QLD", effectiveFrom: "2026-03-01" },
        actorUserId,
      );
      createdRuleIds.push(first.documentExpiryRuleId);

      // Second edit dated the SAME day as the still-active row's own effectiveFrom.
      await expect(
        upsertExpiryRule({ documentType, jurisdiction: "QLD", effectiveFrom: "2026-03-01" }, actorUserId),
      ).rejects.toThrow("already updated today");

      const [unchanged] = await db
        .select({ effectiveTo: documentExpiryRule.effectiveTo })
        .from(documentExpiryRule)
        .where(eq(documentExpiryRule.documentExpiryRuleId, first.documentExpiryRuleId));
      expect(unchanged.effectiveTo).toBeNull(); // rejected attempt left the active row untouched
    });

    it("two concurrent creates for the same key: exactly one active row survives, no unhandled 23505", async () => {
      const concurrentType = `${tag}-concurrent-rsa`;
      const [a, b] = await Promise.allSettled([
        upsertExpiryRule({ documentType: concurrentType, jurisdiction: "VIC", effectiveFrom: "2023-01-01" }, actorUserId),
        upsertExpiryRule({ documentType: concurrentType, jurisdiction: "VIC", effectiveFrom: "2023-01-01" }, actorUserId),
      ]);

      const succeeded = [a, b].filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
        Awaited<ReturnType<typeof upsertExpiryRule>>
      >[];
      // Both may succeed (retry absorbs the race) or one may reject on the
      // same-day-guard if the retry re-reads the winner's row — either way,
      // never an unhandled DB error, and never two simultaneously-active rows.
      for (const r of succeeded) createdRuleIds.push(r.value.documentExpiryRuleId);

      const activeRows = await db
        .select({ id: documentExpiryRule.documentExpiryRuleId })
        .from(documentExpiryRule)
        .where(
          and(
            eq(documentExpiryRule.documentType, concurrentType),
            eq(documentExpiryRule.jurisdiction, "VIC"),
            isNull(documentExpiryRule.effectiveTo),
          ),
        );
      expect(activeRows.length).toBe(1);
      createdRuleIds.push(...activeRows.map((r) => r.id));
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
      // scanned counts every non-Archived, dated document system-wide (by
      // design — the real cron job scans across all orgs), so it can only
      // be asserted as a lower bound against a shared dev DB that other
      // orgs' real documents also live in. notified/expired stay exact:
      // they only fire for documents actually matching today's rule.
      expect(result.scanned).toBeGreaterThanOrEqual(2);
      expect(result.notified).toBe(1);
      expect(result.expired).toBe(1);

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
      // See the note in the previous test — scanned is a global count.
      expect(second.scanned).toBeGreaterThanOrEqual(2);
      expect(second.notified).toBe(0);
      expect(second.expired).toBe(1);

      const after = await db
        .select({ id: notification.notificationId })
        .from(notification)
        .where(eq(notification.relatedEntityId, alertDueId));
      expect(after).toHaveLength(1); // still exactly one — dedup held
    });
  });

  // ── Group: nudge — CV-C7's staff-side reminder on an aged Pending doc ──
  describe("nudge", () => {
    let staffH: number;
    let org5: number;
    let docId: string;

    beforeAll(async () => {
      [{ userId: staffH }] = await db
        .insert(user)
        .values({ userName: "Compliance H", userEmail: `${tag}-h@it.test` })
        .returning({ userId: user.userId });

      [{ id: org5 }] = await db
        .insert(organisation)
        .values({ organisationName: `${tag}-org5`, joinKey: `${tag}-jk5`, createdBy: staffH })
        .returning({ id: organisation.organisationId });

      [{ id: docId }] = await db
        .insert(complianceDocument)
        .values({
          organisationId: org5,
          userId: staffH,
          documentType: `${tag}-nudge-doc`,
          storagePublicId: sp(org5, staffH, "nudge-1"),
          verificationStatus: "Pending",
          uploadedBy: staffH,
        })
        .returning({ id: complianceDocument.complianceDocumentId });
    });

    afterAll(async () => {
      await db.delete(notification).where(eq(notification.organisationId, org5));
      await db.delete(complianceDocument).where(eq(complianceDocument.organisationId, org5));
      await db.delete(organisation).where(eq(organisation.organisationId, org5));
      await db.delete(user).where(eq(user.userId, staffH));
    });

    it("refuses a nudge on a document that hasn't been waiting 48h yet", async () => {
      await expect(nudgeVerifier(org5, docId, staffH)).rejects.toMatchObject({
        message: expect.stringContaining("Not old enough"),
        statusCode: 409,
      });
    });

    it("refuses a nudge on a document that is not Pending, regardless of age", async () => {
      const [{ id: verifiedDocId }] = await db
        .insert(complianceDocument)
        .values({
          organisationId: org5,
          userId: staffH,
          documentType: `${tag}-nudge-verified-doc`,
          storagePublicId: sp(org5, staffH, "nudge-verified-1"),
          verificationStatus: "Verified",
          uploadedBy: staffH,
        })
        .returning({ id: complianceDocument.complianceDocumentId });

      try {
        await expect(nudgeVerifier(org5, verifiedDocId, staffH)).rejects.toMatchObject({
          message: expect.stringContaining("is not pending verification"),
          statusCode: 409,
        });
      } finally {
        await db.delete(complianceDocument).where(eq(complianceDocument.complianceDocumentId, verifiedDocId));
      }
    });

    it("404s a nudge attempt on someone else's document — never confirms it exists", async () => {
      const [{ userId: otherStaff }] = await db
        .insert(user)
        .values({ userName: "Compliance H2", userEmail: `${tag}-h2@it.test` })
        .returning({ userId: user.userId });
      try {
        await expect(nudgeVerifier(org5, docId, otherStaff)).rejects.toMatchObject({
          message: "Document not found",
          statusCode: 404,
        });
      } finally {
        await db.delete(user).where(eq(user.userId, otherStaff));
      }
    });

    it("succeeds once the document has genuinely been waiting 48h, then throttles a repeat within 24h", async () => {
      await db
        .update(complianceDocument)
        .set({ uploadedAt: new Date(Date.now() - 50 * 60 * 60 * 1000) })
        .where(eq(complianceDocument.complianceDocumentId, docId));

      // Nobody in this fresh org holds compliance:verify, so notifyHQAdmins()
      // has no one to actually notify — that's fine, nudgeVerifier must not
      // throw over an empty recipient list. Manually verified with a real
      // compliance:verify holder via live QA (docs/qa/rostering-compliance-
      // test-plan.md, CV-C7): 3 recipients, in-app + email each.
      await expect(nudgeVerifier(org5, docId, staffH)).resolves.toBeUndefined();

      // Insert the notification row a real recipient would have gotten, so
      // the throttle's hasRecentNotification() dedup check (keyed on
      // relatedEntityId + type, not on who received it) has something to see.
      await db.insert(notification).values({
        organisationId: org5,
        recipientUserId: staffH,
        type: "COMPLIANCE_DOCUMENT_NUDGE",
        relatedEntityType: "compliance_document",
        relatedEntityId: docId,
      });

      await expect(nudgeVerifier(org5, docId, staffH)).rejects.toMatchObject({
        message: expect.stringContaining("Already nudged"),
        statusCode: 409,
      });
    });
  });

  // ── CV-E: venue-level (org-wide) compliance documents ───────────────────
  describe("venue documents", () => {
    let manager: number;
    let org6: number;
    let otherOrg: number;
    let loc6: string;
    let otherOrgLoc: string;

    beforeAll(async () => {
      [{ userId: manager }] = await db
        .insert(user)
        .values({ userName: "Compliance Manager", userEmail: `${tag}-mgr@it.test` })
        .returning({ userId: user.userId });

      [{ id: org6 }] = await db
        .insert(organisation)
        .values({ organisationName: `${tag}-org6`, joinKey: `${tag}-jk6`, createdBy: manager })
        .returning({ id: organisation.organisationId });

      [{ id: loc6 }] = await db
        .insert(storeLocation)
        .values({
          organisationId: org6,
          locationName: `${tag}-venue6`,
          storeKey: `${tag}-sk6`.slice(0, 25),
          createdBy: manager,
        })
        .returning({ id: storeLocation.storeLocationId });

      // A location in a DIFFERENT org, to prove a venue document can't be
      // pointed at another tenant's venue.
      [{ id: otherOrg }] = await db
        .insert(organisation)
        .values({ organisationName: `${tag}-org6b`, joinKey: `${tag}-jk6b`, createdBy: manager })
        .returning({ id: organisation.organisationId });
      [{ id: otherOrgLoc }] = await db
        .insert(storeLocation)
        .values({
          organisationId: otherOrg,
          locationName: `${tag}-venue6b`,
          storeKey: `${tag}-sk6b`.slice(0, 25),
          createdBy: manager,
        })
        .returning({ id: storeLocation.storeLocationId });
    });

    afterAll(async () => {
      // createDocument audit-logs the insert (auditService.log), so org6 has
      // an audit_log row FK'd to it — delete it before the organisation.
      await db.delete(auditLog).where(eq(auditLog.organisationId, org6));
      await db.delete(complianceDocument).where(eq(complianceDocument.organisationId, org6));
      await db.delete(storeLocation).where(eq(storeLocation.organisationId, org6));
      await db.delete(storeLocation).where(eq(storeLocation.organisationId, otherOrg));
      await db.delete(organisation).where(inArray(organisation.organisationId, [org6, otherOrg]));
      await db.delete(user).where(eq(user.userId, manager));
    });

    it("creates a document whose subject is a venue, no staff member involved", async () => {
      const doc = await createDocument(org6, {
        userId: null,
        subjectStoreLocationId: loc6,
        uploadedBy: manager,
        documentType: "Liquor Licence",
        storagePublicId: sp(org6, manager, "liquor-1"),
      });
      expect(doc.userId).toBeNull();
      expect(doc.subjectStoreLocationId).toBe(loc6);
      // chk_compliance_document_venue_scope: owning location defaults to the subject.
      expect(doc.storeLocationId).toBe(loc6);

      const dashboard = await getComplianceDashboard(org6);
      expect(dashboard.venueDocumentCount).toBe(1);
    });

    it("rejects a document with BOTH a staff member and a venue subject", async () => {
      await expect(
        createDocument(org6, {
          userId: manager,
          subjectStoreLocationId: loc6,
          uploadedBy: manager,
          documentType: "Liquor Licence",
          storagePublicId: sp(org6, manager, "liquor-both"),
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining("exactly one subject"), statusCode: 400 });
    });

    it("rejects a document with NEITHER a staff member nor a venue subject", async () => {
      await expect(
        createDocument(org6, {
          userId: null,
          uploadedBy: manager,
          documentType: "Liquor Licence",
          storagePublicId: sp(org6, manager, "liquor-neither"),
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining("exactly one subject"), statusCode: 400 });
    });

    it("404s a venue document pointed at another organisation's location", async () => {
      await expect(
        createDocument(org6, {
          userId: null,
          subjectStoreLocationId: otherOrgLoc,
          uploadedBy: manager,
          documentType: "Liquor Licence",
          storagePublicId: sp(org6, manager, "liquor-cross-org"),
        }),
      ).rejects.toMatchObject({ message: "Location not found", statusCode: 404 });
    });
  });

  // ── CV-K: an Archived document (offboarding) must never mint a signed URL,
  // even for its own owner — the whole point of archiving on offboard is that
  // the person can no longer pull their own certificate back out.
  describe("view-url — archived documents", () => {
    let staffI: number;
    let colleague: number;
    let org7: number;
    let docId: string;

    beforeAll(async () => {
      [{ userId: staffI }] = await db
        .insert(user)
        .values({ userName: "Compliance I", userEmail: `${tag}-i@it.test` })
        .returning({ userId: user.userId });
      [{ userId: colleague }] = await db
        .insert(user)
        .values({ userName: "Compliance I2", userEmail: `${tag}-i2@it.test` })
        .returning({ userId: user.userId });

      [{ id: org7 }] = await db
        .insert(organisation)
        .values({ organisationName: `${tag}-org7`, joinKey: `${tag}-jk7`, createdBy: staffI })
        .returning({ id: organisation.organisationId });

      await db.insert(userOrganisation).values([
        { userId: staffI, organisationId: org7, role: "member" },
        { userId: colleague, organisationId: org7, role: "member" },
      ]);

      const created = await createDocument(org7, {
        userId: staffI,
        uploadedBy: staffI,
        documentType: "RSA",
        storagePublicId: sp(org7, staffI, "archived-1"),
      });
      docId = created.complianceDocumentId;
    });

    afterAll(async () => {
      // createDocument audit-logs the insert — delete before the organisation.
      await db.delete(auditLog).where(eq(auditLog.organisationId, org7));
      await db.delete(complianceDocument).where(eq(complianceDocument.organisationId, org7));
      await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, org7));
      await db.delete(organisation).where(eq(organisation.organisationId, org7));
      await db.delete(user).where(inArray(user.userId, [staffI, colleague]));
    });

    /** Minimal stand-in for Express's req/res — same shape compliancePermissions.test.ts uses. */
    function reqRes(
      userId: number,
      documentId: string,
      perms: { roles?: string[]; permissions?: string[] } = {},
    ) {
      const req = {
        user: { sub: userId, roles: perms.roles ?? [], permissions: perms.permissions ?? ["compliance:read-own"] },
        params: { id: documentId },
        query: {},
        body: {},
        headers: {},
      } as any;
      let status: number | null = null;
      let json: unknown = null;
      const res = {
        status(code: number) {
          status = code;
          return this;
        },
        json(body: unknown) {
          json = body;
          return this;
        },
      } as any;
      return { req, res, result: () => ({ status, json }) };
    }

    it("grants the owner a signed URL before archiving", async () => {
      const { req, res, result } = reqRes(staffI, docId);
      await handleGetDocumentViewUrl(req, res, () => {});
      const { status, json } = result();
      expect(status).toBeNull(); // res.json() was called directly, no res.status() first
      expect((json as { url?: string })?.url).toBeTruthy();
    });

    it("CV-L2: refuses a colleague with only compliance:read-own, and logs the denial", async () => {
      const { req, res, result } = reqRes(colleague, docId, { permissions: ["compliance:read-own"] });
      await handleGetDocumentViewUrl(req, res, () => {});
      const { status, json } = result();
      expect(status).toBe(403);
      expect((json as { error?: string })?.error).toBeTruthy();

      const [log] = await db
        .select({ outcome: documentAccessLog.outcome, actorUserId: documentAccessLog.actorUserId })
        .from(documentAccessLog)
        .where(eq(documentAccessLog.complianceDocumentId, docId))
        .orderBy(desc(documentAccessLog.createdDttm))
        .limit(1);
      expect(log?.outcome).toBe("denied");
      expect(log?.actorUserId).toBe(colleague);
    });

    it("refuses the owner's own document once it's archived, and logs the denial", async () => {
      await archiveForOffboardedStaff(staffI, "2020-01-01");

      const { req, res, result } = reqRes(staffI, docId);
      await handleGetDocumentViewUrl(req, res, () => {});
      const { status, json } = result();
      expect(status).toBe(403);
      expect((json as { error?: string })?.error).toBeTruthy();

      const [log] = await db
        .select({ outcome: documentAccessLog.outcome })
        .from(documentAccessLog)
        .where(eq(documentAccessLog.complianceDocumentId, docId))
        .orderBy(desc(documentAccessLog.createdDttm))
        .limit(1);
      expect(log?.outcome).toBe("denied");
    });
  });
});
