import { describe, it, expect, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { deviceToken, pushOptOuts, pushQuietHours, pushReceipts, user } from "../db/schema.js";
import { migrations } from "./index.js";

/** Migration 0004 (push dispatch): idempotent, additive, applied by hand before the deploy. Gated on TENANT_IT=1. */
const RUN = process.env.TENANT_IT === "1";

describe("migration 0004", () => {
  it("is registered after 0003", () => {
    const ids = migrations.map((m) => m.id);
    expect(ids.indexOf("0004_push_dispatch")).toBe(ids.indexOf("0003_apple_sign_in") + 1);
  });
});

describe.skipIf(!RUN)("migration 0004 (real DB)", () => {
  const tag = `mig4-${Date.now().toString(36)}`;
  let userId: number | undefined;

  afterAll(async () => {
    if (userId === undefined) return;
    await db.delete(deviceToken).where(eq(deviceToken.userId, userId));
    await db.delete(pushOptOuts).where(eq(pushOptOuts.userId, userId));
    await db.delete(pushQuietHours).where(eq(pushQuietHours.userId, userId));
    await db.delete(user).where(eq(user.userId, userId));
  });

  it("can run twice, leaves the three tables with their indexes, and changes no column of any other table", async () => {
    const m = migrations.find((x) => x.id === "0004_push_dispatch")!;
    const otherColumns = () =>
      db.execute(sql`
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name NOT IN ('push_opt_outs','push_quiet_hours','push_receipts')
        ORDER BY table_name, column_name`) as unknown as Promise<unknown[]>;
    const before = [...(await otherColumns())];
    for (let i = 0; i < 2; i++) for (const s of m.statements) await db.execute(sql.raw(s));
    expect(before.length).toBeGreaterThan(0);
    expect([...(await otherColumns())]).toEqual(before);
    const idx = (await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename IN ('push_opt_outs','push_quiet_hours','push_receipts') ORDER BY indexname`)) as unknown as Array<{ indexname: string }>;
    expect(idx.map((i) => i.indexname)).toEqual(
      expect.arrayContaining(["uq_push_opt_outs_user_type", "uq_push_quiet_hours_user", "idx_push_receipts_device_token", "idx_push_receipts_created"]),
    );
  });

  it("the previous server version keeps working: device tokens are written and deleted exactly as before", async () => {
    [{ id: userId }] = await db.insert(user).values({ userName: `${tag} User`, userEmail: `${tag}@it.test` }).returning({ id: user.userId });
    await db.execute(sql`INSERT INTO device_token (user_id, token_value, platform) VALUES (${userId}, ${tag}, 'ios')`);
    await db.execute(sql`DELETE FROM device_token WHERE token_value = ${tag}`);
    expect((await db.select().from(deviceToken).where(eq(deviceToken.userId, userId))).length).toBe(0);
  });

  it("enforces one opt-out per user and type, one quiet window per user, and a window that has a length", async () => {
    await db.insert(pushOptOuts).values({ userId: userId!, notificationType: "SHIFT_CHANGED" });
    await expect(db.insert(pushOptOuts).values({ userId: userId!, notificationType: "SHIFT_CHANGED" })).rejects.toThrow();
    await expect(db.insert(pushQuietHours).values({ userId: userId!, startMinute: 600, endMinute: 600, timeZone: "UTC" })).rejects.toThrow();
    await expect(db.insert(pushQuietHours).values({ userId: userId!, startMinute: 0, endMinute: 1440, timeZone: "UTC" })).rejects.toThrow();
    await db.insert(pushQuietHours).values({ userId: userId!, startMinute: 1320, endMinute: 420, timeZone: "UTC" });
    await expect(db.insert(pushQuietHours).values({ userId: userId!, startMinute: 1, endMinute: 2, timeZone: "UTC" })).rejects.toThrow();
  });

  it("deleting a device token deletes its pending receipts", async () => {
    const [{ id }] = await db.insert(deviceToken).values({ userId: userId!, tokenValue: `${tag}-cascade`, platform: "ios" }).returning({ id: deviceToken.deviceTokenId });
    await db.insert(pushReceipts).values({ deviceTokenId: id, ticketId: `${tag}-ticket` });
    await db.delete(deviceToken).where(eq(deviceToken.deviceTokenId, id));
    expect(await db.select().from(pushReceipts).where(eq(pushReceipts.deviceTokenId, id))).toEqual([]);
  });
});
