import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  auditLog,
  complianceDocument,
  deviceToken,
  notification,
  organisation,
  pushOptOuts,
  rosterRole,
  shift,
  shiftAssignment,
  storeLocation,
  user,
  userOrganisation,
} from "../db/schema.js";
import { assignStaff, cancelShift, publishRoster, updateShift } from "./rosterService.js";
import { verifyDocument, rejectDocument } from "./complianceDocumentService.js";
import { drainPushDispatch, setPushProviderForTests } from "./pushDispatcher.js";
import { FakePushProvider } from "./pushTestKit.js";

/**
 * The producers hooked in this change. Pushed: roster published, a Published shift cancelled, document verified
 * and rejected. In-app notice only (a Draft shift never pushes): shift assigned, a Draft shift's time changed or
 * cancelled. Real database, fake push provider. Gated on TENANT_IT=1.
 */
const RUN = process.env.TENANT_IT === "1";
const tag = `pp_${Date.now().toString(36)}`;
const DAY = 24 * 60 * 60 * 1000;
const dayStr = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

describe.skipIf(!RUN)("push producers (real DB)", () => {
  let orgA: number;
  let orgB: number;
  let manager: number;
  let staff1: number;
  let staff2: number;
  let outsider: number;
  let loc: string;
  let roleId: string;
  const userIds: number[] = [];
  const shiftIds: string[] = [];
  const docIds: string[] = [];
  const tok = (name: string) => `ExponentPushToken[${tag}-${name}]`;
  let fake: FakePushProvider;

  async function mkUser(name: string) {
    const [{ id }] = await db.insert(user).values({ userName: `${tag} ${name}`, userEmail: `${tag}-${name}@it.test` }).returning({ id: user.userId });
    userIds.push(id);
    return id;
  }
  async function mkShift(dayOffset: number) {
    const day = dayStr(dayOffset);
    const [row] = await db
      .insert(shift)
      .values({ organisationId: orgA, storeLocationId: loc, rosterRoleId: roleId, startDatetime: new Date(`${day}T09:00:00Z`), endDatetime: new Date(`${day}T13:00:00Z`), createdBy: manager })
      .returning({ id: shift.shiftId });
    shiftIds.push(row.id);
    return row.id;
  }
  const publish = (shiftId: string) => db.update(shift).set({ status: "Published" }).where(eq(shift.shiftId, shiftId));
  async function mkDoc(userId: number | null, status = "Pending") {
    const [row] = await db
      .insert(complianceDocument)
      .values({ organisationId: orgA, userId, ...(userId === null ? { subjectStoreLocationId: loc, storeLocationId: loc } : {}), documentType: `${tag}-Food Safety Supervisor`, verificationStatus: status, storagePublicId: `${tag}-${docIds.length}`, uploadedBy: manager })
      .returning({ id: complianceDocument.complianceDocumentId });
    docIds.push(row.id);
    return row.id;
  }
  const inApp = async (userId: number, type: string) =>
    db.select().from(notification).where(and(eq(notification.recipientUserId, userId), eq(notification.type, type)));
  /** Pushes that reached `userId`'s device, after the dispatcher has finished. */
  const pushedTo = async (...names: string[]) => {
    await drainPushDispatch();
    return fake.sent.filter((m) => names.some((n) => m.to === tok(n)));
  };

  beforeAll(async () => {
    manager = await mkUser("manager");
    staff1 = await mkUser("staff1");
    staff2 = await mkUser("staff2");
    outsider = await mkUser("outsider");
    [{ id: orgA }] = await db.insert(organisation).values({ organisationName: `${tag}-A`, joinKey: `${tag}-ka`.slice(0, 25), createdBy: manager }).returning({ id: organisation.organisationId });
    [{ id: orgB }] = await db.insert(organisation).values({ organisationName: `${tag}-B`, joinKey: `${tag}-kb`.slice(0, 25), createdBy: outsider }).returning({ id: organisation.organisationId });
    await db.insert(userOrganisation).values([
      ...[manager, staff1, staff2].map((userId) => ({ userId, organisationId: orgA, role: "admin" })),
      { userId: outsider, organisationId: orgB, role: "admin" },
    ]);
    // No state: no jurisdiction, so publishing needs no public holiday calendar.
    [{ id: loc }] = await db.insert(storeLocation).values({ organisationId: orgA, locationName: `${tag}-loc`, storeKey: `${tag}-sk`.slice(0, 25), createdBy: manager }).returning({ id: storeLocation.storeLocationId });
    [{ id: roleId }] = await db.insert(rosterRole).values({ organisationId: orgA, storeLocationId: loc, roleName: `${tag}-cook` }).returning({ id: rosterRole.rosterRoleId });
    await db.insert(deviceToken).values([
      { userId: manager, tokenValue: tok("manager"), platform: "ios" },
      { userId: staff1, tokenValue: tok("staff1"), platform: "ios" },
      { userId: staff2, tokenValue: tok("staff2"), platform: "android" },
      { userId: outsider, tokenValue: tok("outsider"), platform: "ios" },
    ]);
  });

  beforeEach(() => {
    fake = new FakePushProvider();
    setPushProviderForTests(fake);
  });

  afterAll(async () => {
    setPushProviderForTests(null);
    await drainPushDispatch();
    if (shiftIds.length) {
      await db.delete(shiftAssignment).where(inArray(shiftAssignment.shiftId, shiftIds));
      await db.delete(shift).where(inArray(shift.shiftId, shiftIds));
    }
    await db.delete(complianceDocument).where(eq(complianceDocument.organisationId, orgA));
    await db.delete(rosterRole).where(eq(rosterRole.organisationId, orgA));
    await db.delete(storeLocation).where(eq(storeLocation.organisationId, orgA));
    await db.delete(auditLog).where(inArray(auditLog.organisationId, [orgA, orgB]));
    await db.delete(notification).where(inArray(notification.organisationId, [orgA, orgB]));
    await db.delete(deviceToken).where(inArray(deviceToken.userId, userIds));
    await db.delete(pushOptOuts).where(inArray(pushOptOuts.userId, userIds));
    await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
    await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    await db.delete(user).where(inArray(user.userId, userIds));
  });

  describe("shifts", () => {
    it("tells a person a shift was assigned to them with an in-app notice, and no push while the shift is a Draft", async () => {
      const s = await mkShift(3);
      await assignStaff(orgA, s, staff1, manager);
      const [row] = await inApp(staff1, "SHIFT_ASSIGNED");
      expect(row.relatedEntityType).toBe("shift");
      expect(row.relatedEntityId).toBe(s);
      expect(row.payload).toMatchObject({ shiftId: s });
      expect(await pushedTo("staff1")).toEqual([]);
    });

    it("does not tell a manager about a shift they assigned to themselves", async () => {
      const s = await mkShift(3);
      await assignStaff(orgA, s, manager, manager);
      expect(await inApp(manager, "SHIFT_ASSIGNED")).toEqual([]);
      expect(await pushedTo("manager")).toEqual([]);
    });

    it("tells the assigned staff in-app when a Draft shift's time changes, without a push, not the person who changed it, and not when nothing changed", async () => {
      const s = await mkShift(4);
      await assignStaff(orgA, s, staff1, manager);
      await assignStaff(orgA, s, manager, manager);
      const day = dayStr(4);
      await updateShift(orgA, s, { startDatetime: `${day}T10:00:00Z` }, manager);
      expect(await inApp(staff1, "SHIFT_CHANGED")).toHaveLength(1);
      expect(await inApp(manager, "SHIFT_CHANGED")).toEqual([]);
      expect(await pushedTo("staff1", "manager")).toEqual([]);
      await updateShift(orgA, s, { startDatetime: `${day}T10:00:00Z` }, manager);
      expect(await inApp(staff1, "SHIFT_CHANGED")).toHaveLength(1);
    });

    it("does not tell someone who declined the shift that it changed", async () => {
      const s = await mkShift(5);
      await assignStaff(orgA, s, staff2, manager);
      await db.update(shiftAssignment).set({ status: "Declined" }).where(and(eq(shiftAssignment.shiftId, s), eq(shiftAssignment.userId, staff2)));
      await updateShift(orgA, s, { endDatetime: `${dayStr(5)}T14:00:00Z` }, manager);
      expect(await inApp(staff2, "SHIFT_CHANGED")).toEqual([]);
    });

    it("tells the assigned staff a Published shift was cancelled, once, with a push", async () => {
      const s = await mkShift(6);
      await assignStaff(orgA, s, staff2, manager);
      await publish(s);
      await cancelShift(orgA, s);
      await cancelShift(orgA, s);
      const rows = (await inApp(staff2, "SHIFT_CANCELLED")).filter((r) => r.relatedEntityId === s);
      expect(rows).toHaveLength(1);
      const pushes = await pushedTo("staff2");
      expect(pushes).toHaveLength(1);
      expect(pushes[0]).toMatchObject({ title: "Your shifts", body: "One of your shifts was cancelled.", data: { type: "SHIFT_CANCELLED", link: "/shifts" } });
    });

    it("tells the assigned staff in-app that a Draft shift was cancelled, without a push", async () => {
      const s = await mkShift(7);
      await assignStaff(orgA, s, staff2, manager);
      await cancelShift(orgA, s);
      expect((await inApp(staff2, "SHIFT_CANCELLED")).filter((r) => r.relatedEntityId === s)).toHaveLength(1);
      expect(await pushedTo("staff2")).toEqual([]);
    });

    it("does not tell the person who cancelled a shift they are assigned to, and still tells the others", async () => {
      const s = await mkShift(13);
      await assignStaff(orgA, s, manager, manager);
      await assignStaff(orgA, s, staff1, manager);
      await publish(s);
      await cancelShift(orgA, s, manager);
      expect((await inApp(manager, "SHIFT_CANCELLED")).filter((r) => r.relatedEntityId === s)).toEqual([]);
      expect((await inApp(staff1, "SHIFT_CANCELLED")).filter((r) => r.relatedEntityId === s)).toHaveLength(1);
      expect((await pushedTo("staff1", "manager")).map((m) => m.to)).toEqual([tok("staff1")]);
    });

    it("tells each person once when a roster is published, however many of their shifts it covers, and not the publisher", async () => {
      const a = await mkShift(8);
      const b = await mkShift(9);
      await assignStaff(orgA, a, staff1, manager);
      await assignStaff(orgA, b, staff1, manager);
      await assignStaff(orgA, b, staff2, manager);
      const result = await publishRoster(orgA, loc, dayStr(8), dayStr(9), manager);
      expect(result.publishedShiftIds.sort()).toEqual([a, b].sort());
      const mine = (await inApp(staff1, "ROSTER_PUBLISHED")).filter((r) => (r.payload as { shiftIds: string[] }).shiftIds.includes(a));
      expect(mine).toHaveLength(1);
      expect((mine[0].payload as { shiftIds: string[] }).shiftIds.sort()).toEqual([a, b].sort());
      expect(await inApp(manager, "ROSTER_PUBLISHED")).toEqual([]);
      expect((await pushedTo("staff1", "staff2")).map((m) => m.to).sort()).toEqual([tok("staff1"), tok("staff2")]);
    });

    it("still saves the in-app notice for a person who switched that type's push off, and sends them no push", async () => {
      await db.insert(pushOptOuts).values({ userId: staff2, notificationType: "SHIFT_CANCELLED" });
      const s = await mkShift(11);
      await assignStaff(orgA, s, staff1, manager);
      await assignStaff(orgA, s, staff2, manager);
      await publish(s);
      await cancelShift(orgA, s);
      expect((await inApp(staff2, "SHIFT_CANCELLED")).some((r) => r.relatedEntityId === s)).toBe(true);
      expect((await pushedTo("staff1", "staff2")).map((m) => m.to)).toEqual([tok("staff1")]);
      await db.delete(pushOptOuts).where(eq(pushOptOuts.userId, staff2));
    });

    it("never pushes to a device that belongs to another organisation's people", async () => {
      const s = await mkShift(12);
      await assignStaff(orgA, s, staff1, manager);
      await updateShift(orgA, s, { endDatetime: `${dayStr(12)}T15:00:00Z` }, manager);
      await publish(s);
      await cancelShift(orgA, s);
      expect((await pushedTo("staff1", "outsider")).map((m) => m.to)).toEqual([tok("staff1")]);
      expect(await db.select().from(notification).where(eq(notification.recipientUserId, outsider))).toEqual([]);
    });
  });

  describe("documents", () => {
    it("tells the owner their document was verified, with the document type in the in-app notice only", async () => {
      const id = await mkDoc(staff1);
      await verifyDocument(orgA, id, manager);
      const [row] = (await inApp(staff1, "DOCUMENT_VERIFIED")).filter((r) => r.relatedEntityId === id);
      expect(row.payload).toMatchObject({ documentId: id, documentType: `${tag}-Food Safety Supervisor` });
      const pushes = await pushedTo("staff1");
      expect(pushes).toHaveLength(1);
      expect(pushes[0]).toMatchObject({ body: "A document of yours was verified.", data: { type: "DOCUMENT_VERIFIED", link: `/compliance/documents/${id}` } });
      expect(JSON.stringify(pushes)).not.toContain("Food Safety");
    });

    it("tells the owner their document was rejected; the reason is in the in-app notice, not the push", async () => {
      const id = await mkDoc(staff1);
      await rejectDocument(orgA, id, manager, "Photo is blurry, expires 2031-02-03");
      const [row] = (await inApp(staff1, "DOCUMENT_REJECTED")).filter((r) => r.relatedEntityId === id);
      expect(JSON.stringify(row.payload)).toContain("Photo is blurry");
      const pushes = await pushedTo("staff1");
      expect(pushes).toHaveLength(1);
      expect(pushes[0].body).toBe("A document of yours was not accepted.");
      expect(JSON.stringify(pushes)).not.toMatch(/blurry|2031|Food Safety/);
    });

    it("tells no one about a venue's own document, or a verifier's own document", async () => {
      const venueDoc = await mkDoc(null);
      await verifyDocument(orgA, venueDoc, manager);
      const ownDoc = await mkDoc(manager);
      await verifyDocument(orgA, ownDoc, manager);
      expect((await inApp(manager, "DOCUMENT_VERIFIED")).filter((r) => r.relatedEntityId === ownDoc)).toEqual([]);
      expect(await pushedTo("manager")).toEqual([]);
    });

    it("still verifies the document when the push fails", async () => {
      const id = await mkDoc(staff1);
      fake.failSend = true;
      const updated = await verifyDocument(orgA, id, manager);
      expect(updated.verificationStatus).toBe("Verified");
      await drainPushDispatch();
    });
  });
});
