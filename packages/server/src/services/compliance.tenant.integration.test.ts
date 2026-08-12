import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

// Load .env before the first query — see tenantIsolation.integration.test.ts for why
// this has to run after the import statements but before any db call.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  userOrganisation,
  storeLocation,
  complianceDocument,
  organisationRequiredDocument,
} from "../db/schema.js";
import {
  listStaffCompliance,
  getComplianceDashboard,
  getDocument,
  verifyDocument,
  rejectDocument,
  listDocumentsForUser,
  listPendingVerification,
  setRequiredDocuments,
} from "./complianceService.js";

/**
 * Real-database tenant-isolation canary for the Staff Compliance Vault.
 *
 * Staff PII (RSA numbers, police checks, visa documents) is a worse leak
 * surface than stock counts — this proves org A can never read, verify, or
 * reject org B's documents, mirroring the 2026-07 tenant-isolation suite's
 * pattern (tenantIsolation.integration.test.ts) for the compliance tables.
 *
 * Also proves the two `compliance_document` CHECK constraints directly:
 * Postgres satisfies a CHECK when it evaluates to NULL, not just TRUE, so
 * `chk_compliance_document_venue_scope`'s `IS NOT NULL` term is what makes a
 * venue document with no owning location actually get rejected rather than
 * silently pass.
 *
 * Gated on TENANT_IT=1. Self-cleaning: every row this suite creates is
 * deleted (children before parents, each guarded), including rows left
 * behind by a CHECK-violation insert that unexpectedly succeeds.
 */
const RUN = process.env.TENANT_IT === "1";

