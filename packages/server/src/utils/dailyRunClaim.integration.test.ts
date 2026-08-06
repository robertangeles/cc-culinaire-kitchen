import { describe, it, expect, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "./envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { siteSetting } from "../db/schema.js";
import { claimDailyRun, releaseDailyRun, readLastRun, dailyRunKey } from "./dailyRunClaim.js";

/**
 * Real-DB suite for the once-per-day run claim (site_setting-backed mutex).
 * Gated on TENANT_IT=1, the repo's real-DB gate — skipped by the DB-less main
 * CI job. Self-cleaning: deletes exactly the one site_setting row this suite
 * creates, wrapped so a failure elsewhere still lets teardown run.
 *
 * Tests run in declaration order and share one job's claim state, same pattern
 * as storageAreas.integration.test.ts — each later test depends on the period
 * an earlier one claimed.
 */
const RUN = process.env.TENANT_IT === "1";

const JOB = `__it_test_job_${Date.now()}`;
const KEY = dailyRunKey(JOB);

describe.skipIf(!RUN)("dailyRunClaim (site_setting mutex) — real DB", () => {
  afterAll(async () => {
    try {
      await db.delete(siteSetting).where(eq(siteSetting.settingKey, KEY));
    } catch (err) {
      console.warn(`[dailyRunClaim.it] cleanup failed for ${KEY}:`, err);
    }
  });

  it("readLastRun returns null before any claim", async () => {
    expect(await readLastRun(JOB)).toBeNull();
  });

  it("first claim for a period returns true", async () => {
    expect(await claimDailyRun(JOB, "period-a")).toBe(true);
  });

  it("immediately claiming the SAME period again returns false", async () => {
    expect(await claimDailyRun(JOB, "period-a")).toBe(false);
  });

  it("readLastRun returns the period string after a winning claim", async () => {
    expect(await readLastRun(JOB)).toBe("period-a");
  });

  it("claiming a DIFFERENT period returns true", async () => {
    expect(await claimDailyRun(JOB, "period-b")).toBe(true);
  });

  it("releaseDailyRun() then re-claiming the same period returns true again", async () => {
    await releaseDailyRun(JOB);
    expect(await claimDailyRun(JOB, "period-b")).toBe(true);
  });

  it("two concurrent claimDailyRun() calls for the same period: exactly one wins", async () => {
    const [a, b] = await Promise.all([
      claimDailyRun(JOB, "period-concurrent"),
      claimDailyRun(JOB, "period-concurrent"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});
