import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");
const { buildDigestBody, sendOrgDigests } = await import("./brainDigestService.js");

// ── Unit: the deterministic template (no DB) ─────────────────────────────────
describe("buildDigestBody (T15 template)", () => {
  it("singular phrasing for a single memory", () => {
    expect(buildDigestBody({ total: 1, bySource: new Map([["waste", 1]]) })).toBe(
      "This week your kitchen's Brain learned 1 new thing: 1 from the waste log.",
    );
  });

  it("plural phrasing, highest count first", () => {
    const body = buildDigestBody({
      total: 9,
      bySource: new Map([
        ["recipe", 4],
        ["waste", 5],
      ]),
    });
    expect(body).toContain("9 new things");
    // 5 (waste) is listed before 4 (recipes).
    expect(body.indexOf("the waste log")).toBeLessThan(body.indexOf("recipes"));
  });
});

// ── Integration: delivery to org admins, zero-memory orgs skipped ────────────
const dbAvailable = await (async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();
if (!dbAvailable) {
  console.warn("brainDigestService.test.ts: no local database reachable — integration skipped");
}

describe.runIf(dbAvailable)("sendOrgDigests (T15, real DB)", () => {
  let adminId = 0;
  let memberId = 0;
  let orgWith = 0;
  let orgWithout = 0;
  const flagBackup: Record<string, string> = {};
  const key = (p: string) => `DIG-${p}-${randomUUID().slice(0, 8)}`.toUpperCase();

  beforeAll(async () => {
    const { getAllSettings, upsertSettings } = await import("./settingsService.js");
    flagBackup.brain_enabled = (await getAllSettings()).brain_enabled ?? "false";
    await upsertSettings({ brain_enabled: "true" });

    const users = (await db.execute(sql`
      INSERT INTO "user" (user_name, user_email) VALUES
        ('Digest admin',  ${`dga-${randomUUID()}@test.local`}),
        ('Digest member', ${`dgm-${randomUUID()}@test.local`})
      RETURNING user_id
    `)) as unknown as Array<{ user_id: number }>;
    [adminId, memberId] = users.map((u) => u.user_id);

    const orgs = (await db.execute(sql`
      INSERT INTO organisation (organisation_name, join_key, created_by) VALUES
        ('Digest Kitchen With',    ${key("with")}, ${adminId}),
        ('Digest Kitchen Without', ${key("wout")}, ${adminId})
      RETURNING organisation_id
    `)) as unknown as Array<{ organisation_id: number }>;
    orgWith = orgs[0].organisation_id;
    orgWithout = orgs[1].organisation_id;

    await db.execute(sql`
      INSERT INTO user_organisation (user_id, organisation_id, role) VALUES
        (${adminId},  ${orgWith},    'admin'),
        (${memberId}, ${orgWith},    'member'),
        (${adminId},  ${orgWithout}, 'admin')
    `);

    // Two shared memories THIS WEEK in orgWith; orgWithout has none.
    await db.execute(sql`
      INSERT INTO brain_memory (user_id, organisation_id, scope, source_type, body, status) VALUES
        (${adminId}, ${orgWith}, 'org', 'waste', 'Logged 3kg of trimmings.', 'ready'),
        (${adminId}, ${orgWith}, 'org', 'recipe', 'Refined the terrine.', 'ready')
    `);
  });

  afterAll(async () => {
    const { upsertSettings } = await import("./settingsService.js");
    await upsertSettings(flagBackup);
    const orgList = [orgWith, orgWithout].filter(Boolean).join(",");
    const userList = [adminId, memberId].filter(Boolean).join(",");
    if (orgList) {
      await db.execute(sql`DELETE FROM brain_memory WHERE organisation_id IN (${sql.raw(orgList)})`);
      await db.execute(sql`DELETE FROM notification WHERE organisation_id IN (${sql.raw(orgList)})`);
      await db.execute(sql`DELETE FROM user_organisation WHERE organisation_id IN (${sql.raw(orgList)})`);
      await db.execute(sql`DELETE FROM organisation WHERE organisation_id IN (${sql.raw(orgList)})`);
    }
    if (userList) await db.execute(sql`DELETE FROM "user" WHERE user_id IN (${sql.raw(userList)})`);
  });

  it("delivers a BRAIN_DIGEST to the org's admin, summarising the week; skips a zero-memory org and non-admins", async () => {
    await sendOrgDigests();

    // Admin of the org with memories gets exactly one digest with the right count.
    const adminNotifs = (await db.execute(sql`
      SELECT payload FROM notification
      WHERE type = 'BRAIN_DIGEST' AND recipient_user_id = ${adminId} AND organisation_id = ${orgWith}
    `)) as unknown as Array<{ payload: { summary: string; total: number } }>;
    expect(adminNotifs).toHaveLength(1);
    expect(adminNotifs[0].payload.total).toBe(2);
    expect(adminNotifs[0].payload.summary).toContain("2 new things");

    // The plain member gets nothing (digest targets admins).
    const memberNotifs = (await db.execute(sql`
      SELECT count(*)::int AS n FROM notification
      WHERE type = 'BRAIN_DIGEST' AND recipient_user_id = ${memberId}
    `)) as unknown as Array<{ n: number }>;
    expect(memberNotifs[0].n).toBe(0);

    // The zero-memory org produces no digest at all.
    const emptyOrgNotifs = (await db.execute(sql`
      SELECT count(*)::int AS n FROM notification
      WHERE type = 'BRAIN_DIGEST' AND organisation_id = ${orgWithout}
    `)) as unknown as Array<{ n: number }>;
    expect(emptyOrgNotifs[0].n).toBe(0);
  });
});
