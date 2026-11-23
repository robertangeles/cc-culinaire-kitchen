import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { deviceToken, notification, organisation, pushOptOuts, pushQuietHours, pushReceipts, user, userOrganisation } from "../db/schema.js";
import { dispatchPush, notifyAndPush, drainPushDispatch, processPushReceipts, setPushProviderForTests } from "./pushDispatcher.js";
import { FakePushProvider } from "./pushTestKit.js";

/**
 * Real-database behaviour of the push dispatcher, with a fake push provider (Expo is never called).
 * Gated on TENANT_IT=1, like the other real-DB suites.
 */
const RUN = process.env.TENANT_IT === "1";
const tag = `pd_${Date.now().toString(36)}`;
const MIN = 60 * 1000;

describe.skipIf(!RUN)("pushDispatcher (real DB)", () => {
  let orgA: number;
  let orgB: number;
  let staff: number; // org A, two devices
  let optedOut: number; // org A, switched SHIFT_CHANGED off
  let quiet: number; // org A, quiet hours 22:00-07:00 in Australia/Sydney
  let outsider: number; // org B only
  let suspended: number; // org A, suspended
  let lonely: number; // org A, no device
  const userIds: number[] = [];
  const tok = (name: string) => `ExponentPushToken[${tag}-${name}]`;
  let fake: FakePushProvider;

  async function mkUser(name: string, status = "active") {
    const [{ id }] = await db.insert(user).values({ userName: `${tag} ${name}`, userEmail: `${tag}-${name}@it.test`, userStatus: status }).returning({ id: user.userId });
    userIds.push(id);
    return id;
  }
  async function mkToken(userId: number, name: string) {
    await db.insert(deviceToken).values({ userId, tokenValue: tok(name), platform: "ios" });
  }
  const tokenRows = async (ids: number[]) => db.select().from(deviceToken).where(inArray(deviceToken.userId, ids));

  /** A saved in-app notification, shaped as `createInApp` returns it. */
  const note = (recipientUserId: number, type = "SHIFT_CHANGED", organisationId = orgA) => ({
    notificationId: crypto.randomUUID(),
    organisationId,
    recipientUserId,
    type,
    relatedEntityType: "shift",
    relatedEntityId: "3f2b8c1e-5d7a-4e6f-9a1b-2c3d4e5f6a7b",
  });

  beforeAll(async () => {
    staff = await mkUser("staff");
    optedOut = await mkUser("optedout");
    quiet = await mkUser("quiet");
    outsider = await mkUser("outsider");
    suspended = await mkUser("suspended", "suspended");
    lonely = await mkUser("lonely");
    [{ id: orgA }] = await db.insert(organisation).values({ organisationName: `${tag}-A`, joinKey: `${tag}-ka`.slice(0, 25), createdBy: staff }).returning({ id: organisation.organisationId });
    [{ id: orgB }] = await db.insert(organisation).values({ organisationName: `${tag}-B`, joinKey: `${tag}-kb`.slice(0, 25), createdBy: outsider }).returning({ id: organisation.organisationId });
    await db.insert(userOrganisation).values([
      ...[staff, optedOut, quiet, suspended, lonely].map((userId) => ({ userId, organisationId: orgA, role: "admin" })),
      { userId: outsider, organisationId: orgB, role: "admin" },
    ]);
    await db.insert(pushOptOuts).values({ userId: optedOut, notificationType: "SHIFT_CHANGED" });
    await db.insert(pushQuietHours).values({ userId: quiet, startMinute: 22 * 60, endMinute: 7 * 60, timeZone: "Australia/Sydney" });
  });

  beforeEach(async () => {
    fake = new FakePushProvider();
    setPushProviderForTests(fake);
    await db.delete(deviceToken).where(inArray(deviceToken.userId, userIds)); // cascades to push_receipts
    await mkToken(staff, "staff-1");
    await mkToken(staff, "staff-2");
    await mkToken(optedOut, "optedout");
    await mkToken(quiet, "quiet");
    await mkToken(outsider, "outsider");
    await mkToken(suspended, "suspended");
  });

  afterAll(async () => {
    setPushProviderForTests(null);
    await db.delete(deviceToken).where(inArray(deviceToken.userId, userIds));
    await db.delete(notification).where(inArray(notification.organisationId, [orgA, orgB]));
    await db.delete(pushOptOuts).where(inArray(pushOptOuts.userId, userIds));
    await db.delete(pushQuietHours).where(inArray(pushQuietHours.userId, userIds));
    await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
    await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    await db.delete(user).where(inArray(user.userId, userIds));
  });

  it("sends one generic push to each device of the recipient, with the notification id and a route", async () => {
    const n = note(staff);
    await dispatchPush(n);
    expect(fake.sent.map((m) => m.to).sort()).toEqual([tok("staff-1"), tok("staff-2")]);
    for (const m of fake.sent) {
      expect(m.title).toBe("Your shifts");
      expect(m.body).toBe("One of your shifts changed.");
      expect(m.data).toEqual({ notificationId: n.notificationId, type: "SHIFT_CHANGED", link: "/shifts/3f2b8c1e-5d7a-4e6f-9a1b-2c3d4e5f6a7b" });
    }
  });

  it("never puts a name, document type or date from the in-app payload into the push", async () => {
    const [row] = await db
      .insert(notification)
      .values({
        organisationId: orgA,
        recipientUserId: staff,
        type: "DOCUMENT_REJECTED",
        payload: { staffName: "Zelda Fitzgerald", documentType: "Food Safety Supervisor", expiryDate: "2031-02-03", body: "Zelda's Food Safety Supervisor expires 2031-02-03" },
        relatedEntityType: "compliance_document",
        relatedEntityId: crypto.randomUUID(),
      })
      .returning();
    await dispatchPush(row);
    expect(fake.sent.length).toBe(2);
    const wire = JSON.stringify(fake.sent);
    for (const secret of ["Zelda", "Fitzgerald", "Food Safety", "Supervisor", "2031", "expires"]) expect(wire).not.toContain(secret);
  });

  it("sends nothing while the provider switch is off (no provider resolved)", async () => {
    setPushProviderForTests(null);
    delete process.env.EXPO_PUSH_ENABLED;
    await dispatchPush(note(staff));
    expect(fake.sent).toEqual([]);
  });

  it("skips a token that is not an Expo push token (a raw APNs or FCM token from an older build)", async () => {
    await db.insert(deviceToken).values({ userId: staff, tokenValue: `${tag}-raw-fcm-token`, platform: "android" });
    await dispatchPush(note(staff));
    expect(fake.sent.map((m) => m.to).sort()).toEqual([tok("staff-1"), tok("staff-2")]);
  });

  it("sends nothing to someone who switched that type off, but still sends them the other types", async () => {
    await dispatchPush(note(optedOut, "SHIFT_CHANGED"));
    expect(fake.sent).toEqual([]);
    await dispatchPush(note(optedOut, "SHIFT_ASSIGNED"));
    expect(fake.sent.map((m) => m.to)).toEqual([tok("optedout")]);
  });

  it("sends nothing during the recipient's quiet hours in their own time zone, and sends outside them", async () => {
    // 2026-07-01 12:00Z is 22:00 in Sydney (UTC+10): inside 22:00-07:00. 22:00Z is 08:00 there: outside.
    await dispatchPush(note(quiet), new Date("2026-07-01T12:00:00Z"));
    expect(fake.sent).toEqual([]);
    await dispatchPush(note(quiet), new Date("2026-07-01T22:00:00Z"));
    expect(fake.sent.map((m) => m.to)).toEqual([tok("quiet")]);
  });

  it("does not push to someone outside the notification's organisation, or to a suspended account", async () => {
    await dispatchPush(note(outsider, "SHIFT_CHANGED", orgA)); // member of org B only
    await dispatchPush(note(suspended));
    expect(fake.sent).toEqual([]);
  });

  it("never uses another person's device: a push for org A's staff reaches only staff's tokens", async () => {
    await dispatchPush(note(staff));
    expect(fake.sent.map((m) => m.to)).not.toContain(tok("outsider"));
    await dispatchPush(note(outsider, "SHIFT_CHANGED", orgB));
    expect(fake.sent.map((m) => m.to).sort()).toEqual([tok("outsider"), tok("staff-1"), tok("staff-2")].sort());
  });

  it("does nothing, and does not throw, for a recipient with no device", async () => {
    await expect(dispatchPush(note(lonely))).resolves.toBeUndefined();
    expect(fake.sent).toEqual([]);
  });

  it("removes a token the provider says is dead, at once, and keeps the others", async () => {
    fake.deadTokens.add(tok("staff-2"));
    await dispatchPush(note(staff));
    const left = (await tokenRows([staff])).map((r) => r.tokenValue);
    expect(left).toEqual([tok("staff-1")]);
  });

  it("keeps every token and does not throw when the provider is down", async () => {
    fake.failSend = true;
    await expect(dispatchPush(note(staff))).resolves.toBeUndefined();
    expect((await tokenRows([staff])).length).toBe(2);
  });

  describe("delivery receipts", () => {
    const ticketRows = async () => db.select().from(pushReceipts);

    it("records a ticket per accepted push and, once old enough, reads the receipt and drops the row", async () => {
      await dispatchPush(note(staff));
      const rows = (await ticketRows()).filter((r) => [...fake.ticketByToken.values()].includes(r.ticketId));
      expect(rows.length).toBe(2);

      // Too young: the provider is not asked.
      await processPushReceipts(new Date(Date.now() + 5 * MIN), fake);
      expect(fake.receiptRequests.flat().filter((id) => rows.some((r) => r.ticketId === id))).toEqual([]);

      for (const r of rows) fake.receiptScript.set(r.ticketId, { status: "ok" });
      await processPushReceipts(new Date(Date.now() + 20 * MIN), fake);
      const after = (await ticketRows()).filter((r) => rows.some((x) => x.id === r.id));
      expect(after).toEqual([]);
      expect((await tokenRows([staff])).length).toBe(2);
    });

    it("removes a token whose receipt says DeviceNotRegistered, and only that one", async () => {
      await dispatchPush(note(staff));
      fake.receiptScript.set(fake.ticketByToken.get(tok("staff-1"))!, { status: "error", error: "DeviceNotRegistered", message: "gone" });
      fake.receiptScript.set(fake.ticketByToken.get(tok("staff-2"))!, { status: "ok" });
      await processPushReceipts(new Date(Date.now() + 20 * MIN), fake);
      expect((await tokenRows([staff])).map((r) => r.tokenValue)).toEqual([tok("staff-2")]);
    });

    it("keeps a token for any other receipt error, and drops its ticket row", async () => {
      await dispatchPush(note(staff));
      const id = fake.ticketByToken.get(tok("staff-1"))!;
      fake.receiptScript.set(id, { status: "error", error: "MessageRateExceeded", message: "slow down" });
      await processPushReceipts(new Date(Date.now() + 20 * MIN), fake);
      expect((await tokenRows([staff])).length).toBe(2);
      expect((await ticketRows()).some((r) => r.ticketId === id)).toBe(false);
    });

    it("keeps a ticket the provider has no receipt for yet, and gives up on it after a day", async () => {
      await dispatchPush(note(staff));
      const id = fake.ticketByToken.get(tok("staff-1"))!;
      await processPushReceipts(new Date(Date.now() + 20 * MIN), fake);
      expect((await ticketRows()).some((r) => r.ticketId === id)).toBe(true);
      await processPushReceipts(new Date(Date.now() + 25 * 60 * MIN), fake);
      expect((await ticketRows()).some((r) => r.ticketId === id)).toBe(false);
      expect((await tokenRows([staff])).length).toBe(2); // giving up is not proof the token is dead
    });

    it("leaves the tickets alone, and does not throw, when the provider cannot be reached", async () => {
      await dispatchPush(note(staff));
      const failing = { ...fake, receipts: async () => { throw new Error("down"); } };
      await expect(processPushReceipts(new Date(Date.now() + 20 * MIN), failing)).resolves.toBeDefined();
      expect((await ticketRows()).some((r) => r.ticketId === fake.ticketByToken.get(tok("staff-1")))).toBe(true);
    });
  });

  describe("notifyAndPush", () => {
    it("saves the in-app notification and pushes it", async () => {
      await notifyAndPush({
        organisationId: orgA,
        recipientUserId: staff,
        type: "SHIFT_ASSIGNED",
        payload: { shiftId: "s" },
        relatedEntityType: "shift",
        relatedEntityId: crypto.randomUUID(),
      });
      await drainPushDispatch();
      const rows = await db.select().from(notification).where(eq(notification.recipientUserId, staff));
      expect(rows.map((r) => r.type)).toContain("SHIFT_ASSIGNED");
      expect(fake.sent.length).toBe(2);
    });

    it("never throws into the caller's request: an unsavable notification is logged and dropped", async () => {
      await expect(
        notifyAndPush({ organisationId: -1, recipientUserId: staff, type: "SHIFT_ASSIGNED", payload: {} }),
      ).resolves.toBeUndefined();
      expect(fake.sent).toEqual([]);
    });

    it("still saves the in-app notification when the push fails", async () => {
      fake.failSend = true;
      await notifyAndPush({ organisationId: orgA, recipientUserId: staff, type: "SHIFT_CANCELLED", payload: {} });
      await drainPushDispatch();
      const rows = await db.select().from(notification).where(eq(notification.recipientUserId, staff));
      expect(rows.map((r) => r.type)).toContain("SHIFT_CANCELLED");
    });
  });
});
