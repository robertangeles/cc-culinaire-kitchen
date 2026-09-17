import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, and, isNull, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { awardRule, user, auditLog } from "../db/schema.js";
import { upsertAwardRule } from "./awardRuleService.js";

/**
 * Real-database behaviour of upsertAwardRule's write path: auto-supersede,
 * the same-day-edit guard, the concurrency retry, and the audit trail —
 * the things a pure unit test can't exercise (they all depend on actual
 * row state and actual unique-constraint enforcement). Gated on
 * TENANT_IT=1, same convention as compliance.integration.test.ts.
 *
 * Unlike document_expiry_rule's `documentType` (free text, so a test can
 * tag-scope it), `award_rule.ruleType` is validated against the fixed
 * 9-value enum — each test below uses a DIFFERENT real rule type + a
 * different real jurisdiction so the 4 tests in this file can never
 * collide with each other, given award_rule ships with zero seeded rows.
 */
const RUN = process.env.TENANT_IT === "1";
const tag = `it-${Date.now()}`;

describe.skipIf(!RUN)("upsertAwardRule (real DB)", () => {
  const createdRuleIds: string[] = [];
  let actorUserId: number;

  beforeAll(async () => {
    [{ userId: actorUserId }] = await db
      .insert(user)
      .values({ userName: "Award Rule Actor", userEmail: `${tag}-award-actor@it.test` })
      .returning({ userId: user.userId });
  });

  afterAll(async () => {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, "award_rule"), eq(auditLog.actorUserId, actorUserId)));
    if (createdRuleIds.length > 0) {
      await db.delete(awardRule).where(inArray(awardRule.awardRuleId, createdRuleIds));
    }
    await db.delete(user).where(eq(user.userId, actorUserId));
  });

  it("creates a new rule with a server-generated ruleVersion, not user input, and audit-logs the insert", async () => {
    const created = await upsertAwardRule(
      {
        awardCode: "MA000009",
        ruleType: "max_ordinary_hours",
        jurisdiction: null,
        thresholdValue: 38,
        effectiveFrom: "2020-01-01",
        sourceCitation: "cl 32",
      },
      actorUserId,
    );
    createdRuleIds.push(created.awardRuleId);
    expect(created.ruleVersion).toBe("v2020-01-01");
    expect(created.effectiveTo).toBeNull();

    const [auditRow] = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "award_rule"), eq(auditLog.entityId, created.awardRuleId)));
    expect(auditRow.action).toBe("create");
  });

  it("auto-supersede: a later edit closes the old row and audit-logs the close", async () => {
    const ruleType = "publish_notice";
    const jurisdiction = "NSW";
    const first = await upsertAwardRule(
      { awardCode: "MA000009", ruleType, jurisdiction, thresholdValue: 38, effectiveFrom: "2021-01-01", sourceCitation: null },
      actorUserId,
    );
    createdRuleIds.push(first.awardRuleId);

    const second = await upsertAwardRule(
      { awardCode: "MA000009", ruleType, jurisdiction, thresholdValue: 40, effectiveFrom: "2022-06-01", sourceCitation: null },
      actorUserId,
    );
    createdRuleIds.push(second.awardRuleId);

    const [closedFirst] = await db
      .select({ effectiveTo: awardRule.effectiveTo })
      .from(awardRule)
      .where(eq(awardRule.awardRuleId, first.awardRuleId));
    expect(closedFirst.effectiveTo).toBe("2022-05-31");

    const [openSecond] = await db
      .select({ effectiveTo: awardRule.effectiveTo })
      .from(awardRule)
      .where(eq(awardRule.awardRuleId, second.awardRuleId));
    expect(openSecond.effectiveTo).toBeNull();

    const closeAudits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "award_rule"), eq(auditLog.entityId, first.awardRuleId), eq(auditLog.action, "update")));
    expect(closeAudits).toHaveLength(1);
  });

  it("rejects a same-day edit that would invert the closed row's date range", async () => {
    const ruleType = "min_break";
    const jurisdiction = "QLD";
    const first = await upsertAwardRule(
      { awardCode: "MA000009", ruleType, jurisdiction, thresholdValue: 10, effectiveFrom: "2026-03-01", sourceCitation: null },
      actorUserId,
    );
    createdRuleIds.push(first.awardRuleId);

    await expect(
      upsertAwardRule(
        { awardCode: "MA000009", ruleType, jurisdiction, thresholdValue: 12, effectiveFrom: "2026-03-01", sourceCitation: null },
        actorUserId,
      ),
    ).rejects.toThrow("already updated today");

    const [unchanged] = await db
      .select({ effectiveTo: awardRule.effectiveTo })
      .from(awardRule)
      .where(eq(awardRule.awardRuleId, first.awardRuleId));
    expect(unchanged.effectiveTo).toBeNull();
  });

  it("two concurrent creates for the same key: exactly one active row survives", async () => {
    const ruleType = "min_rest";
    const jurisdiction = "VIC";
    const attempt = () =>
      upsertAwardRule(
        { awardCode: "MA000009", ruleType, jurisdiction, thresholdValue: 10, effectiveFrom: "2023-01-01", sourceCitation: null },
        actorUserId,
      );
    const results = await Promise.allSettled([attempt(), attempt()]);
    for (const r of results) {
      if (r.status === "fulfilled") createdRuleIds.push(r.value.awardRuleId);
    }

    const activeRows = await db
      .select({ id: awardRule.awardRuleId })
      .from(awardRule)
      .where(and(eq(awardRule.ruleType, ruleType), eq(awardRule.jurisdiction, jurisdiction), isNull(awardRule.effectiveTo)));
    expect(activeRows.length).toBe(1);
    createdRuleIds.push(...activeRows.map((r) => r.id));
  });
});