describe.skipIf(!RUN)("compliance vault — tenant isolation (real DB)", () => {
  const tag = `cvit_${Date.now().toString(36)}`;
  const docType = `${tag}-rsa`;
  let userA: number;
  let userB: number;
  let orgA: number;
  let orgB: number;
  let locA: string;
  let locB: string;
  let docAId: string;
  let docBId: string;
  let venueDocBId: string;

  beforeAll(async () => {
    [{ id: userA }] = await db
      .insert(user)
      .values({ userName: "CVIT A", userEmail: `${tag}-a@it.test` })
      .returning({ id: user.userId });
    [{ id: userB }] = await db
      .insert(user)
      .values({ userName: "CVIT B", userEmail: `${tag}-b@it.test` })
      .returning({ id: user.userId });

    [{ id: orgA }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-A`, joinKey: `${tag}-ka`.slice(0, 25), createdBy: userA })
      .returning({ id: organisation.organisationId });
    [{ id: orgB }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-B`, joinKey: `${tag}-kb`.slice(0, 25), createdBy: userB })
      .returning({ id: organisation.organisationId });

    await db.insert(userOrganisation).values([
      { userId: userA, organisationId: orgA, role: "admin" },
      { userId: userB, organisationId: orgB, role: "admin" },
    ]);

    [{ id: locA }] = await db
      .insert(storeLocation)
      .values({
        organisationId: orgA,
        locationName: `${tag}-locA`,
        storeKey: `${tag}-ska`.slice(0, 25),
        createdBy: userA,
      })
      .returning({ id: storeLocation.storeLocationId });
    [{ id: locB }] = await db
      .insert(storeLocation)
      .values({
        organisationId: orgB,
        locationName: `${tag}-locB`,
        storeKey: `${tag}-skb`.slice(0, 25),
        createdBy: userB,
      })
      .returning({ id: storeLocation.storeLocationId });

    await setRequiredDocuments(orgA, [docType]);
    await setRequiredDocuments(orgB, [docType]);

    [{ id: docAId }] = await db
      .insert(complianceDocument)
      .values({
        organisationId: orgA,
        userId: userA,
        documentType: docType,
        storagePublicId: `${tag}-pub-a`,
        uploadedBy: userA,
      })
      .returning({ id: complianceDocument.complianceDocumentId });

    [{ id: docBId }] = await db
      .insert(complianceDocument)
      .values({
        organisationId: orgB,
        userId: userB,
        documentType: docType,
        storagePublicId: `${tag}-pub-b`,
        uploadedBy: userB,
      })
      .returning({ id: complianceDocument.complianceDocumentId });

    // A venue document (liquor licence): no user_id, subject IS the location.
    [{ id: venueDocBId }] = await db
      .insert(complianceDocument)
      .values({
        organisationId: orgB,
        storeLocationId: locB,
        subjectStoreLocationId: locB,
        documentType: `${tag}-insurance`,
        storagePublicId: `${tag}-pub-venue`,
        uploadedBy: userB,
      })
      .returning({ id: complianceDocument.complianceDocumentId });
  });

  afterAll(async () => {
    const docIds = [docAId, docBId, venueDocBId].filter(Boolean);
    if (docIds.length) {
      await db.delete(complianceDocument).where(inArray(complianceDocument.complianceDocumentId, docIds));
    }
    if (orgA && orgB) {
      await db
        .delete(organisationRequiredDocument)
        .where(inArray(organisationRequiredDocument.organisationId, [orgA, orgB]));
    }
    if (locA) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locA));
    if (locB) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locB));
    if (orgA && orgB) {
      await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
      await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    }
    if (userA && userB) await db.delete(user).where(inArray(user.userId, [userA, userB]));
  });

  it("listStaffCompliance scopes to the caller's org", async () => {
    const rowsA = await listStaffCompliance(orgA);
    expect(rowsA.every((r) => r.userId === userA)).toBe(true); // no org B staff leaks in
    expect(rowsA.some((r) => r.userId === userB)).toBe(false);

    const mine = rowsA.find((r) => r.userId === userA);
    expect(mine).toBeTruthy();
    expect(mine!.documents.some((d) => d.documentType === docType && d.status === "pending")).toBe(true);
  });

  it("getComplianceDashboard counts only the caller's org", async () => {
    const dashA = await getComplianceDashboard(orgA);
    expect(dashA.totalStaff).toBe(1); // only userA — would be 2 if org B's membership leaked in
    expect(dashA.venueDocumentCount).toBe(0); // org B's venue doc must not be counted here

    const dashB = await getComplianceDashboard(orgB);
    expect(dashB.venueDocumentCount).toBe(1); // sanity: org B does see its own venue doc
  });

  it("getDocument returns a 404-shaped error for a cross-org id, never the row", async () => {
    await expect(getDocument(orgA, docBId)).rejects.toMatchObject({
      name: "ComplianceError",
      statusCode: 404,
    });
    // The venue document must be equally invisible from org A.
    await expect(getDocument(orgA, venueDocBId)).rejects.toMatchObject({
      name: "ComplianceError",
      statusCode: 404,
    });
    // Sanity: org A can read its own document.
    const own = await getDocument(orgA, docAId);
    expect(own.complianceDocumentId).toBe(docAId);
  });

  it("verifyDocument refuses a cross-org id", async () => {
    await expect(verifyDocument(orgA, docBId, userA)).rejects.toMatchObject({
      name: "ComplianceError",
      statusCode: 404,
    });
  });

  it("rejectDocument refuses a cross-org id", async () => {
    await expect(rejectDocument(orgA, docBId, userA, "not valid")).rejects.toMatchObject({
      name: "ComplianceError",
      statusCode: 404,
    });
  });

  it("listDocumentsForUser returns nothing for a cross-org user", async () => {
    const rows = await listDocumentsForUser(orgA, userB);
    expect(rows).toEqual([]);
  });

  it("listPendingVerification excludes org B entirely, including its venue document", async () => {
    const pendingA = await listPendingVerification(orgA);
    expect(pendingA.some((d) => d.complianceDocumentId === docBId)).toBe(false);
    expect(pendingA.some((d) => d.complianceDocumentId === venueDocBId)).toBe(false);
    expect(pendingA.some((d) => d.complianceDocumentId === docAId)).toBe(true); // sanity: org A's own is there
  });

  // ── CHECK constraints — database guarantees, proven directly ──────────

  /**
   * Attempt an insert that should violate a CHECK constraint (23514 = Postgres
   * check_violation). If it unexpectedly succeeds, delete the leaked row (so
   * the suite stays self-cleaning even when it finds a real bug) and fail the
   * test loudly rather than silently passing.
   */
  async function expectCheckViolation(
    label: string,
    values: typeof complianceDocument.$inferInsert,
  ): Promise<void> {
    let insertedId: string | undefined;
    try {
      const [row] = await db
        .insert(complianceDocument)
        .values(values)
        .returning({ id: complianceDocument.complianceDocumentId });
      insertedId = row.id;
    } catch (err) {
      expect((err as { code?: string }).code, label).toBe("23514");
      return;
    } finally {
      if (insertedId) {
        await db.delete(complianceDocument).where(eq(complianceDocument.complianceDocumentId, insertedId));
      }
    }
    throw new Error(`${label}: CHECK constraint did not fire — insert succeeded (REAL BUG)`);
  }

  it("chk_compliance_document_subject rejects a row with BOTH user_id and subject_store_location_id", async () => {
    await expectCheckViolation("both subjects", {
      organisationId: orgA,
      userId: userA,
      subjectStoreLocationId: locA,
      storeLocationId: locA,
      documentType: `${tag}-chkboth`,
      storagePublicId: `${tag}-pub-chkboth`,
      uploadedBy: userA,
    });
  });

  it("chk_compliance_document_subject rejects a row with NEITHER user_id nor subject_store_location_id", async () => {
    await expectCheckViolation("neither subject", {
      organisationId: orgA,
      userId: null,
      subjectStoreLocationId: null,
      documentType: `${tag}-chkneither`,
      storagePublicId: `${tag}-pub-chkneither`,
      uploadedBy: userA,
    });
  });

  it("chk_compliance_document_venue_scope rejects a venue document with a NULL store_location_id", async () => {
    // The load-bearing case: without the `IS NOT NULL` term in the CHECK,
    // `store_location_id = subject_store_location_id` evaluates NULL = uuid ->
    // NULL, which Postgres treats as SATISFYING the constraint. If this insert
    // succeeds, the constraint has regressed to that broken form.
    await expectCheckViolation("venue doc, null store_location_id", {
      organisationId: orgA,
      userId: null,
      subjectStoreLocationId: locA,
      storeLocationId: null,
      documentType: `${tag}-chkvenuenull`,
      storagePublicId: `${tag}-pub-chkvenuenull`,
      uploadedBy: userA,
    });
  });

  it("chk_compliance_document_venue_scope rejects a venue document whose store_location_id differs from its subject", async () => {
    await expectCheckViolation("venue doc, mismatched store_location_id", {
      organisationId: orgA,
      userId: null,
      subjectStoreLocationId: locA,
      storeLocationId: locB,
      documentType: `${tag}-chkvenuemismatch`,
      storagePublicId: `${tag}-pub-chkvenuemismatch`,
      uploadedBy: userA,
    });
  });
});
