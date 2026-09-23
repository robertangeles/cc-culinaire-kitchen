import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { awardRule, user, auditLog } from "../db/schema.js";
import { commitAwardRuleCsvImport, type CsvAwardRuleRow } from "./awardRuleCsvImport.js";

/**
 * commitAwardRuleCsvImport's real-DB behaviour: per-row-atomic commit
 * (matching commitSalesCsv's precedent) — a row that fails at the DB layer
 * (e.g. the same-day-edit guard) must not roll back the rows that already
 * succeeded, and must show up in the report's errors array by row number.
 */
const RUN = process.env.TENANT_IT === "1";
const tag = `it-${Date.now()}`;

describe.skipIf(!RUN)("commitAwardRuleCsvImport (real DB)", () => {
  const createdRuleIds: string[] = [];
  let actorUserId: number;

  beforeAll(async () => {
    [{ userId: actorUserId }] = await db
      .insert(user)
      .values({ userName: "CSV Import Actor", userEmail: `${tag}-csv-actor@it.test` })
      .returning({ userId: user.userId });
  });

  afterAll(async () => {
    await db.delete(auditLog).where(and(eq(auditLog.entityType, "award_rule"), eq(auditLog.actorUserId, actorUserId)));
    if (createdRuleIds.length > 0) {
      await db.delete(awardRule).where(inArray(awardRule.awardRuleId, createdRuleIds));
    }
    await db.delete(user).where(eq(user.userId, actorUserId));
  });

  it("commits every valid row and reports the count", async () => {
    const rows: CsvAwardRuleRow[] = [
      {
        rowIndex: 1,
        awardCode: "MA000009",
        ruleType: "allowances",
        jurisdiction: "SA",
        thresholdValue: 10,
        effectiveFrom: "2023-01-01",
        sourceCitation: null,
      },
      {
        rowIndex: 2,
        awardCode: "MA000009",
        ruleType: "overtime",
        jurisdiction: "TAS",
        thresholdValue: 20,
        effectiveFrom: "2023-01-01",
        sourceCitation: null,
      },
    ];

    const result = await commitAwardRuleCsvImport(rows, actorUserId);
    expect(result).toEqual({ imported: 2, skipped: 0, errors: [] });

    const inserted = await db
      .select({ id: awardRule.awardRuleId })
      .from(awardRule)
      .where(and(eq(awardRule.awardCode, "MA000009"), inArray(awardRule.ruleType, ["allowances", "overtime"])));
    createdRuleIds.push(...inserted.map((r) => r.id));
  });

  it("commits per-row-atomic: a same-day-guard failure on one row doesn't roll back the others", async () => {
    const first = await commitAwardRuleCsvImport(
      [
        {
          rowIndex: 1,
          awardCode: "MA000009",
          ruleType: "casual_loading",
          jurisdiction: "NT",
          thresholdValue: 25,
          effectiveFrom: "2026-03-01",
          sourceCitation: null,
        },
      ],
      actorUserId,
    );
    expect(first.imported).toBe(1);

    const rows: CsvAwardRuleRow[] = [
      // Row 1: succeeds — a genuinely new rule.
      {
        rowIndex: 1,
        awardCode: "MA000009",
        ruleType: "penalty_rates",
        jurisdiction: "NT",
        thresholdValue: 15,
        effectiveFrom: "2026-01-01",
        sourceCitation: null,
      },
      // Row 2: fails — same-day-edit guard (casual_loading/NT was just created
      // effective 2026-03-01, this row targets the exact same day).
      {
        rowIndex: 2,
        awardCode: "MA000009",
        ruleType: "casual_loading",
        jurisdiction: "NT",
        thresholdValue: 30,
        effectiveFrom: "2026-03-01",
        sourceCitation: null,
      },
    ];

    const result = await commitAwardRuleCsvImport(rows, actorUserId);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([{ row: 2, reason: expect.stringMatching(/already updated today/) }]);

    const inserted = await db
      .select({ id: awardRule.awardRuleId })
      .from(awardRule)
      .where(
        and(
          eq(awardRule.awardCode, "MA000009"),
          inArray(awardRule.ruleType, ["casual_loading", "penalty_rates"]),
        ),
      );
    createdRuleIds.push(...inserted.map((r) => r.id));
  });
});
