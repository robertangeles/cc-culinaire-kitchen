import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

// Stub the LLM — deterministic nudge text, no provider call.
vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ text: "Trim the next tomato PO to cut waste." })),
}));

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");
const { runNudges } = await import("./brainNudgeService.js");

const dbAvailable = await (async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();
if (!dbAvailable) {
  console.warn("brainNudgeService.test.ts: no local database reachable — suite skipped");
}

describe.runIf(dbAvailable)("brainNudgeService (T17, real DB)", () => {
  let userId = 0;
  let orgId = 0;
  const flagBackup: Record<string, string> = {};
  const key = (p: string) => `NDG-${p}-${randomUUID().slice(0, 8)}`.toUpperCase();

  beforeAll(async () => {
    const { getAllSettings, upsertSettings } = await import("./settingsService.js");
    const s = await getAllSettings();
    // Restore to the real seed defaults for any setting absent when the test
    // runs — a blanket "false" would poison `brain_nudge_rate_limit` (a number)
    // with a value `Number()` reads as NaN, silently disabling nudges.
    const defaults: Record<string, string> = {
      brain_enabled: "false",
      brain_nudges_enabled: "false",
      brain_nudge_rate_limit: "2",
    };
    for (const k of Object.keys(defaults)) {
      flagBackup[k] = s[k] ?? defaults[k];
    }

    const [u] = (await db.execute(sql`
      INSERT INTO "user" (user_name, user_email, brain_nudges_opt_in)
      VALUES ('Nudge user', ${`ndg-${randomUUID()}@test.local`}, true)
      RETURNING user_id
    `)) as unknown as Array<{ user_id: number }>;
    userId = u.user_id;

    const [o] = (await db.execute(sql`
      INSERT INTO organisation (organisation_name, join_key, created_by)
      VALUES ('Nudge Kitchen', ${key("org")}, ${userId})
      RETURNING organisation_id
    `)) as unknown as Array<{ organisation_id: number }>;
    orgId = o.organisation_id;

    // One recent actionable ops memory the nudge can act on.
    await db.execute(sql`
      INSERT INTO brain_memory (user_id, organisation_id, scope, source_type, body, status)
      VALUES (${userId}, ${orgId}, 'org', 'waste', 'Logged 3kg tomato trim this week.', 'ready')
    `);
  });

  afterAll(async () => {
    const { upsertSettings } = await import("./settingsService.js");
    await upsertSettings(flagBackup);
    if (orgId) await db.execute(sql`DELETE FROM notification WHERE organisation_id = ${orgId}`);
    if (userId) {
      await db.execute(sql`DELETE FROM brain_memory WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM user_organisation WHERE organisation_id = ${orgId}`);
      await db.execute(sql`DELETE FROM organisation WHERE organisation_id = ${orgId}`);
      await db.execute(sql`DELETE FROM "user" WHERE user_id = ${userId}`);
    }
  });

  it("no-op when the master flag is off", async () => {
    const { upsertSettings } = await import("./settingsService.js");
    await upsertSettings({
      brain_enabled: "true",
      brain_nudges_enabled: "false",
      brain_nudge_rate_limit: "2",
    });
    const res = await runNudges();
    expect(res.delivered).toBe(0);
    const [{ n }] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM notification WHERE recipient_user_id = ${userId} AND type = 'BRAIN_NUDGE'
    `)) as unknown as Array<{ n: number }>;
    expect(n).toBe(0);
  });

  it("delivers an ops nudge to an opted-in user, then dedupes the same memory", async () => {
    const { upsertSettings } = await import("./settingsService.js");
    await upsertSettings({
      brain_enabled: "true",
      brain_nudges_enabled: "true",
      brain_nudge_rate_limit: "2",
    });

    const first = await runNudges();
    expect(first.delivered).toBeGreaterThanOrEqual(1);

    const [nudge] = (await db.execute(sql`
      SELECT type, recipient_user_id, payload->>'body' AS body, related_entity_type
      FROM notification WHERE recipient_user_id = ${userId} AND type = 'BRAIN_NUDGE'
    `)) as unknown as Array<{ type: string; recipient_user_id: number; body: string; related_entity_type: string }>;
    expect(nudge.body).toContain("tomato PO");
    expect(nudge.related_entity_type).toBe("brain_memory");

    // Second run: the only ops memory was already nudged → no duplicate.
    await runNudges();
    const [{ n }] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM notification WHERE recipient_user_id = ${userId} AND type = 'BRAIN_NUDGE'
    `)) as unknown as Array<{ n: number }>;
    expect(n).toBe(1);
  });
});
