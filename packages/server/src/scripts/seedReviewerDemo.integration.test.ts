import { describe, it, expect, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { stockTakeSession, storeLocation, userOrganisation } from "../db/schema.js";
import { loginUser } from "../services/authService.js";
import { getUserLocationContext } from "../services/locationContextService.js";
import { getUserWithRolesAndPermissions } from "../services/authService.js";
import { listAreas } from "../services/storageAreaService.js";
import { deleteOwnAccount } from "../services/accountDeletionService.js";
import { getMembership } from "../services/organisationService.js";
import { getChannelByKey, getMessages, getUserChannels } from "../services/benchService.js";
import { DEMO_AREAS, DEMO_BENCH_MESSAGES, DEMO_FIRST_BENCH_MESSAGES, seedReviewerDemo } from "./seedReviewerDemo.js";

/**
 * The reviewer can sign in and count straight away, each sees the other's Bench messages, a second run changes nothing,
 * and a deleted account comes back in the same kitchen. Gated on TENANT_IT=1 like the other real-DB suites.
 */
const RUN = process.env.TENANT_IT === "1";
const PREFIX = "it-reviewer-";
const first = { email: `${PREFIX}${Date.now()}@it.test`, password: "Reviewer-Passw0rd!" };
const second = { email: `${PREFIX}${Date.now()}-2@it.test`, password: "Reviewer-Passw0rd-2!" };

describe.skipIf(!RUN)("seedReviewerDemo (real DB)", { timeout: 120_000 }, () => {
  let userId = 0;
  let secondUserId = 0;
  let orgId = 0;
  // A deleted account no longer carries its address, so it is swept by id.
  const made = new Set<number>();

  /** Deletes the rows matching `where`, and first every row anywhere that points at them (the foreign keys do not cascade). */
  async function purge(table: string, where: string, depth = 0): Promise<void> {
    if (depth > 6) return;
    const rows = await db.execute<{ child: string; child_col: string; parent_col: string }>(sql`
      select c.conrelid::regclass::text as child, a.attname as child_col, af.attname as parent_col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
      where c.contype = 'f' and c.confrelid = ${table}::regclass and c.conrelid <> c.confrelid`);
    for (const fk of rows) await purge(fk.child, `"${fk.child_col}" in (select "${fk.parent_col}" from ${table} where ${where})`, depth + 1);
    await db.execute(sql.raw(`delete from ${table} where ${where}`));
  }

  // Also sweeps what an earlier failed run left behind.
  afterAll(async () => {
    const rows = await db.execute<{ user_id: number; organisation_id: number | null }>(sql`
      select u.user_id, uo.organisation_id from "user" u left join user_organisation uo on uo.user_id = u.user_id where u.user_email like ${PREFIX + "%"}`);
    const orgs = new Set(rows.flatMap((r) => (r.organisation_id ? [r.organisation_id] : [])));
    if (orgId) orgs.add(orgId);
    for (const r of rows) made.add(r.user_id);
    for (const id of orgs) {
      // The kitchen's Bench room and its messages carry no foreign keys to follow.
      await purge("bench_message", `channel_id in (select channel_id from bench_channel where channel_key = 'org_${id}')`);
      await purge("bench_channel", `channel_key = 'org_${id}'`);
      await purge("organisation", `organisation_id = ${id}`);
    }
    for (const id of made) await purge('"user"', `user_id = ${id}`);
  });

  /** The kitchen's Bench messages as this person sees them. */
  async function benchAs(viewerId: number) {
    const room = await getChannelByKey(`org_${orgId}`);
    return (await getMessages(room!.channelId, { viewerId })).map((m) => ({ userId: m.userId, body: m.messageBody }));
  }

  function remember(out: { userId: number; secondUserId: number }) {
    made.add(out.userId);
    made.add(out.secondUserId);
  }

  it("makes a verified reviewer who signs in with no second step, at a location, with areas and an open area count", async () => {
    const out = await seedReviewerDemo(first, second);
    remember(out);
    userId = out.userId;
    secondUserId = out.secondUserId;
    orgId = out.organisationId;
    expect(out.openedStockTake).toBe(true);

    for (const account of [first, second]) expect((await loginUser(account.email, account.password)).requiresMfa).toBe(false);

    const ctx = await getUserLocationContext(userId);
    expect(ctx.locations.map((l) => l.storeLocationId)).toEqual([out.storeLocationId]);

    const areas = await listAreas(out.storeLocationId, orgId);
    for (const demo of DEMO_AREAS) expect(areas.find((a) => a.areaName === demo.area)?.itemCount).toBe(4);

    const open = await db.select().from(stockTakeSession).where(eq(stockTakeSession.storeLocationId, out.storeLocationId));
    expect(open.filter((s) => s.sessionStatus === "OPEN")).toHaveLength(1);
    expect(open[0].countMode).toBe("AREA");

    const me = await getUserWithRolesAndPermissions(userId);
    expect(me?.permissions).toContain("inventory:count");
  });

  it("puts both accounts in the kitchen and its Bench room, neither a moderator, each seeing the other's messages", async () => {
    for (const id of [userId, secondUserId]) {
      expect((await getUserWithRolesAndPermissions(id))?.permissions).not.toContain("bench:moderate");
      expect((await getUserChannels(id)).map((c) => c.channelKey)).toContain(`org_${orgId}`);
      expect((await getUserLocationContext(id)).locations).toHaveLength(1);
    }
    const members = await db.select().from(userOrganisation).where(eq(userOrganisation.organisationId, orgId));
    expect(members.map((m) => [m.userId, m.role]).sort()).toEqual([[userId, "admin"], [secondUserId, "admin"]].sort());
    const expected = [
      ...DEMO_FIRST_BENCH_MESSAGES.map((body) => ({ userId, body })),
      ...DEMO_BENCH_MESSAGES.map((body) => ({ userId: secondUserId, body })),
    ].sort((a, b) => a.body.localeCompare(b.body));
    for (const viewer of [userId, secondUserId]) {
      expect((await benchAs(viewer)).sort((a, b) => a.body.localeCompare(b.body))).toEqual(expected);
    }
  });

  it("a second run reuses everything: two users, one organisation, one location, one open stock take, no new messages", async () => {
    const out = await seedReviewerDemo(first, second);
    expect(out.userId).toBe(userId);
    expect(out.secondUserId).toBe(secondUserId);
    expect(out.organisationId).toBe(orgId);
    expect(out.openedStockTake).toBe(false);
    expect(out.benchMessagesPosted).toBe(0);
    expect(await db.select().from(userOrganisation).where(eq(userOrganisation.userId, userId))).toHaveLength(1);
    expect(await db.select().from(userOrganisation).where(eq(userOrganisation.organisationId, orgId))).toHaveLength(2);
    expect(await db.select().from(storeLocation).where(eq(storeLocation.organisationId, orgId))).toHaveLength(1);
    expect((await listAreas(out.storeLocationId, orgId)).filter((a) => a.itemCount > 0)).toHaveLength(3);
    expect(await benchAs(userId)).toHaveLength(DEMO_FIRST_BENCH_MESSAGES.length + DEMO_BENCH_MESSAGES.length);
  });

  it("the reviewer can delete the first account, and a rerun brings it back in the same kitchen, still able to approve", async () => {
    await deleteOwnAccount(userId, { password: first.password }, new Date());
    const out = await seedReviewerDemo(first, second);
    remember(out);
    expect(out.userId).not.toBe(userId);
    expect(out.secondUserId).toBe(secondUserId);
    expect(out.organisationId).toBe(orgId);
    expect(out.locationsSeenByPhone).toBe(1);
    expect(out.benchMessagesPosted).toBe(DEMO_FIRST_BENCH_MESSAGES.length);
    userId = out.userId;
    expect((await getMembership(userId, orgId))?.role).toBe("admin");
    const me = await getUserWithRolesAndPermissions(userId);
    expect(me?.permissions).toContain("purchasing:approve");
    expect(me?.permissions).not.toContain("bench:moderate");
    expect((await benchAs(userId)).filter((m) => m.userId === secondUserId)).toHaveLength(DEMO_BENCH_MESSAGES.length);
    expect((await benchAs(secondUserId)).filter((m) => m.userId === userId)).toHaveLength(DEMO_FIRST_BENCH_MESSAGES.length);
  });

  it("the reviewer can delete the second account, and a rerun brings it back with its messages", async () => {
    await deleteOwnAccount(secondUserId, { password: second.password }, new Date());
    const out = await seedReviewerDemo(first, second);
    remember(out);
    expect(out.secondUserId).not.toBe(secondUserId);
    expect(out.organisationId).toBe(orgId);
    expect(out.benchMessagesPosted).toBe(DEMO_BENCH_MESSAGES.length);
    secondUserId = out.secondUserId;
    expect((await benchAs(userId)).filter((m) => m.userId === secondUserId)).toHaveLength(DEMO_BENCH_MESSAGES.length);
    expect((await benchAs(secondUserId)).filter((m) => m.userId === userId)).toHaveLength(DEMO_FIRST_BENCH_MESSAGES.length);
  });
});
